import crypto from 'node:crypto';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));

const SESSION_COOKIE_NAME = 'odessa_admin_session';
const PERSONA_CONFIG_KEY = 'persona_config';
const AUTH_BUILD = 'auth-2026-05-16-email-password-v3';
const SESSION_TTL_SECONDS = Number(process.env.ODESSA_SESSION_TTL_SECONDS || 12 * 60 * 60);
const DEFAULT_ADMIN_EMAIL = 'lucasbatista.c.l@gmail.com';
const DEFAULT_PASSWORD_HASH = 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f'; // 12345678
const ADMIN_EMAIL = (process.env.ODESSA_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
const _rawAdminHash = (process.env.ODESSA_ADMIN_PASSWORD_HASH || '').trim();
const ADMIN_PASSWORD_HASH = _rawAdminHash && /^[0-9a-f]{64}$/i.test(_rawAdminHash) ? _rawAdminHash : _rawAdminHash ? crypto.createHash('sha256').update(_rawAdminHash).digest('hex') : '';
const SESSION_SECRET = process.env.ODESSA_SESSION_SECRET || 'odessa-hostinger-session-secret-v1-change-in-env';
const AGENT_TOKEN = process.env.ODESSA_AGENT_TOKEN || '+jj4LlhjinNG46KhmJxqgm0g4t4JYizSmiW12g1ZJy8=';
const AGENT_STALE_MS = Number(process.env.ODESSA_AGENT_STALE_MS || 45_000);
// On Hostinger, each deploy replaces the nodejs/ directory.
// Persist data OUTSIDE the app directory so it survives deploys.
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';
const PERSISTENT_DIR = HOME_DIR && !HOME_DIR.includes('Windows')
  ? nodePath.join(HOME_DIR, 'odessa-data')
  : '';
const DATA_DIR = process.env.ODESSA_DATA_DIR || (PERSISTENT_DIR ? nodePath.join(PERSISTENT_DIR, 'data') : nodePath.join(__dirname, '..', 'data'));
const UPLOADS_DIR = process.env.ODESSA_UPLOADS_DIR || (PERSISTENT_DIR ? nodePath.join(PERSISTENT_DIR, 'uploads') : nodePath.join(__dirname, '..', 'uploads'));
const KV_PATH = nodePath.join(DATA_DIR, 'kv.json');
const MIN_PASSWORD_LENGTH = 8;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(nodePath.join(UPLOADS_DIR, 'videos'), { recursive: true }); } catch {}
const cloudStore = (globalThis.__ODESSA_CLOUD_STORE ||= {
  agentStatus: null,
  commandQueue: [],
  events: [],
});

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

function getStoredPasswordHash() {
  try {
    const stored = getCloudValue('admin_password_hash');
    if (stored?.value) return String(stored.value);
  } catch {}
  if (ADMIN_PASSWORD_HASH) return ADMIN_PASSWORD_HASH;
  return DEFAULT_PASSWORD_HASH;
}

function storePasswordHash(hash) {
  setCloudValue('admin_password_hash', hash);
}

function verifyCredentials(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!safeEqual(normalizedEmail, ADMIN_EMAIL)) return false;
  const normalizedPassword = String(password || '').trim();
  const incomingHash = hashPassword(normalizedPassword);
  const storedHash = getStoredPasswordHash();
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
    databaseConfigured: true,
    blobConfigured: true,
  };
}

function resolvePublicUrl(req) {
  if (process.env.ODESSA_PUBLIC_URL) return process.env.ODESSA_PUBLIC_URL.replace(/\/$/, '');
  if (process.env.HOSTINGER_APP_URL) return process.env.HOSTINGER_APP_URL.replace(/\/$/, '');
  if (req?.headers?.host) {
    const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
    return `${proto}://${req.headers.host}`;
  }
  return `http://localhost:${port}`;
}

function defaultObsSettings(req) {
  const publicUrl = resolvePublicUrl(req);
  const isCloud = !/(localhost|127\.0\.0\.1|::1)/.test(publicUrl);
  return {
    enabled: true,
    websocketUrl: isCloud ? 'ws://192.168.0.11:4455' : 'ws://127.0.0.1:4455',
    websocketPassword: '',
    ocrSourceName: 'Odessa Chat OCR',
    chatSourceName: 'Odessa Chat OCR',
    stageSourceName: 'Odessa Stage Overlay',
    stageUrl: `${publicUrl}/#overlay`,
    startupSceneName: 'Odessa START',
    liveSceneName: 'Odessa LIVE',
    transmissionMode: 'stream',
    canvasWidth: 1080,
    canvasHeight: 1920,
    sceneWhitelist: ['Cena', 'Odessa START', 'Odessa LIVE'],
    allowedScenes: ['Cena', 'Odessa START', 'Odessa LIVE'],
  };
}

function readKv() {
  try { return JSON.parse(fs.readFileSync(KV_PATH, 'utf8')); }
  catch { return {}; }
}

function writeKv(store) {
  const tmp = KV_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, KV_PATH);
}

function getCloudValue(key) {
  try {
    const entry = readKv()[key];
    return entry ? { value: entry.value, updatedAt: entry.updatedAt } : null;
  } catch { return null; }
}

