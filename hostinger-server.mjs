import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Hot-reloadable API handler ─────────────────────────────────────────────
// We copy api/[...path].js to a temp file with a plain name (no brackets)
// before each import. This avoids Node.js ESM issues with special characters
// ([, ]) and URL query strings in file:// URLs, while still allowing the
// handler to reload on each deploy without a full server restart.
const API_HANDLER_FILE = path.join(__dirname, 'api', '[...path].js');
const API_HANDLER_TMP_DIR = path.join(__dirname, 'api');
let _apiHandler = null;
let _apiHandlerMtime = 0;

async function getApiHandler() {
  try {
    const mtime = fsSync.statSync(API_HANDLER_FILE).mtimeMs;
    if (!_apiHandler || mtime !== _apiHandlerMtime) {
      // Copy to a tmp file without special characters so Node.js ESM can
      // resolve it reliably via file:// URL (no URL-encoding issues).
      const tmpName = `_odessa_handler_${mtime}.mjs`;
      const tmpFile = path.join(API_HANDLER_TMP_DIR, tmpName);
      if (!fsSync.existsSync(tmpFile)) {
        fsSync.copyFileSync(API_HANDLER_FILE, tmpFile);
      }
      const freshUrl = pathToFileURL(tmpFile).href;
      const mod = await import(freshUrl);
      _apiHandler = mod.default;
      _apiHandlerMtime = mtime;
      console.log(`[hostinger-server] API handler loaded from ${tmpName}`);
      // Clean up old tmp files (all _odessa_handler_*.mjs except the current one)
      try {
        const files = fsSync.readdirSync(API_HANDLER_TMP_DIR);
        for (const f of files) {
          if (f.startsWith('_odessa_handler_') && f !== tmpName) {
            fsSync.unlinkSync(path.join(API_HANDLER_TMP_DIR, f));
          }
        }
      } catch {}
    }
  } catch (err) {
    console.error('[hostinger-server] Failed to load API handler:', err);
  }
  return _apiHandler;
}
// ── Rate limit por IP (issue #247) ─────────────────────────────────────────
// Janela fixa de 1 minuto, em memória. Autocontido de propósito: este arquivo
// é o único servidor de produção na Hostinger. 0 desliga o limite.
//   ODESSA_RATE_LIMIT_API_PER_MIN   (padrão 600) — qualquer /api/*
//   ODESSA_RATE_LIMIT_LOGIN_PER_MIN (padrão 10)  — POST /api/auth/login
// O app faz polling em várias rotas, por isso o limite geral é folgado: ele
// existe para conter abuso, não para moldar o uso normal.
function readLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const RATE_LIMITS = {
  api: readLimit('ODESSA_RATE_LIMIT_API_PER_MIN', 600),
  login: readLimit('ODESSA_RATE_LIMIT_LOGIN_PER_MIN', 10),
};
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map();

// Atrás do proxy da Hostinger o IP real é o ÚLTIMO item do X-Forwarded-For
// (o proxy acrescenta ao final; os anteriores vêm do cliente e são forjáveis).
function clientIp(req) {
  if (process.env.ODESSA_TRUST_PROXY !== '0') {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

function takeRateToken(kind, ip, now = Date.now()) {
  const limit = RATE_LIMITS[kind];
  if (!limit) return { ok: true };
  const key = `${kind}:${ip}`;
  let bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count <= limit) return { ok: true };
  return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}

// Limpa janelas vencidas para o Map não crescer sem limite.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (now >= bucket.resetAt) rateBuckets.delete(key);
}, RATE_WINDOW_MS).unref();

function rejectRateLimited(res, retryAfter) {
  send(res, 429, JSON.stringify({ detail: 'Muitas requisições. Aguarde um instante e tente de novo.' }), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Retry-After': String(retryAfter),
  });
}

const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || process.env.HOSTINGER_PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
};

