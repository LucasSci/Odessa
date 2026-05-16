import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);
let Database;
try {
  Database = _require('better-sqlite3');
} catch {
  Database = null;
}

const SESSION_COOKIE_NAME = 'odessa_admin_session';
const PERSONA_CONFIG_KEY = 'persona_config';
const AUTH_BUILD = 'auth-2026-05-16-email-password-v3';
const SESSION_TTL_SECONDS = Number(process.env.ODESSA_SESSION_TTL_SECONDS || 12 * 60 * 60);
const DEFAULT_ADMIN_EMAIL = 'lucasbatista.c.l@gmail.com';
const DEFAULT_PASSWORD_HASH = 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f'; // 12345678
const ADMIN_EMAIL = (process.env.ODESSA_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
const ADMIN_PASSWORD_HASH = (process.env.ODESSA_ADMIN_PASSWORD_HASH || '').trim();
const SESSION_SECRET = process.env.ODESSA_SESSION_SECRET || 'odessa-hostinger-session-secret-v1-change-in-env';
const AGENT_TOKEN = process.env.ODESSA_AGENT_TOKEN || '';
const AGENT_STALE_MS = Number(process.env.ODESSA_AGENT_STALE_MS || 45_000);
const DATA_DIR = process.env.ODESSA_DATA_DIR || nodePath.join(__dirname, '..', 'data');
const UPLOADS_DIR = process.env.ODESSA_UPLOADS_DIR || nodePath.join(__dirname, '..', 'uploads');
const DB_PATH = process.env.ODESSA_DB_FILE || nodePath.join(DATA_DIR, 'odessa.db');
const MIN_PASSWORD_LENGTH = 8;
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(nodePath.join(UPLOADS_DIR, 'videos'), { recursive: true });
const cloudStore = (globalThis.__ODESSA_CLOUD_STORE ||= {
  agentStatus: null,
  commandQueue: [],
  events: [],
});
const cloudDbState = (globalThis.__ODESSA_CLOUD_DB ||= { db: null });

function json(res, statusCode, body, headers = {}) {
  res.statusCode = statusCode;
  for (const [key, value] of Object.entries({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function extractFileFromMultipart(buffer, contentType) {
  const match = contentType.match(/boundary=([^\s;]+)/);
  if (!match) return null;
  const boundary = match[1].replace(/^["']|["']$/g, '');
  const startDelim = Buffer.from(`--${boundary}`);
  const partDelim = Buffer.from(`\r\n--${boundary}`);

  let pos = buffer.indexOf(startDelim);
  if (pos === -1) return null;
  pos += startDelim.length;

  while (pos < buffer.length) {
    if (buffer[pos] === 0x0d && buffer[pos + 1] === 0x0a) pos += 2;
    if (buffer.slice(pos, pos + 2).toString() === '--') break;
    const headersEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headersEnd === -1) break;
    const headers = buffer.slice(pos, headersEnd).toString();
    const bodyStart = headersEnd + 4;
    const nextBoundary = buffer.indexOf(partDelim, bodyStart);
    if (nextBoundary === -1) break;
    const body = buffer.slice(bodyStart, nextBoundary);
    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/i);
    if (nameMatch?.[1] === 'file' && filenameMatch) {
      return { filename: filenameMatch[1], data: body };
    }
    pos = nextBoundary + partDelim.length;
  }
  return null;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function getStoredPasswordHash() {
  try {
    const sql = getSql();
    if (sql) {
      await ensureCloudSchema();
      const rows = await sql`SELECT value FROM odessa_kv WHERE key = 'admin_password_hash'`;
      if (rows.length > 0) {
        const raw = rows[0].value;
        return typeof raw === 'string' ? raw : String(raw);
      }
    }
  } catch {}
  if (ADMIN_PASSWORD_HASH) return ADMIN_PASSWORD_HASH;
  return DEFAULT_PASSWORD_HASH;
}

async function storePasswordHash(hash) {
  const sql = getSql();
  if (!sql) throw Object.assign(new Error('Database nao configurado'), { statusCode: 503 });
  await ensureCloudSchema();
  await sql`
    INSERT INTO odessa_kv (key, value, updated_at)
    VALUES ('admin_password_hash', ${JSON.stringify(hash)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

async function verifyCredentials(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!safeEqual(normalizedEmail, ADMIN_EMAIL)) return false;
  const normalizedPassword = String(password || '').trim();
  const incomingHash = hashPassword(normalizedPassword);
  const storedHash = await getStoredPasswordHash();
  return safeEqual(incomingHash, storedHash);
}

function createSessionToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      sub: 'admin',
      role: 'admin',
      iat: now,
      exp: now + SESSION_TTL_SECONDS,
      nonce: crypto.randomBytes(16).toString('base64url'),
    }),
  );
  return `${payload}.${sign(payload)}`;
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function parseSessionToken(token) {
  if (!token || !token.includes('.') || !SESSION_SECRET) return null;
  const [payload, signature] = token.split('.');
  if (!safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.sub !== 'admin' || data.role !== 'admin') return null;
    if (Number(data.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function getSession(req) {
  const cookies = parseCookies(req);
  const cookieSession = parseSessionToken(cookies[SESSION_COOKIE_NAME]);
  if (cookieSession) return cookieSession;

  const authorization = String(req.headers.authorization || '');
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() === 'bearer') return parseSessionToken(token);
  return null;
}

function setSessionCookie(res, token) {
  const secure = process.env.ODESSA_COOKIE_SECURE !== 'false';
  const sameSite = process.env.ODESSA_COOKIE_SAMESITE || 'Lax';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=${sameSite}; ${secure ? 'Secure;' : ''}`,
  );
}

function clearSessionCookie(res) {
  const secure = process.env.ODESSA_COOKIE_SECURE !== 'false';
  const sameSite = process.env.ODESSA_COOKIE_SAMESITE || 'Lax';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=${sameSite}; ${secure ? 'Secure;' : ''}`,
  );
}

function pathParts(req) {
  const raw = req.query.path;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.split('/').filter(Boolean);
  return [];
}

function routePath(req) {
  return `/${pathParts(req).join('/')}`;
}

function cloudState() {
  const lastSeenAt = cloudStore.agentStatus?.lastSeenAt || null;
  const agentConnected = Boolean(lastSeenAt && Date.now() - Date.parse(lastSeenAt) < AGENT_STALE_MS);
  return {
    mode: 'cloud',
    agentRequired: true,
    agentConnected,
    agent: cloudStore.agentStatus,
    message: agentConnected
      ? 'Odessa Cloud esta online e o Odessa Agent esta conectado.'
      : 'Odessa Cloud esta online. OBS, captura, OCR local e videos locais precisam de um Odessa Agent conectado.',
  };
}

function cloudCapabilities() {
  return {
    databaseConfigured: Boolean(Database),
    blobConfigured: true,
  };
}

function defaultObsSettings() {
  const publicUrl =
    process.env.ODESSA_PUBLIC_URL ||
    process.env.HOSTINGER_APP_URL ||
    'http://localhost:3000';
  return {
    enabled: true,
    websocketUrl: 'ws://127.0.0.1:4455',
    websocketPassword: '',
    ocrSourceName: 'Odessa Chat OCR',
    chatSourceName: 'Odessa Chat OCR',
    stageSourceName: 'Odessa Stage Overlay',
    stageUrl: `${publicUrl.replace(/\/$/, '')}/#overlay`,
    startupSceneName: 'Odessa START',
    liveSceneName: 'Odessa LIVE',
    transmissionMode: 'stream',
    canvasWidth: 1080,
    canvasHeight: 1920,
    sceneWhitelist: ['Cena', 'Odessa START', 'Odessa LIVE'],
    allowedScenes: ['Cena', 'Odessa START', 'Odessa LIVE'],
  };
}

function getDb() {
  if (!Database) return null;
  if (!cloudDbState.db) {
    try {
      const db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.exec(`
        CREATE TABLE IF NOT EXISTS odessa_kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        CREATE TABLE IF NOT EXISTS odessa_agent_commands (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'queued',
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          claimed_at TEXT,
          completed_at TEXT,
          result TEXT
        );
        CREATE TABLE IF NOT EXISTS odessa_agent_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT,
          command_id TEXT,
          payload TEXT NOT NULL DEFAULT '{}',
          received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
      `);
      cloudDbState.db = db;
    } catch {
      return null;
    }
  }
  return cloudDbState.db;
}

function getCloudValue(key) {
  try {
    const db = getDb();
    if (!db) return null;
    const row = db.prepare('SELECT value, updated_at FROM odessa_kv WHERE key = ? LIMIT 1').get(key);
    if (!row) return null;
    return { value: JSON.parse(row.value), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

function setCloudValue(key, value) {
  const db = getDb();
  if (!db) {
    const error = new Error('Banco de dados nao configurado. Execute: npm install better-sqlite3');
    error.statusCode = 503;
    throw error;
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO odessa_kv (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), now);
  return now;
}

function stateFromAgentStatus(agentStatus) {
  const lastSeenAt = agentStatus?.lastSeenAt || null;
  const agentConnected = Boolean(lastSeenAt && Date.now() - Date.parse(lastSeenAt) < AGENT_STALE_MS);
  return {
    mode: 'cloud',
    agentRequired: true,
    agentConnected,
    agent: agentStatus,
    message: agentConnected
      ? 'Odessa Cloud esta online e o Odessa Agent esta conectado.'
      : 'Odessa Cloud esta online. OBS, captura, OCR local e videos locais precisam de um Odessa Agent conectado.',
  };
}

function getAgentStatus() {
  const stored = getCloudValue('agent_status');
  const status = stored?.value || cloudStore.agentStatus || null;
  if (status) cloudStore.agentStatus = status;
  return status;
}

function saveAgentStatus(status) {
  cloudStore.agentStatus = status;
  try { setCloudValue('agent_status', status); } catch { /* best-effort */ }
}

function loadObsSettings() {
  const stored = getCloudValue('obs_settings');
  const agentStatus = getAgentStatus();
  const agentLayout = agentStatus?.health?.obs?.layout || {};
  const settings = {
    ...defaultObsSettings(),
    ...(agentLayout || {}),
    ...(stored?.value || {}),
  };
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(String(settings.stageUrl || ''))) {
    settings.stageUrl = defaultObsSettings().stageUrl;
  }
  return settings;
}

function saveObsSettings(settings) {
  const current = loadObsSettings();
  const next = { ...current, ...(settings || {}) };
  setCloudValue('obs_settings', next);
  return next;
}

function commandFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    payload: row.payload || {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function enqueueAgentCommand(command) {
  const normalized = {
    id: command.id || crypto.randomUUID(),
    type: command.type || 'noop',
    payload: command.payload || {},
    createdAt: command.createdAt || new Date().toISOString(),
  };
  const db = getDb();
  if (!db) {
    cloudStore.commandQueue.push(normalized);
    return { command: normalized, queueSize: cloudStore.commandQueue.length, persisted: false };
  }
  db.prepare(`
    INSERT INTO odessa_agent_commands (id, type, payload, status, created_at)
    VALUES (?, ?, ?, 'queued', ?)
    ON CONFLICT(id) DO UPDATE SET type=excluded.type, payload=excluded.payload,
      status='queued', created_at=excluded.created_at, claimed_at=NULL, completed_at=NULL, result=NULL
  `).run(normalized.id, normalized.type, JSON.stringify(normalized.payload), normalized.createdAt);
  const count = db.prepare("SELECT COUNT(*) AS n FROM odessa_agent_commands WHERE status='queued'").get();
  return { command: normalized, queueSize: Number(count?.n || 0), persisted: true };
}

function claimNextAgentCommand() {
  const db = getDb();
  if (!db) return { command: cloudStore.commandQueue.shift() || null, queueSize: cloudStore.commandQueue.length };
  const claim = db.transaction(() => {
    const row = db.prepare("SELECT id,type,payload,created_at FROM odessa_agent_commands WHERE status='queued' ORDER BY created_at ASC LIMIT 1").get();
    if (!row) return { command: null, queueSize: 0 };
    const now = new Date().toISOString();
    db.prepare("UPDATE odessa_agent_commands SET status='claimed', claimed_at=? WHERE id=?").run(now, row.id);
    const count = db.prepare("SELECT COUNT(*) AS n FROM odessa_agent_commands WHERE status='queued'").get();
    return { command: commandFromRow({ ...row, payload: JSON.parse(row.payload || '{}') }), queueSize: Number(count?.n || 0) };
  });
  return claim();
}

function queuedCommandCount() {
  const db = getDb();
  if (!db) return cloudStore.commandQueue.length;
  const row = db.prepare("SELECT COUNT(*) AS n FROM odessa_agent_commands WHERE status='queued'").get();
  return Number(row?.n || 0);
}

function recordAgentEvent(event) {
  const payload = { ...event, receivedAt: new Date().toISOString() };
  cloudStore.events.push(payload);
  cloudStore.events = cloudStore.events.slice(-100);
  const db = getDb();
  if (!db) return { persisted: false };
  const commandId = event?.command?.id || event?.commandId || null;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO odessa_agent_events (kind, command_id, payload, received_at) VALUES (?,?,?,?)').run(
    event?.kind || null, commandId, JSON.stringify(payload), now
  );
  if (commandId && event?.result) {
    db.prepare("UPDATE odessa_agent_commands SET status='completed', completed_at=?, result=? WHERE id=?").run(
      now, JSON.stringify(event.result), commandId
    );
  }
  return { persisted: true };
}

function recentAgentEvents() {
  const db = getDb();
  if (!db) return cloudStore.events.slice(-20);
  const rows = db.prepare('SELECT payload FROM odessa_agent_events ORDER BY received_at DESC LIMIT 20').all();
  return rows.map((row) => { try { return JSON.parse(row.payload); } catch { return {}; } }).reverse();
}

function videoIdFromPath(pathname) {
  const name = pathname.split('/').pop() || '';
  return name.replace(/\.(mp4|webm|mov|m4v)$/i, '');
}

function videoLabelFromId(id) {
  return String(id || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function mediaTypeFromPath(pathname) {
  return /\.webm$/i.test(pathname) ? 'video/webm' : 'video/mp4';
}

function listLocalVideos() {
  try {
    const videoDir = nodePath.join(UPLOADS_DIR, 'videos');
    fs.mkdirSync(videoDir, { recursive: true });
    const files = fs.readdirSync(videoDir);
    return files
      .filter((f) => /\.(mp4|webm|mov|m4v)$/i.test(f))
      .map((f) => {
        const id = videoIdFromPath(f);
        const stat = fs.statSync(nodePath.join(videoDir, f));
        return {
          id,
          label: videoLabelFromId(id),
          group: 'local',
          description: `Local: ${f}`,
          loop: false,
          cloud: false,
          missingFile: false,
          src: `/uploads/videos/${f}`,
          url: `/uploads/videos/${f}`,
          playUrl: `/uploads/videos/${f}`,
          blobPath: f,
          size: stat.size,
          size_bytes: stat.size,
          uploadedAt: stat.mtime.toISOString(),
          contentType: mediaTypeFromPath(f),
          thumbnailStrategy: 'client-filmstrip',
        };
      });
  } catch {
    return [];
  }
}

function loadCloudConfig() {
  const stored = getCloudValue(PERSONA_CONFIG_KEY);
  return stored?.value && typeof stored.value === 'object' ? stored.value : null;
}

function configWithCloudVideos(config) {
  const safeConfig = config && typeof config === 'object' ? structuredClone(config) : {};
  const cloudVideos = listLocalVideos();
  const byId = new Map();
  for (const video of Array.isArray(safeConfig.videos) ? safeConfig.videos : []) {
    if (video?.id) byId.set(video.id, { ...video });
  }
  for (const cloudVideo of cloudVideos) {
    const existing = byId.get(cloudVideo.id);
    byId.set(cloudVideo.id, {
      ...(existing || {}),
      ...cloudVideo,
      label: existing?.label || cloudVideo.label,
      description: existing?.description || cloudVideo.description,
      loop: Boolean(existing?.loop ?? cloudVideo.loop),
    });
  }
  safeConfig.videos = Array.from(byId.values());
  safeConfig.cloudMode = true;
  safeConfig.cloudStorage = {
    ...cloudCapabilities(),
    cloudVideoCount: cloudVideos.length,
  };
  return safeConfig;
}

function getCloudWorkflow(kind) {
  const cloudConfig = loadCloudConfig();
  const config = configWithCloudVideos(
    cloudConfig || { videos: [], triggers: [], giftMap: {}, gift_map: {}, idleVideoId: null },
  );
  if (!cloudConfig && !config.videos?.length) return emptyWorkflow(kind);
  const workflow = config[`${kind}Workflow`] || config[kind] || config;
  return {
    ...emptyWorkflow(kind),
    ...workflow,
    status: kind,
    videos: Array.isArray(config.videos) ? config.videos : [],
    cloudStorage: cloudCapabilities(),
  };
}

function clipFromVideoId(videoId, options = {}) {
  const shouldLoop = Boolean(options.loop);
  return {
    nodeId: null,
    videoId,
    startSec: 0,
    endSec: null,
    transitionMs: 220,
    returnToIdle: !shouldLoop,
  };
}

function loadCloudVideoState() {
  const stored = getCloudValue('video_state');
  const config = loadCloudConfig();
  const idleVideoId = config?.idleVideoId || config?.publishedWorkflow?.idleVideoId || config?.draftWorkflow?.idleVideoId || null;
  const currentVideoId = stored?.value?.current_video_id || idleVideoId || null;
  const isIdleVideo = Boolean(currentVideoId && idleVideoId && currentVideoId === idleVideoId);
  const currentClip = currentVideoId
    ? {
        ...clipFromVideoId(currentVideoId, { loop: isIdleVideo }),
        ...(stored?.value?.currentClip || {}),
        returnToIdle: isIdleVideo ? false : stored?.value?.currentClip?.returnToIdle ?? true,
      }
    : null;
  const now = Date.now() / 1000;
  return {
    status: currentVideoId ? 'playing' : 'idle',
    current_video_id: currentVideoId,
    start_ts: stored?.value?.start_ts || now,
    server_time: now,
    currentClip,
    queue: [],
    activeNodeId: stored?.value?.activeNodeId || null,
    activeConnectionId: stored?.value?.activeConnectionId || null,
    executionMode: 'cloud',
  };
}

function saveCloudVideoState(videoId, patch = {}) {
  const config = loadCloudConfig();
  const idleVideoId = config?.idleVideoId || config?.publishedWorkflow?.idleVideoId || config?.draftWorkflow?.idleVideoId || null;
  const isIdleVideo = Boolean(videoId && idleVideoId && videoId === idleVideoId);
  const currentClip = videoId
    ? {
        ...clipFromVideoId(videoId, { loop: isIdleVideo }),
        ...(patch.currentClip || {}),
        returnToIdle: isIdleVideo ? false : patch.currentClip?.returnToIdle ?? true,
      }
    : null;
  const now = Date.now() / 1000;
  const state = {
    status: videoId ? 'playing' : 'idle',
    current_video_id: videoId || null,
    start_ts: now,
    server_time: now,
    currentClip,
    queue: [],
    activeNodeId: patch.activeNodeId || null,
    activeConnectionId: patch.activeConnectionId || null,
    executionMode: 'cloud',
  };
  setCloudValue('video_state', state);
  return state;
}

function getAgentToken(req) {
  const explicit = req.headers['x-odessa-agent-token'];
  if (explicit) return String(explicit);
  const authorization = String(req.headers.authorization || '');
  const [scheme, token] = authorization.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
}

function hasAgentAccess(req) {
  return Boolean(AGENT_TOKEN) && safeEqual(getAgentToken(req), AGENT_TOKEN);
}

async function agentResponse(req, res, path) {
  if (path === '/agent') {
    const action = String(req.query.action || 'status').replace(/_/g, '-');
    path = `/agent/${action}`;
  }

  if (path === '/agent/status') {
    const agentStatus = await getAgentStatus();
    return json(res, 200, {
      ok: true,
      queueSize: await queuedCommandCount(),
      recentEvents: await recentAgentEvents(),
      ...stateFromAgentStatus(agentStatus),
    });
  }

  if (!hasAgentAccess(req)) return json(res, 401, { detail: 'Invalid agent token' });

  if (path === '/agent/heartbeat' && req.method === 'POST') {
    const body = await readBody(req);
    const status = {
      agentId: body.agentId || 'local-agent',
      host: body.host || null,
      version: body.version || '0.1.0',
      capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
      health: body.health || {},
      lastSeenAt: new Date().toISOString(),
    };
    await saveAgentStatus(status);
    return json(res, 200, { ok: true, ...stateFromAgentStatus(status) });
  }

  if (path === '/agent/commands/next' || path === '/agent/commands-next') {
    const next = await claimNextAgentCommand();
    return json(res, 200, { ok: true, ...next });
  }

  if (path === '/agent/events' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await recordAgentEvent(body);
    return json(res, 202, { ok: true, ...result });
  }

  return json(res, 404, { detail: 'Agent endpoint not found', path });
}

function emptyWorkflow(status = 'draft') {
  return {
    workflowId: `cloud-${status}`,
    workflowName: `Odessa Cloud ${status === 'published' ? 'Published' : 'Draft'}`,
    version: 1,
    status,
    idleVideoId: null,
    flowNodes: [],
    flowConnections: [],
    triggers: [],
    stageSettings: {},
    mediaTracks: [],
    transitions: [],
    updatedAt: new Date().toISOString(),
    lastValidation: {
      ok: true,
      warnings: ['Nenhum agent local conectado para executar OBS/captura.'],
      errors: [],
    },
  };
}

async function protectedResponse(req, res, path) {
  if (path === '/api/v1/misc/health' || path === '/misc/health') {
    return json(res, 200, {
      status: 'ok',
      service: 'odessa-cloud-api',
      ...cloudCapabilities(),
      ...cloudState(),
    });
  }

  if (
    path === '/cloud/storage/status' ||
    path === '/api/cloud/storage/status' ||
    path === '/v1/cloud/storage/status' ||
    path === '/api/v1/cloud/storage/status'
  ) {
    let cloudVideoCount = 0;
    let dbReady = false;
    let dbError = null;
    let blobError = null;
    try {
      dbReady = await ensureCloudSchema();
    } catch (error) {
      dbError = error.message;
    }
    try {
      cloudVideoCount = (await listLocalVideos()).length;
    } catch (error) {
      blobError = error.message;
    }
    return json(res, 200, {
      ok: true,
      databaseReady: dbReady,
      cloudVideoCount,
      dbError,
      blobError,
      ...cloudCapabilities(),
      ...cloudState(),
    });
  }

  if (
    path === '/cloud/config' ||
    path === '/api/cloud/config' ||
    path === '/v1/cloud/config' ||
    path === '/api/v1/cloud/config'
  ) {
    if (req.method === 'GET') {
      const stored = await getCloudValue(PERSONA_CONFIG_KEY);
      const config = stored?.value || null;
      return json(res, 200, {
        ok: true,
        configured: Boolean(config),
        updatedAt: stored?.updatedAt || null,
        summary: config
          ? {
              videos: Array.isArray(config.videos) ? config.videos.length : 0,
              triggers: Array.isArray(config.triggers) ? config.triggers.length : 0,
              flowNodes: Array.isArray(config.flowNodes) ? config.flowNodes.length : 0,
              flowConnections: Array.isArray(config.flowConnections) ? config.flowConnections.length : 0,
              hasDraftWorkflow: Boolean(config.draftWorkflow),
              hasPublishedWorkflow: Boolean(config.publishedWorkflow),
            }
          : null,
        config,
        ...cloudCapabilities(),
      });
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readBody(req);
      const config = body.config && typeof body.config === 'object' ? body.config : body;
      const updatedAt = await setCloudValue(PERSONA_CONFIG_KEY, config);
      return json(res, 200, {
        ok: true,
        updatedAt,
        summary: {
          videos: Array.isArray(config.videos) ? config.videos.length : 0,
          triggers: Array.isArray(config.triggers) ? config.triggers.length : 0,
          flowNodes: Array.isArray(config.flowNodes) ? config.flowNodes.length : 0,
          flowConnections: Array.isArray(config.flowConnections) ? config.flowConnections.length : 0,
          hasDraftWorkflow: Boolean(config.draftWorkflow),
          hasPublishedWorkflow: Boolean(config.publishedWorkflow),
        },
      });
    }
    return json(res, 405, { detail: 'Method not allowed' });
  }

  if (path.includes('/video/upload') && req.method === 'POST') {
    const ct = req.headers['content-type'] || '';
    const rawBuffer = await readRawBody(req);
    const file = extractFileFromMultipart(rawBuffer, ct);
    if (!file) {
      return json(res, 400, { detail: 'Nenhum arquivo encontrado na requisicao.' });
    }
    if (!/\.(mp4|webm|mov|m4v)$/i.test(file.filename)) {
      return json(res, 400, { detail: 'Formato invalido. Envie MP4, WebM ou MOV.' });
    }
    const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const videoDir = nodePath.join(UPLOADS_DIR, 'videos');
    fs.mkdirSync(videoDir, { recursive: true });
    fs.writeFileSync(nodePath.join(videoDir, safeName), file.data);
    const publicUrl = `/uploads/videos/${safeName}`;
    const videoId = videoIdFromPath(safeName);
    return json(res, 200, { ok: true, videoId, url: publicUrl, blobPath: safeName });
  }

  if (path.endsWith('/video/config') || path === '/api/v1/video/config' || path === '/video/config') {
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readBody(req);
      const config = body.config && typeof body.config === 'object' ? body.config : body;
      const updatedAt = await setCloudValue(PERSONA_CONFIG_KEY, config);
      return json(res, 200, {
        status: 'success',
        ok: true,
        updatedAt,
        cloudMode: true,
        summary: {
          videos: Array.isArray(config.videos) ? config.videos.length : 0,
          triggers: Array.isArray(config.triggers) ? config.triggers.length : 0,
          flowNodes: Array.isArray(config.flowNodes) ? config.flowNodes.length : 0,
          flowConnections: Array.isArray(config.flowConnections) ? config.flowConnections.length : 0,
          hasDraftWorkflow: Boolean(config.draftWorkflow),
          hasPublishedWorkflow: Boolean(config.publishedWorkflow),
        },
        ...cloudCapabilities(),
      });
    }
    const cloudConfig = await loadCloudConfig();
    const config = await configWithCloudVideos(
      cloudConfig || {
        videos: [],
        triggers: [],
        giftMap: {},
        gift_map: {},
        idleVideoId: null,
      },
    );
    return json(res, 200, {
      ...config,
      ...cloudState(),
    });
  }

  if (path.includes('/video/force') && req.method === 'POST') {
    const body = await readBody(req);
    const videoId = body.videoId || body.video_id || body.id || null;
    if (videoId) {
      await saveCloudVideoState(videoId, {
        activeNodeId: body.activeNodeId || null,
        activeConnectionId: body.activeConnectionId || null,
        currentClip: body.currentClip || null,
      });
    }
    const queued = await enqueueAgentCommand({
      type: 'video.force',
      payload: {
        ...body,
        videoId,
        executionMode: body.executionMode || 'cloud-agent',
      },
    });
    return json(res, 202, {
      status: 'queued',
      accepted: true,
      simulated: false,
      ...queued,
      ...cloudState(),
    });
  }

  if (path.includes('/video/play/')) {
    const videoId = decodeURIComponent(path.split('/video/play/').pop() || '');
    const match = (await listLocalVideos()).find((video) => video.id === videoId);
    if (!match) return json(res, 404, { detail: `Video '${videoId}' nao encontrado no Vercel Blob.` });
    res.statusCode = 302;
    res.setHeader('Location', match.url);
    res.end();
    return undefined;
  }

  if (path.endsWith('/video/state') || path === '/api/v1/video/state' || path === '/video/state') {
    return json(res, 200, {
      ...(await loadCloudVideoState()),
      ...cloudState(),
    });
  }

  if (path.includes('/video/advance') && req.method === 'POST') {
    const config = await loadCloudConfig();
    const idleVideoId = config?.idleVideoId || config?.publishedWorkflow?.idleVideoId || config?.draftWorkflow?.idleVideoId || null;
    return json(res, 200, {
      ok: true,
      ...(await saveCloudVideoState(idleVideoId)),
      ...cloudState(),
    });
  }

  if (path.includes('/automation/logs')) return json(res, 200, []);
  if (path.includes('/automation/next-action')) return json(res, 200, { action: null, ...cloudState() });
  if (path.includes('/automation/') && req.method === 'POST') {
    const body = await readBody(req);
    const queued = await enqueueAgentCommand({
      type: body.type || 'automation.event',
      payload: body,
    });
    return json(res, 202, { accepted: true, simulated: false, ...queued, ...cloudState() });
  }

  if (path === '/workflow/draft' || path === '/api/v1/workflow/draft' || path === '/v1/workflow/draft') {
    return json(res, 200, await getCloudWorkflow('draft'));
  }
  if (path === '/workflow/published' || path === '/api/v1/workflow/published' || path === '/v1/workflow/published') {
    return json(res, 200, await getCloudWorkflow('published'));
  }
  if (path.startsWith('/workflow/') || path.startsWith('/api/v1/workflow/')) {
    return json(res, 200, { ok: true, simulated: true, workflow: emptyWorkflow(), ...cloudState() });
  }

  if (path.startsWith('/obs/') || path.startsWith('/api/v1/obs/')) {
    const parts = path.split('/').filter(Boolean);
    const obsIndex = parts.indexOf('obs');
    const actionPath = parts.slice(obsIndex + 1).join('/') || 'command';
    const action = actionPath.split('/').pop() || actionPath;

    if (req.method === 'GET' && action === 'settings') {
      return json(res, 200, {
        ok: true,
        settings: await loadObsSettings(),
        cloudMode: true,
        executedBy: 'cloud-agent',
        error: null,
        ...cloudState(),
      });
    }

    if (req.method === 'GET' && (action === 'health' || action === 'live-health')) {
      const agentStatus = await getAgentStatus();
      const obs = agentStatus?.health?.obs || {};
      return json(res, 200, {
        ok: Boolean(obs.ok),
        connected: Boolean(obs.connected || agentStatus?.health?.obsConnected),
        sourceReady: Boolean(obs.sourceReady || obs.chatSourceReady || obs.stageSourceReady),
        screenshotReady: Boolean(obs.screenshotReady),
        currentScene: obs.currentScene || null,
        availableScenes: obs.availableScenes || obs.chatSourceNames || [],
        allowedScenes: obs.allowedScenes || obs.layout?.allowedScenes || defaultObsSettings().allowedScenes,
        layout: obs.layout || (await loadObsSettings()),
        error: obs.error || null,
        cloudMode: true,
        executedBy: 'cloud-agent',
        ...stateFromAgentStatus(agentStatus),
      });
    }

    if (req.method === 'GET' && action === 'scenes') {
      const agentStatus = await getAgentStatus();
      const obs = agentStatus?.health?.obs || {};
      const settings = await loadObsSettings();
      const scenes = obs.availableScenes || obs.chatSourceNames || [];
      return json(res, 200, {
        ok: Boolean(agentStatus),
        scenes,
        availableScenes: scenes,
        allowedScenes: obs.allowedScenes || settings.allowedScenes || [],
        currentScene: obs.currentScene || null,
        cloudMode: true,
        executedBy: 'cloud-agent',
        ...stateFromAgentStatus(agentStatus),
      });
    }

    if (req.method === 'GET' && action === 'live-plan') {
      const settings = await loadObsSettings();
      const agentStatus = await getAgentStatus();
      return json(res, 200, {
        executionMode: 'cloud-agent',
        settings,
        steps: [
          { id: 'health', label: 'Verificar saude do OBS', enabled: true, blocked: !agentStatus },
          { id: 'setup', label: 'Preparar cena da live', enabled: true, blocked: !agentStatus },
          { id: 'stage', label: 'Colocar palco ao vivo', enabled: true, blocked: !agentStatus },
        ],
        risks: agentStatus ? [] : ['Odessa Agent local precisa estar conectado para executar OBS.'],
        health: agentStatus?.health?.obs || null,
        error: null,
        cloudMode: true,
        ...stateFromAgentStatus(agentStatus),
      });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (action === 'settings') {
        const settings = await saveObsSettings(body);
        const queued = await enqueueAgentCommand({
          type: 'obs.configure',
          payload: settings,
        });
        return json(res, 200, {
          ok: true,
          status: 'queued',
          accepted: true,
          settings,
          ...queued,
          cloudMode: true,
          executedBy: 'cloud-agent',
          error: null,
          ...cloudState(),
        });
      }

      if (actionPath === 'start-live/dry-run') {
        const agentStatus = await getAgentStatus();
        return json(res, 200, {
          ok: true,
          simulated: true,
          executionMode: 'simulated',
          steps: [
            { id: 'health', label: 'Verificar saude do OBS', enabled: true, blocked: !agentStatus },
            { id: 'setup', label: 'Preparar cena da live', enabled: body.prepareObs !== false, blocked: !agentStatus },
            { id: 'stage', label: 'Colocar palco ao vivo', enabled: body.showStage !== false, blocked: !agentStatus },
            { id: 'automation', label: 'Iniciar automacao do fluxo', enabled: body.startAutomation !== false, blocked: false },
          ],
          risks: agentStatus ? [] : ['Odessa Agent local precisa estar conectado para executar OBS.'],
          ...stateFromAgentStatus(agentStatus),
        });
      }

      if (actionPath === 'show-start' || actionPath === 'show_start' || actionPath === 'start-live') {
        const config = await loadCloudConfig();
        const idleVideoId = config?.idleVideoId || config?.publishedWorkflow?.idleVideoId || config?.draftWorkflow?.idleVideoId || null;
        if (idleVideoId) await saveCloudVideoState(idleVideoId);
      }

      const queued = await enqueueAgentCommand({
        type:
          actionPath === 'start-live'
            ? 'live.start'
            : actionPath === 'setup-live-scene'
              ? 'obs.setup_live_scene'
              : `obs.${actionPath.replace(/\//g, '.').replace(/-/g, '_')}`,
        payload: body,
      });
      return json(res, 202, {
        ok: true,
        status: 'queued',
        accepted: true,
        simulated: false,
        cloudMode: true,
        executedBy: 'cloud-agent',
        ...queued,
        ...cloudState(),
      });
    }
    return json(res, 200, {
      ok: false,
      connected: false,
      sourceReady: false,
      simulated: true,
      ...cloudState(),
    });
  }

  if (path.startsWith('/ocr/') || path.startsWith('/api/v1/ocr/')) {
    return json(res, 202, { ok: false, simulated: true, text: '', lines: [], ...cloudState() });
  }

  if (path.startsWith('/memory/') || path.startsWith('/api/v1/memory/')) {
    return json(res, 200, { profiles: [], items: [], context: null, ...cloudState() });
  }

  if (path.startsWith('/conversations/') || path.startsWith('/api/v1/conversations/')) {
    return json(res, 200, { conversations: [], messages: [], ...cloudState() });
  }

  if (path.startsWith('/ai/') || path.startsWith('/api/v1/ai/')) {
    return json(res, 202, { response: '', provider: 'cloud-placeholder', ...cloudState() });
  }

  if (path.startsWith('/tts/') || path.startsWith('/api/v1/tts/')) {
    return json(res, 202, { ok: false, audioUrl: null, ...cloudState() });
  }

  if (path.startsWith('/webhooks')) return json(res, 200, { webhooks: [], ...cloudState() });

  return json(res, 501, {
    detail: 'Endpoint ainda nao implementado no Odessa Cloud.',
    path,
    ...cloudState(),
  });
}

export default async function handler(req, res) {
  let path = routePath(req);
  if ((path === '/' || path === '/agent') && req.query.obsAction) {
    path = `/obs/${String(req.query.obsAction).replace(/^\/+/, '')}`;
  }
  if (path === '/' && req.query.action) {
    path = '/agent';
  }
  if (path === '/obs' && req.query.action) {
    path = `/obs/${String(req.query.action).replace(/^\/+/, '')}`;
  }

  if (path === '/health' || path === '/') {
    return json(res, 200, {
      status: 'ok',
      service: 'odessa-cloud-api',
      ...cloudCapabilities(),
      ...cloudState(),
    });
  }

  if (path === '/auth/login' && req.method === 'POST') {
    clearSessionCookie(res);
    return json(res, 200, { authenticated: true, role: 'admin', sessionToken: '', authBuild: 'auth-disabled-2026-05-16', authDisabled: true });
  }

  if (path === '/auth/change-password' && req.method === 'POST') {
    return json(res, 200, { ok: true, authDisabled: true, message: 'Login desativado; nao ha senha para alterar.' });
  }

  if (path === '/auth/debug' && req.method === 'GET') {
    return json(res, 200, { authBuild: 'auth-disabled-2026-05-16', enabled: false, databaseConfigured: Boolean(DATABASE_URL) });
  }

  if (path === '/auth/logout') {
    clearSessionCookie(res);
    return json(res, 200, { authenticated: false });
  }

  if (path === '/auth/me') {
    return json(res, 200, { authenticated: true, role: 'admin', authDisabled: true });
  }

  const publicVideoRead =
    req.method === 'GET' &&
    (path.endsWith('/video/state') ||
      path === '/api/v1/video/state' ||
      path === '/video/state' ||
      path.includes('/video/play/'));
  const publicOverlayAdvance = req.method === 'POST' && path.includes('/video/advance');
  if (publicVideoRead || publicOverlayAdvance) {
    try {
      return await protectedResponse(req, res, path);
    } catch (error) {
      return json(res, error.statusCode || 500, {
        detail: error.message || 'Erro inesperado no Odessa Cloud.',
        ...cloudCapabilities(),
      });
    }
  }

  if (path === '/agent' || path.startsWith('/agent/')) {
    const action = path === '/agent' ? String(req.query.action || '').replace(/_/g, '-') : '';
    if ((path === '/agent/commands' || action === 'commands') && req.method === 'POST') {
      const body = await readBody(req);
      const queued = await enqueueAgentCommand({
        id: body.id || crypto.randomUUID(),
        type: body.type || 'noop',
        payload: body.payload || {},
      });
      return json(res, 202, { ok: true, ...queued });
    }
    return agentResponse(req, res, path);
  }

  try {
    return await protectedResponse(req, res, path);
  } catch (error) {
    return json(res, error.statusCode || 500, {
      detail: error.message || 'Erro inesperado no Odessa Cloud.',
      ...cloudCapabilities(),
    });
  }
}