function setCloudValue(key, value) {
  const store = readKv();
  const now = new Date().toISOString();
  store[key] = { value, updatedAt: now };
  writeKv(store);
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

function loadObsSettings(req) {
  const stored = getCloudValue('obs_settings');
  const agentStatus = getAgentStatus();
  const agentLayout = agentStatus?.health?.obs?.layout || {};
  const settings = {
    ...defaultObsSettings(req),
    ...(agentLayout || {}),
    ...(stored?.value || {}),
  };
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(String(settings.stageUrl || ''))) {
    settings.stageUrl = defaultObsSettings(req).stageUrl;
  }
  return settings;
}

function saveObsSettings(settings) {
  const current = loadObsSettings();
  const next = { ...current, ...(settings || {}) };
  setCloudValue('obs_settings', next);
  return next;
}

function enqueueAgentCommand(command) {
  const normalized = {
    id: command.id || crypto.randomUUID(),
    type: command.type || 'noop',
    payload: command.payload || {},
    createdAt: command.createdAt || new Date().toISOString(),
  };
  cloudStore.commandQueue.push(normalized);
  return { command: normalized, queueSize: cloudStore.commandQueue.length, persisted: false };
}

function claimNextAgentCommand() {
  return { command: cloudStore.commandQueue.shift() || null, queueSize: cloudStore.commandQueue.length };
}

function queuedCommandCount() {
  return cloudStore.commandQueue.length;
}

function recordAgentEvent(event) {
  const payload = { ...event, receivedAt: new Date().toISOString() };
  cloudStore.events.push(payload);
  cloudStore.events = cloudStore.events.slice(-100);
  return { persisted: false };
}