const compressibleExts = new Set(['.css', '.html', '.js', '.json', '.svg', '.txt', '.webmanifest']);

function compress(buf, encoding) {
  return new Promise((resolve, reject) => {
    const cb = (err, result) => (err ? reject(err) : resolve(result));
    if (encoding === 'br') zlib.brotliCompress(buf, cb);
    else zlib.gzip(buf, cb);
  });
}

function chooseEncoding(req, ext) {
  if (!compressibleExts.has(ext)) return null;
  const accept = req.headers['accept-encoding'] || '';
  if (accept.includes('br')) return 'br';
  if (accept.includes('gzip')) return 'gzip';
  return null;
}

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function applyApiPath(req, pathname) {
  const apiPath = pathname.replace(/^\/api\/?/, '');
  req.query = {
    ...Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams.entries()),
    path: apiPath ? apiPath.split('/').filter(Boolean) : [],
  };
}

async function serveStatic(req, res, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(distDir, requestedPath));
  if (!filePath.startsWith(distDir)) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('Not a file');
    const ext = path.extname(filePath).toLowerCase();
    const immutable = requestedPath.startsWith('/assets/');
    const cacheControl = immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate';
    const encoding = chooseEncoding(req, ext);
    const raw = await fs.readFile(filePath);
    const body = encoding ? await compress(raw, encoding) : raw;
    send(res, 200, body, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      'Vary': 'Accept-Encoding',
      ...(encoding ? { 'Content-Encoding': encoding } : {}),
    });
  } catch {
    const indexPath = path.join(distDir, 'index.html');
    const raw = await fs.readFile(indexPath);
    const encoding = chooseEncoding(req, '.html');
    const body = encoding ? await compress(raw, encoding) : raw;
    send(res, 200, body, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Vary': 'Accept-Encoding',
      ...(encoding ? { 'Content-Encoding': encoding } : {}),
    });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/healthz') {
      send(res, 200, JSON.stringify({ ok: true, service: 'odessa-hostinger', port }), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return;
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const ip = clientIp(req);
      const isLogin = req.method === 'POST' && url.pathname.replace(/\/+$/, '') === '/api/auth/login';
      const verdict = isLogin ? takeRateToken('login', ip) : takeRateToken('api', ip);
      if (!verdict.ok) {
        rejectRateLimited(res, verdict.retryAfter);
        return;
      }
      applyApiPath(req, url.pathname);
      const handler = await getApiHandler();
      if (handler) {
        await handler(req, res);
      } else {
        // Sem isto a requisição ficava pendurada até o timeout do cliente.
        send(res, 503, JSON.stringify({ detail: 'API indisponível: o handler não carregou (ver logs do servidor).' }), {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
      }
      return;
    }
    if (url.pathname.startsWith('/uploads/')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      const persistentDir = homeDir && !homeDir.includes('Windows') ? path.join(homeDir, 'odessa-data') : '';
      const uploadsDir = process.env.ODESSA_UPLOADS_DIR || (persistentDir ? path.join(persistentDir, 'uploads') : path.join(__dirname, 'uploads'));
      const filePath = path.normalize(path.join(uploadsDir, url.pathname.replace(/^\/uploads\//, '')));
      if (!filePath.startsWith(uploadsDir)) {
        send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
        return;
      }
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) throw new Error('not a file');
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4' };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        const fileSize = stat.size;
        const rangeHeader = req.headers['range'];
        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunkSize = end - start + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
          });
          fsSync.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
            'Accept-Ranges': 'bytes',
          });
          fsSync.createReadStream(filePath).pipe(res);
        }
      } catch {
        send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      }
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error('[hostinger-server]', error);
    if (!res.headersSent) {
      send(res, 500, JSON.stringify({ detail: 'Odessa server error' }), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
    } else {
      res.end();
    }
  }
});

server.listen(port, host, () => {
  console.log(`Odessa Hostinger server listening on http://${host}:${port}`);
});