function recentAgentEvents() {
  return cloudStore.events.slice(-20);
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
  const activeWorkflow = config?.draftWorkflow || config?.publishedWorkflow || config || {};
  const flowNodes = activeWorkflow.flowNodes || config?.flowNodes || [];
  const idleVideoId = activeWorkflow.idleVideoId || config?.idleVideoId || null;
  const currentVideoId = stored?.value?.current_video_id || idleVideoId || null;
  const isIdleVideo = Boolean(currentVideoId && idleVideoId && currentVideoId === idleVideoId);
  // Resolve activeNodeId — if none stored, find the node for the current video
  let activeNodeId = stored?.value?.activeNodeId || null;
  if (!activeNodeId && currentVideoId && flowNodes.length) {
    const matchNode = flowNodes.find((n) => n.videoId === currentVideoId);
    activeNodeId = matchNode?.nodeId || null;
  }
  const matchFlowNode = activeNodeId ? flowNodes.find((n) => n.nodeId === activeNodeId) : null;
  const pb = matchFlowNode?.playback || {};
  const currentClip = currentVideoId
    ? {
        ...clipFromVideoId(currentVideoId, { loop: isIdleVideo }),
        ...(stored?.value?.currentClip || {}),
        nodeId: activeNodeId,
        startSec: pb.startSec || stored?.value?.currentClip?.startSec || 0,
        endSec: pb.endSec ?? stored?.value?.currentClip?.endSec ?? null,
        returnToIdle: isIdleVideo ? false : stored?.value?.currentClip?.returnToIdle ?? true,
        audio: matchFlowNode?.audio || stored?.value?.currentClip?.audio || { mode: 'muted', volume: 1 },
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
    activeNodeId,
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
    const agentStatus = getAgentStatus();
    return json(res, 200, {
      ok: true,
      queueSize: queuedCommandCount(),
      recentEvents: recentAgentEvents(),
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
    saveAgentStatus(status);
    return json(res, 200, { ok: true, ...stateFromAgentStatus(status) });
  }

  if (path === '/agent/commands/next' || path === '/agent/commands-next') {
    const next = claimNextAgentCommand();
    return json(res, 200, { ok: true, ...next });
  }

  if (path === '/agent/events' && req.method === 'POST') {
    const body = await readBody(req);
    const result = recordAgentEvent(body);
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
    videos: [],
    flowNodes: [],
    flowConnections: [],
    triggers: [],
    stageSettings: {},
    mediaTracks: [],
    transitions: [],
    updatedAt: new Date().toISOString(),
    cloudStorage: cloudCapabilities(),
    lastValidation: {
      ok: true,
      warnings: ['Nenhum agent local conectado para executar OBS/captura.'],
      errors: [],
    },
  };
}

async function protectedResponse(req, res, rawPath) {
  // Normalize: strip /api/v1/ or /v1/ prefix so route checks only need the short form
  const path = rawPath.replace(/^\/(api\/)?v1\//, '/');
  if (path === '/misc/health') {
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
    path === '/cloud/storage/status'
  ) {
    let cloudVideoCount = 0;
    let blobError = null;
    try {
      cloudVideoCount = listLocalVideos().length;
    } catch (error) {
      blobError = error.message;
    }
    return json(res, 200, {
      ok: true,
      databaseReady: true,
      cloudVideoCount,
      dbError: null,
      blobError,
      ...cloudCapabilities(),
      ...cloudState(),
    });
  }

  if (
    path === '/cloud/config' ||
    path === '/api/cloud/config' ||
    path === '/cloud/config'
  ) {
    if (req.method === 'GET') {
      const stored = getCloudValue(PERSONA_CONFIG_KEY);
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
      const updatedAt = setCloudValue(PERSONA_CONFIG_KEY, config);
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

  // ── Delete / archive a video ──────────────────────────
  if (path.match(/^\/video\/[^/]+\/archive$/) && req.method === 'POST') {
    const videoId = decodeURIComponent(path.split('/')[2] || '');
    if (!videoId) return json(res, 400, { detail: 'Video ID obrigatorio.' });

    // Remove from config.videos
    const config = loadCloudConfig() || {};
    if (Array.isArray(config.videos)) {
      config.videos = config.videos.filter((v) => v.id !== videoId);
    }
    // Also remove from draft/published workflows
    const cleanWorkflow = (wf) => {
      if (!wf) return wf;
      if (Array.isArray(wf.videos)) wf.videos = wf.videos.filter((v) => v.id !== videoId);
      if (Array.isArray(wf.flowNodes)) {
        const removedNodeIds = new Set(wf.flowNodes.filter((n) => n.videoId === videoId).map((n) => n.nodeId));
        wf.flowNodes = wf.flowNodes.filter((n) => n.videoId !== videoId);
        if (removedNodeIds.size > 0 && Array.isArray(wf.flowConnections)) {
          wf.flowConnections = wf.flowConnections.filter(
            (c) => !removedNodeIds.has(c.fromNodeId) && !removedNodeIds.has(c.toNodeId),
          );
        }
      }
      if (wf.idleVideoId === videoId) wf.idleVideoId = null;
      return wf;
    };
    config.draftWorkflow = cleanWorkflow(config.draftWorkflow);
    config.publishedWorkflow = cleanWorkflow(config.publishedWorkflow);
    if (config.idleVideoId === videoId) config.idleVideoId = null;
    config.updatedAt = new Date().toISOString();
    setCloudValue(PERSONA_CONFIG_KEY, config);

    // Delete the actual file from uploads
    try {
      const filePath = nodePath.join(UPLOADS_DIR, 'videos', `${videoId}.mp4`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* best effort */ }

    return json(res, 200, {
      ok: true,
      archived: true,
      videoId,
      remainingVideos: Array.isArray(config.videos) ? config.videos.length : 0,
    });
  }

  if (path === '/video/config' || path.endsWith('/video/config')) {
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readBody(req);
      const config = body.config && typeof body.config === 'object' ? body.config : body;
      const updatedAt = setCloudValue(PERSONA_CONFIG_KEY, config);
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
    const cloudConfig = loadCloudConfig();
    const config = configWithCloudVideos(
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
      saveCloudVideoState(videoId, {
        activeNodeId: body.activeNodeId || null,
        activeConnectionId: body.activeConnectionId || null,
        currentClip: body.currentClip || null,
      });
    }
    const queued = enqueueAgentCommand({
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
    const match = (listLocalVideos()).find((video) => video.id === videoId);
    if (!match) return json(res, 404, { detail: `Video '${videoId}' nao encontrado no Vercel Blob.` });
    res.statusCode = 302;
    res.setHeader('Location', match.url);
    res.end();
    return undefined;
  }

  if (path === '/video/state' || path.endsWith('/video/state')) {
    return json(res, 200, {
      ...(loadCloudVideoState()),
      ...cloudState(),
    });
  }

  if (path.includes('/video/advance') && req.method === 'POST') {
    const config = loadCloudConfig() || {};
    // Prefer the most recently edited workflow (draft first, then published, then top-level)
    const activeWorkflow = config.draftWorkflow || config.publishedWorkflow || config;
    const flowNodes = activeWorkflow.flowNodes || config.flowNodes || [];
    const flowConnections = activeWorkflow.flowConnections || config.flowConnections || [];
    const triggers = activeWorkflow.triggers || config.triggers || [];
    const idleVideoId = activeWorkflow.idleVideoId || config.idleVideoId || null;
    const currentState = getCloudValue('video_state')?.value || {};
    const activeNodeId = currentState.activeNodeId || null;

    // Find the next node via "on_end" connection from current node
    let nextVideoId = idleVideoId;
    let nextNodeId = null;
    let nextConnectionId = null;
    if (activeNodeId) {
      const outConnections = flowConnections.filter(
        (c) => c.fromNodeId === activeNodeId,
      );
      // Prefer "natural" (ao finalizar) connections — these fire when the video ends.
      // Also match on_end / video_end for legacy compat. Fall back to first connection.
      const endConnection =
        outConnections.find((c) => {
          const trigger = triggers.find((t) => t.id === c.triggerId);
          if (!trigger) return true; // connection without trigger = implicit natural transition
          const tp = trigger.type || trigger.eventType || '';
          return (
            tp === 'natural' ||
            tp === 'on_end' ||
            tp === 'ao_finalizar' ||
            tp === 'video_end' ||
            tp === 'finish'
          );
        }) || outConnections[0];
      if (endConnection) {
        const targetNode = flowNodes.find((n) => n.nodeId === endConnection.toNodeId);
        if (targetNode) {
          nextVideoId = targetNode.videoId || idleVideoId;
          nextNodeId = targetNode.nodeId;
          nextConnectionId = endConnection.id;
        }
      }
    }
    // If no next found and we're not idle, return to idle
    if (!nextNodeId && idleVideoId) {
      const idleNode = flowNodes.find((n) => n.videoId === idleVideoId);
      nextNodeId = idleNode?.nodeId || null;
    }
    // Build currentClip from the target flowNode's playback settings
    const targetFlowNode = flowNodes.find((n) => n.nodeId === nextNodeId);
    const isIdle = Boolean(nextVideoId && idleVideoId && nextVideoId === idleVideoId);
    const pb = targetFlowNode?.playback || {};
    const currentClip = nextVideoId ? {
      nodeId: nextNodeId,
      videoId: nextVideoId,
      startSec: pb.startSec || 0,
      endSec: pb.endSec || null,
      transitionMs: pb.transitionMs || 220,
      loop: isIdle || Boolean(pb.loop),
      returnToIdle: !isIdle,
      audio: targetFlowNode?.audio || { mode: 'muted', volume: 1 },
    } : null;
    const saved = saveCloudVideoState(nextVideoId, {
      activeNodeId: nextNodeId,
      activeConnectionId: nextConnectionId,
      currentClip,
    });
    return json(res, 200, {
      ok: true,
      advanced: true,
      fromNodeId: activeNodeId,
      toNodeId: nextNodeId,
      ...saved,
      ...cloudState(),
    });
  }

  // ── Manual node jump — lets the operator force a specific node/video ──
  if (path.includes('/video/play-node') && req.method === 'POST') {
    const body = await readBody(req);
    const targetNodeId = body.nodeId || null;
    const targetVideoId = body.videoId || null;
    if (!targetNodeId && !targetVideoId) {
      return json(res, 400, { detail: 'nodeId ou videoId obrigatorio.' });
    }
    const config = loadCloudConfig() || {};
    const activeWorkflow = config.draftWorkflow || config.publishedWorkflow || config;
    const flowNodes = activeWorkflow.flowNodes || config.flowNodes || [];
    const idleVideoId = activeWorkflow.idleVideoId || config.idleVideoId || null;

    let node = targetNodeId ? flowNodes.find((n) => n.nodeId === targetNodeId) : null;
    if (!node && targetVideoId) node = flowNodes.find((n) => n.videoId === targetVideoId);
    if (!node) return json(res, 404, { detail: 'No (node) encontrado no fluxo.' });

    const videoId = node.videoId || targetVideoId;
    const isIdle = Boolean(videoId && idleVideoId && videoId === idleVideoId);
    const pb = node.playback || {};
    const currentClip = {
      nodeId: node.nodeId, videoId,
      startSec: pb.startSec || 0, endSec: pb.endSec || null,
      transitionMs: pb.transitionMs || 220,
      loop: isIdle || Boolean(pb.loop),
      returnToIdle: !isIdle,
      audio: node.audio || { mode: 'muted', volume: 1 },
    };
    const saved = saveCloudVideoState(videoId, {
      activeNodeId: node.nodeId,
      activeConnectionId: null,
      currentClip,
    });
    return json(res, 200, { ok: true, jumped: true, nodeId: node.nodeId, videoId, ...saved, ...cloudState() });
  }

  // ── Video trigger endpoint — processes gift/chat/reaction events ──
  if (path.includes('/video/trigger') && req.method === 'POST') {
    const body = await readBody(req);
    const eventType = body.eventType || body.type || 'gift'; // gift | comment | reaction
    const eventData = body.data || body;
    const config = loadCloudConfig() || {};
    const activeWorkflow = config.draftWorkflow || config.publishedWorkflow || config;
    const flowNodes = activeWorkflow.flowNodes || config.flowNodes || [];
    const flowConnections = activeWorkflow.flowConnections || config.flowConnections || [];
    const triggers = activeWorkflow.triggers || config.triggers || [];
    const idleVideoId = activeWorkflow.idleVideoId || config.idleVideoId || null;

    // Find matching trigger
    const matchedTrigger = triggers.find((t) => {
      if (t.enabled === false) return false;
      const tType = t.eventType || t.type || '';
      if (tType !== eventType) return false;
      if (eventType === 'gift') {
        const giftKey = eventData.giftKey || eventData.gift_key || '';
        return !t.conditions?.giftKey || t.conditions.giftKey === giftKey || t.conditions.giftKey === '*';
      }
      if (eventType === 'comment') {
        const text = String(eventData.text || eventData.message || '').toLowerCase();
        const keyword = String(t.conditions?.keyword || '').toLowerCase();
        return !keyword || text.includes(keyword);
      }
      return true;
    });

    if (!matchedTrigger) {
      return json(res, 200, { ok: true, matched: false, message: 'Nenhum trigger correspondente.' });
    }

    // Find the connection and target node for this trigger
    const currentState = getCloudValue('video_state')?.value || {};
    const currentNodeId = currentState.activeNodeId || null;
    // Prefer connections from current node, fall back to any connection with this trigger
    const connection =
      flowConnections.find((c) => c.triggerId === matchedTrigger.id && c.fromNodeId === currentNodeId) ||
      flowConnections.find((c) => c.triggerId === matchedTrigger.id);
    const action = matchedTrigger.actions?.find((a) => a.type === 'play_video');
    const targetNodeId = connection?.toNodeId || action?.nodeId || null;
    const targetNode = targetNodeId ? flowNodes.find((n) => n.nodeId === targetNodeId) : null;
    const targetVideoId = targetNode?.videoId || action?.videoId || null;

    if (!targetVideoId) {
      return json(res, 200, { ok: true, matched: true, triggered: false, message: 'Trigger sem video de destino.' });
    }

    const isIdle = Boolean(targetVideoId === idleVideoId);
    const pb = targetNode?.playback || action?.playback || {};
    const currentClip = {
      nodeId: targetNodeId,
      videoId: targetVideoId,
      startSec: pb.startSec || 0,
      endSec: pb.endSec || null,
      transitionMs: pb.transitionMs || 220,
      loop: isIdle || Boolean(pb.loop),
      returnToIdle: connection?.returnToIdle !== false,
      audio: targetNode?.audio || action?.audio || { mode: 'muted', volume: 1 },
    };
    const saved = saveCloudVideoState(targetVideoId, {
      activeNodeId: targetNodeId,
      activeConnectionId: connection?.id || null,
      currentClip,
    });
    return json(res, 200, {
      ok: true,
      matched: true,
      triggered: true,
      trigger: { id: matchedTrigger.id, name: matchedTrigger.name, eventType: matchedTrigger.eventType },
      targetVideoId,
      targetNodeId,
      ...saved,
      ...cloudState(),
    });
  }

  if (path.includes('/automation/logs')) return json(res, 200, []);
  if (path.includes('/automation/next-action')) return json(res, 200, { action: null, ...cloudState() });
  if (path.includes('/automation/') && req.method === 'POST') {
    const body = await readBody(req);
    const queued = enqueueAgentCommand({
      type: body.type || 'automation.event',
      payload: body,
    });
    return json(res, 202, { accepted: true, simulated: false, ...queued, ...cloudState() });
  }

  // ── Workflow endpoints (Fluxo Reativo) ──────────────────────────
  if (path === '/workflow/draft') {
    if (req.method === 'GET') {
      return json(res, 200, getCloudWorkflow('draft'));
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readBody(req);
      const workflow = body.workflow && typeof body.workflow === 'object' ? body.workflow : body;
      const config = loadCloudConfig() || {};
      config.draftWorkflow = workflow;
      // Merge videos: keep existing library videos (with valid upload URLs) and add new ones from import
      if (Array.isArray(workflow.videos)) {
        const existingById = new Map((config.videos || []).map((v) => [v.id, v]));
        const cloudVideos = listLocalVideos();
        const cloudById = new Map(cloudVideos.map((v) => [v.id, v]));
        const mergedVideos = workflow.videos.map((importedVideo) => {
          // Prefer the cloud/library version (has valid upload URL), fall back to imported
          const cloud = cloudById.get(importedVideo.id);
          const existing = existingById.get(importedVideo.id);
          if (cloud) return { ...importedVideo, ...cloud, label: importedVideo.label || cloud.label };
          if (existing) return { ...importedVideo, ...existing, label: importedVideo.label || existing.label };
          return importedVideo;
        });
        // Also keep any library videos not in the import
        for (const [id, existing] of existingById) {
          if (!workflow.videos.some((v) => v.id === id)) mergedVideos.push(existing);
        }
        for (const [id, cloud] of cloudById) {
          if (!mergedVideos.some((v) => v.id === id)) mergedVideos.push(cloud);
        }
        config.videos = mergedVideos;
        workflow.videos = mergedVideos;
      }
      if (Array.isArray(workflow.triggers)) config.triggers = workflow.triggers;
      if (Array.isArray(workflow.flowNodes)) config.flowNodes = workflow.flowNodes;
      if (Array.isArray(workflow.flowConnections)) config.flowConnections = workflow.flowConnections;
      if (workflow.idleVideoId !== undefined) config.idleVideoId = workflow.idleVideoId;
      if (workflow.giftMap) config.giftMap = workflow.giftMap;
      if (workflow.gift_map) config.gift_map = workflow.gift_map;
      if (workflow.action_map) config.action_map = workflow.action_map;
      if (workflow.transitions) config.transitions = workflow.transitions;
      if (workflow.planningCanvas) config.planningCanvas = workflow.planningCanvas;
      config.updatedAt = new Date().toISOString();
      setCloudValue(PERSONA_CONFIG_KEY, config);
      return json(res, 200, {
        ok: true,
        status: 'draft',
        updatedAt: config.updatedAt,
        validation: { ok: true, warnings: [], errors: [] },
        cloudStorage: cloudCapabilities(),
      });
    }
  }
  if (path === '/workflow/published') {
    return json(res, 200, getCloudWorkflow('published'));
  }
  if (path === '/workflow/publish') {
    if (req.method === 'POST') {
      const config = loadCloudConfig() || {};
      const draft = config.draftWorkflow || {
        videos: config.videos || [],
        triggers: config.triggers || [],
        flowNodes: config.flowNodes || [],
        flowConnections: config.flowConnections || [],
        idleVideoId: config.idleVideoId || null,
        giftMap: config.giftMap || config.gift_map || {},
        action_map: config.action_map || {},
        transitions: config.transitions || [],
      };
      config.publishedWorkflow = { ...draft, status: 'published', publishedAt: new Date().toISOString() };
      config.updatedAt = new Date().toISOString();
      setCloudValue(PERSONA_CONFIG_KEY, config);
      return json(res, 200, {
        ok: true,
        status: 'published',
        publishedAt: config.publishedWorkflow.publishedAt,
        updatedAt: config.updatedAt,
        validation: { ok: true, warnings: [], errors: [] },
        cloudStorage: cloudCapabilities(),
      });
    }
  }
  if (path === '/workflow/draft/validate') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const workflow = body.workflow || {};
      const warnings = [];
      const errors = [];
      if (!Array.isArray(workflow.flowNodes) || workflow.flowNodes.length === 0) {
        warnings.push('Nenhum node no fluxo.');
      }
      if (!workflow.idleVideoId) {
        warnings.push('Nenhum video idle definido.');
      }
      if (!Array.isArray(workflow.triggers) || workflow.triggers.length === 0) {
        warnings.push('Nenhum trigger configurado.');
      }
      return json(res, 200, {
        ok: errors.length === 0,
        valid: errors.length === 0,
        warnings,
        errors,
        nodeCount: Array.isArray(workflow.flowNodes) ? workflow.flowNodes.length : 0,
        connectionCount: Array.isArray(workflow.flowConnections) ? workflow.flowConnections.length : 0,
        triggerCount: Array.isArray(workflow.triggers) ? workflow.triggers.length : 0,
      });
    }
  }
  if (path === '/workflow/draft/reset-from-published') {
    if (req.method === 'POST') {
      const config = loadCloudConfig() || {};
      if (config.publishedWorkflow) {
        config.draftWorkflow = { ...config.publishedWorkflow, status: 'draft' };
        // Sync top-level fields
        config.videos = config.publishedWorkflow.videos || config.videos || [];
        config.triggers = config.publishedWorkflow.triggers || config.triggers || [];
        config.flowNodes = config.publishedWorkflow.flowNodes || config.flowNodes || [];
        config.flowConnections = config.publishedWorkflow.flowConnections || config.flowConnections || [];
        config.idleVideoId = config.publishedWorkflow.idleVideoId || config.idleVideoId || null;
        config.updatedAt = new Date().toISOString();
        setCloudValue(PERSONA_CONFIG_KEY, config);
        return json(res, 200, { ok: true, status: 'reverted', updatedAt: config.updatedAt });
      }
      return json(res, 200, { ok: true, status: 'no-published', message: 'Nenhuma versao publicada para reverter.' });
    }
  }
  if (path === '/workflow/draft/test') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const testEvent = body.testEvent || body.event || {};
      const config = loadCloudConfig() || {};
      const triggers = config.triggers || [];
      const matchedTrigger = triggers.find((t) => {
        if (testEvent.type && t.type === testEvent.type) return true;
        if (testEvent.keyword && t.keyword && testEvent.keyword.toLowerCase().includes(t.keyword.toLowerCase())) return true;
        return false;
      });
      return json(res, 200, {
        ok: true,
        matched: Boolean(matchedTrigger),
        trigger: matchedTrigger || null,
        testEvent,
        totalTriggers: triggers.length,
      });
    }
  }
  if (path.startsWith('/workflow/')) {
    return json(res, 200, { ok: true, simulated: true, workflow: emptyWorkflow(), ...cloudState() });
  }

  if (path.startsWith('/obs/')) {
    const parts = path.split('/').filter(Boolean);
    const obsIndex = parts.indexOf('obs');
    const actionPath = parts.slice(obsIndex + 1).join('/') || 'command';
    const action = actionPath.split('/').pop() || actionPath;

    if (req.method === 'GET' && action === 'settings') {
      return json(res, 200, {
        ok: true,
        settings: loadObsSettings(req),
        cloudMode: true,
        executedBy: 'cloud-agent',
        error: null,
        ...cloudState(),
      });
    }

    if (req.method === 'GET' && (action === 'health' || action === 'live-health')) {
      const agentStatus = getAgentStatus();
      const obs = agentStatus?.health?.obs || {};
      return json(res, 200, {
        ok: Boolean(obs.ok),
        connected: Boolean(obs.connected || agentStatus?.health?.obsConnected),
        sourceReady: Boolean(obs.sourceReady || obs.chatSourceReady || obs.stageSourceReady || obs.connected),
        screenshotReady: Boolean(obs.screenshotReady || obs.connected),
        sceneSwitchReady: Boolean(obs.sceneSwitchReady || obs.connected),
        currentScene: obs.currentScene || null,
        availableScenes: obs.availableScenes || obs.chatSourceNames || [],
        allowedScenes: obs.allowedScenes || obs.layout?.allowedScenes || defaultObsSettings(req).allowedScenes,
        layout: obs.layout || (loadObsSettings(req)),
        streaming: Boolean(obs.streaming),
        recording: Boolean(obs.recording),
        error: obs.error || null,
        cloudMode: true,
        executedBy: 'cloud-agent',
        ...stateFromAgentStatus(agentStatus),
      });
    }

    if (req.method === 'GET' && action === 'scenes') {
      const agentStatus = getAgentStatus();
      const obs = agentStatus?.health?.obs || {};
      const settings = loadObsSettings(req);
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
      const settings = loadObsSettings(req);
      const agentStatus = getAgentStatus();
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
        const settings = saveObsSettings(body);
        const queued = enqueueAgentCommand({
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
        const agentStatus = getAgentStatus();
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
        const config = loadCloudConfig();
        const idleVideoId = config?.idleVideoId || config?.publishedWorkflow?.idleVideoId || config?.draftWorkflow?.idleVideoId || null;
        if (idleVideoId) saveCloudVideoState(idleVideoId);
      }

      const obsSettings = loadObsSettings(req);
      const enrichedPayload = { ...body };
      if (!enrichedPayload.transmissionMode && obsSettings.transmissionMode) {
        enrichedPayload.transmissionMode = obsSettings.transmissionMode;
      }
      if (actionPath === 'start-live') {
        if (!enrichedPayload.stageUrl && obsSettings.stageUrl) enrichedPayload.stageUrl = obsSettings.stageUrl;
        if (!enrichedPayload.startupSceneName && obsSettings.startupSceneName) enrichedPayload.startupSceneName = obsSettings.startupSceneName;
        if (!enrichedPayload.liveSceneName && obsSettings.liveSceneName) enrichedPayload.liveSceneName = obsSettings.liveSceneName;
        if (!enrichedPayload.stageSourceName && obsSettings.stageSourceName) enrichedPayload.stageSourceName = obsSettings.stageSourceName;
        if (!enrichedPayload.chatSourceName) enrichedPayload.chatSourceName = obsSettings.chatSourceName || obsSettings.ocrSourceName;
        if (!enrichedPayload.canvasWidth && obsSettings.canvasWidth) enrichedPayload.canvasWidth = obsSettings.canvasWidth;
        if (!enrichedPayload.canvasHeight && obsSettings.canvasHeight) enrichedPayload.canvasHeight = obsSettings.canvasHeight;
      }

      const queued = enqueueAgentCommand({
        type:
          actionPath === 'start-live'
            ? 'live.start'
            : actionPath === 'setup-live-scene'
              ? 'obs.setup_live_scene'
              : `obs.${actionPath.replace(/\//g, '.').replace(/-/g, '_')}`,
        payload: enrichedPayload,
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

  // ── Automation dry-run (test triggers from Fluxo Reativo) ──
  if (path === '/automation/dry-run') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const config = loadCloudConfig() || {};
      const triggers = config.triggers || [];
      const text = (body.text || '').toLowerCase();
      const kind = body.kind || body.eventType || 'chat';
      const matchedTriggers = triggers.filter((t) => {
        if (kind === 'gift' && t.eventType === 'gift') {
          const giftKey = body.metadata?.giftKey || body.metadata?.gift || '';
          return t.conditions?.giftKey === giftKey;
        }
        if (t.eventType === 'chat' || t.eventType === 'keyword') {
          const keyword = (t.conditions?.keyword || t.keyword || '').toLowerCase();
          return keyword && text.includes(keyword);
        }
        return false;
      });
      const actions = matchedTriggers.map((t) => ({
        triggerId: t.id,
        action: t.action || { type: 'play_video', videoId: t.videoId || null },
        matched: true,
      }));
      return json(res, 200, {
        ok: true,
        simulated: true,
        text: body.text,
        matchedTriggers: matchedTriggers.length,
        actions,
        totalTriggers: triggers.length,
        ...cloudState(),
      });
    }
  }

  // ── Video workflow validate (import validation) ──
  if (path === '/video/workflow/validate') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const warnings = [];
      const errors = [];
      const videos = Array.isArray(body.videos) ? body.videos : [];
      const flowNodes = Array.isArray(body.flowNodes) ? body.flowNodes : [];
      const flowConnections = Array.isArray(body.flowConnections) ? body.flowConnections : [];
      const triggers = Array.isArray(body.triggers) ? body.triggers : [];
      if (videos.length === 0) warnings.push('Nenhum video no workflow importado.');
      if (flowNodes.length === 0) warnings.push('Nenhum node no fluxo.');
      if (triggers.length === 0) warnings.push('Nenhum trigger configurado.');
      // Check for missing video references against both the import and the existing library
      const importVideoIds = new Set(videos.map((v) => v.id));
      const cloudVideos = listLocalVideos();
      const cloudVideoIds = new Set(cloudVideos.map((v) => v.id));
      const existingConfig = loadCloudConfig();
      const libraryVideoIds = new Set([
        ...(existingConfig?.videos || []).map((v) => v.id),
        ...cloudVideoIds,
      ]);
      const missingVideos = [];
      const matchedVideos = [];
      for (const node of flowNodes) {
        if (!node.videoId) continue;
        if (cloudVideoIds.has(node.videoId) || libraryVideoIds.has(node.videoId)) {
          matchedVideos.push(node.videoId);
        } else if (importVideoIds.has(node.videoId)) {
          warnings.push(`Video '${node.videoId}' esta no JSON mas nao na biblioteca. Faca upload primeiro.`);
          missingVideos.push(node.videoId);
        } else {
          warnings.push(`Node '${node.label || node.nodeId}' referencia video '${node.videoId}' que nao existe.`);
          missingVideos.push(node.videoId);
        }
      }
      return json(res, 200, {
        ok: errors.length === 0,
        valid: errors.length === 0,
        warnings,
        errors,
        summary: {
          videos: videos.length,
          flowNodes: flowNodes.length,
          flowConnections: flowConnections.length,
          triggers: triggers.length,
          idleVideoId: body.idleVideoId || null,
          matchedVideos: [...new Set(matchedVideos)],
          missingVideos: [...new Set(missingVideos)],
          libraryVideos: cloudVideos.length + (existingConfig?.videos?.length || 0),
        },
        ...cloudState(),
      });
    }
  }

  // ── Automation endpoints ──
  if (path.startsWith('/automation/')) {
    return json(res, 200, { ok: true, simulated: true, actions: [], ...cloudState() });
  }

  if (path.startsWith('/ocr/')) {
    return json(res, 202, { ok: false, simulated: true, text: '', lines: [], ...cloudState() });
  }

  if (path.startsWith('/memory/')) {
    return json(res, 200, { profiles: [], items: [], context: null, ...cloudState() });
  }

  if (path.startsWith('/conversations/')) {
    return json(res, 200, { conversations: [], messages: [], ...cloudState() });
  }

  if (path.startsWith('/ai/')) {
    return json(res, 202, { response: '', provider: 'cloud-placeholder', ...cloudState() });
  }

  if (path.startsWith('/tts/')) {
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
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '').trim();
    if (!email || !password) {
      return json(res, 400, { authenticated: false, detail: 'Email e senha sao obrigatorios.' });
    }
    if (!verifyCredentials(email, password)) {
      return json(res, 401, { authenticated: false, detail: 'Email ou senha incorretos.' });
    }
    const token = createSessionToken();
    setSessionCookie(res, token);
    return json(res, 200, { authenticated: true, role: 'admin', sessionToken: token });
  }

  if (path === '/auth/change-password' && req.method === 'POST') {
    const session = getSession(req);
    if (!session) return json(res, 401, { detail: 'Nao autenticado.' });
    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || '').trim();
    const newPassword = String(body.newPassword || '').trim();
    if (!currentPassword || !newPassword) {
      return json(res, 400, { detail: 'Senha atual e nova senha sao obrigatorias.' });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return json(res, 400, { detail: `Senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    }
    const storedHash = getStoredPasswordHash();
    if (!safeEqual(hashPassword(currentPassword), storedHash)) {
      return json(res, 401, { detail: 'Senha atual incorreta.' });
    }
    storePasswordHash(hashPassword(newPassword));
    return json(res, 200, { ok: true, message: 'Senha alterada com sucesso.' });
  }

  if (path === '/auth/debug' && req.method === 'GET') {
    const kvData = readKv();
    const kvKeys = Object.keys(kvData);
    const configStored = kvData[PERSONA_CONFIG_KEY];
    const configVideos = Array.isArray(configStored?.value?.videos) ? configStored.value.videos.length : 0;
    const configTriggers = Array.isArray(configStored?.value?.triggers) ? configStored.value.triggers.length : 0;
    const configFlowNodes = Array.isArray(configStored?.value?.flowNodes) ? configStored.value.flowNodes.length : 0;
    let uploadFiles = [];
    try {
      const videoDir = nodePath.join(UPLOADS_DIR, 'videos');
      uploadFiles = fs.existsSync(videoDir) ? fs.readdirSync(videoDir) : [];
    } catch {}
    const localVideos = listLocalVideos();
    return json(res, 200, {
      authBuild: AUTH_BUILD,
      enabled: true,
      databaseConfigured: true,
      storage: {
        dataDir: DATA_DIR,
        kvPath: KV_PATH,
        kvExists: fs.existsSync(KV_PATH),
        kvKeys,
        kvSizeBytes: fs.existsSync(KV_PATH) ? fs.statSync(KV_PATH).size : 0,
        uploadsDir: UPLOADS_DIR,
        uploadFiles,
        localVideoCount: localVideos.length,
        localVideoIds: localVideos.map(v => v.id),
        configVideoCount: configVideos,
        configTriggerCount: configTriggers,
        configFlowNodeCount: configFlowNodes,
        configUpdatedAt: configStored?.updatedAt || null,
        hasDraftWorkflow: Boolean(configStored?.value?.draftWorkflow),
        hasPublishedWorkflow: Boolean(configStored?.value?.publishedWorkflow),
      },
      env: {
        ODESSA_DATA_DIR: process.env.ODESSA_DATA_DIR || '(default)',
        ODESSA_UPLOADS_DIR: process.env.ODESSA_UPLOADS_DIR || '(default)',
        NODE_ENV: process.env.NODE_ENV || '(unset)',
        HOME: process.env.HOME || '(unset)',
        PERSISTENT_DIR: PERSISTENT_DIR || '(empty)',
        cwd: process.cwd(),
        __dirname,
      },
    });
  }

  if (path === '/auth/logout') {
    clearSessionCookie(res);
    return json(res, 200, { authenticated: false });
  }

  if (path === '/auth/me') {
    const session = getSession(req);
    if (!session) return json(res, 401, { authenticated: false });
    return json(res, 200, { authenticated: true, role: 'admin', email: ADMIN_EMAIL });
  }

  const normalizedPath = path.replace(/^\/(api\/)?v1\//, '/');
  const publicVideoRead =
    req.method === 'GET' &&
    (normalizedPath === '/video/state' ||
      normalizedPath.includes('/video/play/'));
  const publicOverlayAdvance = req.method === 'POST' && normalizedPath.includes('/video/advance');
  const publicTrigger = req.method === 'POST' && normalizedPath.includes('/video/trigger');
  const publicPlayNode = req.method === 'POST' && normalizedPath.includes('/video/play-node');
  if (publicVideoRead || publicOverlayAdvance || publicTrigger || publicPlayNode) {
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
      const queued = enqueueAgentCommand({
        id: body.id || crypto.randomUUID(),
        type: body.type || 'noop',
        payload: body.payload || {},
      });
      return json(res, 202, { ok: true, ...queued });
    }
    return agentResponse(req, res, path);
  }

  // --- All remaining routes require admin session ---
  const session = getSession(req);
  if (!session) {
    return json(res, 401, { detail: 'Nao autenticado. Faca login em /auth/login.' });
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
