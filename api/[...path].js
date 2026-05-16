import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { list as listBlobs } from '@vercel/blob';

const SESSION_COOKIE_NAME = 'odessa_admin_session';
const PERSONA_CONFIG_KEY = 'persona_config';
const SESSION_TTL_SECONDS = Number(process.env.ODESSA_SESSION_TTL_SECONDS || 12 * 60 * 60);
const ADMIN_PASSWORD = process.env.ODESSA_ADMIN_PASSWORD || '';
const ADMIN_PASSWORD_HASH = (process.env.ODESSA_ADMIN_PASSWORD_HASH || '').trim();
const SESSION_SECRET = process.env.ODESSA_SESSION_SECRET || '';
const AGENT_TOKEN = process.env.ODESSA_AGENT_TOKEN || '';
const AGENT_STALE_MS = Number(process.env.ODESSA_AGENT_STALE_MS || 45_000);
const DATABASE_URL = process.env.DATABASE_URL || '';
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const cloudStore = (globalThis.__ODESSA_CLOUD_STORE ||= {
  agentStatus: null,
  commandQueue: [],
  events: [],
});
const cloudDbState = (globalThis.__ODESSA_CLOUD_DB ||= {
  sql: null,
  schemaReady: false,
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

function verifyPassword(password) {
  if (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH) return false;
  if (ADMIN_PASSWORD_HASH) return safeEqual(hashPassword(password), ADMIN_PASSWORD_HASH);
  return safeEqual(password, ADMIN_PASSWORD);
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
    databaseConfigured: Boolean(DATABASE_URL),
    blobConfigured: Boolean(BLOB_READ_WRITE_TOKEN),
  };
}

function defaultObsSettings() {
  const publicUrl =
    process.env.ODESSA_PUBLIC_URL ||
    process.env.HOSTINGER_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://odessa-gules.vercel.app');
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

function getSql() {
  if (!DATABASE_URL) return null;
  if (!cloudDbState.sql) {
    cloudDbState.sql = neon(DATABASE_URL);
  }
  return cloudDbState.sql;
}

async function ensureCloudSchema() {
  const sql = getSql();
  if (!sql || cloudDbState.schemaReady) return Boolean(sql);
  await sql`
    CREATE TABLE IF NOT EXISTS odessa_kv (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS odessa_agent_commands (
      id text PRIMARY KEY,
      type text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'queued',
      created_at timestamptz NOT NULL DEFAULT now(),
      claimed_at timestamptz,
      completed_at timestamptz,
      result jsonb
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS odessa_agent_events (
      id bigserial PRIMARY KEY,
      kind text,
      command_id text,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      received_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  cloudDbState.schemaReady = true;
  return true;
}

async function getCloudValue(key) {
  const sql = getSql();
  if (!sql) return null;
  await ensureCloudSchema();
  const rows = await sql`SELECT value, updated_at FROM odessa_kv WHERE key = ${key} LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  return {
    value: row.value,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

async function setCloudValue(key, value) {
  const sql = getSql();
  if (!sql) {
    const error = new Error('DATABASE_URL nao configurado na Vercel.');
    error.statusCode = 503;
    throw error;
  }
  await ensureCloudSchema();
  const rows = await sql`
    INSERT INTO odessa_kv (key, value, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE
      SET value = excluded.value,
          updated_at = now()
    RETURNING updated_at
  `;
  const updatedAt = rows[0]?.updated_at;
  return updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
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

async function getAgentStatus() {
  const stored = await getCloudValue('agent_status');
  const status = stored?.value || cloudStore.agentStatus || null;
  if (status) cloudStore.agentStatus = status;
  return status;
}

async function saveAgentStatus(status) {
  cloudStore.agentStatus = status;
  if (!getSql()) return null;
  return setCloudValue('agent_status', status);
}

async function loadObsSettings() {
  const stored = await getCloudValue('obs_settings');
  const agentStatus = await getAgentStatus();
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

async function saveObsSettings(settings) {
  const current = await loadObsSettings();
  const next = {
    ...current,
    ...(settings || {}),
  };
  await setCloudValue('obs_settings', next);
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

async function enqueueAgentCommand(command) {
  const normalized = {
    id: command.id || crypto.randomUUID(),
    type: command.type || 'noop',
    payload: command.payload || {},
    createdAt: command.createdAt || new Date().toISOString(),
  };
  const sql = getSql();
  if (!sql) {
    cloudStore.commandQueue.push(normalized);
    return { command: normalized, queueSize: cloudStore.commandQueue.length, persisted: false };
  }
  await ensureCloudSchema();
  await sql`
    INSERT INTO odessa_agent_commands (id, type, payload, status)
    VALUES (${normalized.id}, ${normalized.type}, ${JSON.stringify(normalized.payload)}::jsonb, 'queued')
    ON CONFLICT (id) DO UPDATE
      SET type = excluded.type,
          payload = excluded.payload,
          status = 'queued',
          created_at = now(),
          claimed_at = null,
          completed_at = null,
          result = null
  `;
  const rows = await sql`SELECT count(*)::int AS count FROM odessa_agent_commands WHERE status = 'queued'`;
  return { command: normalized, queueSize: Number(rows[0]?.count || 0), persisted: true };
}

async function claimNextAgentCommand() {
  const sql = getSql();
  if (!sql) return { command: cloudStore.commandQueue.shift() || null, queueSize: cloudStore.commandQueue.length };
  await ensureCloudSchema();
  const rows = await sql`
    UPDATE odessa_agent_commands
    SET status = 'claimed',
        claimed_at = now()
    WHERE id = (
      SELECT id
      FROM odessa_agent_commands
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, created_at
  `;
  const countRows = await sql`SELECT count(*)::int AS count FROM odessa_agent_commands WHERE status = 'queued'`;
  return { command: commandFromRow(rows[0]), queueSize: Number(countRows[0]?.count || 0) };
}

async function queuedCommandCount() {
  const sql = getSql();
  if (!sql) return cloudStore.commandQueue.length;
  await ensureCloudSchema();
  const rows = await sql`SELECT count(*)::int AS count FROM odessa_agent_commands WHERE status = 'queued'`;
  return Number(rows[0]?.count || 0);
}

async function recordAgentEvent(event) {
  const payload = { ...event, receivedAt: new Date().toISOString() };
  cloudStore.events.push(payload);
  cloudStore.events = cloudStore.events.slice(-100);
  const sql = getSql();
  if (!sql) return { persisted: false };
  await ensureCloudSchema();
  const commandId = event?.command?.id || event?.commandId || null;
  await sql`
    INSERT INTO odessa_agent_events (kind, command_id, payload)
    VALUES (${event?.kind || null}, ${commandId}, ${JSON.stringify(payload)}::jsonb)
  `;
  if (commandId && event?.result) {
    await sql`
      UPDATE odessa_agent_commands
      SET status = 'completed',
          completed_at = now(),
          result = ${JSON.stringify(event.result)}::jsonb
      WHERE id = ${commandId}
    `;
  }
  return { persisted: true };
}

async function recentAgentEvents() {
  const sql = getSql();
  if (!sql) return cloudStore.events.slice(-20);
  await ensureCloudSchema();
  const rows = await sql`
    SELECT payload
    FROM odessa_agent_events
    ORDER BY received_at DESC
    LIMIT 20
  `;
  return rows.map((row) => row.payload).reverse();
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

async function listCloudVideos() {
  if (!BLOB_READ_WRITE_TOKEN) return [];
  const { blobs } = await listBlobs({ prefix: 'videos/', token: BLOB_READ_WRITE_TOKEN });
  return blobs
    .filter((blob) => /\.(mp4|webm|mov|m4v)$/i.test(blob.pathname || blob.url || ''))
    .map((blob) => {
      const id = videoIdFromPath(blob.pathname || blob.url);
      return {
        id,
        label: videoLabelFromId(id),
        group: 'cloud',
        description: `Vercel Blob: ${blob.pathname}`,
        loop: false,
        cloud: true,
        missingFile: false,
        src: blob.url,
        url: blob.url,
        playUrl: blob.url,
        blobPath: blob.pathname,
        size: blob.size,
        size_bytes: blob.size,
        uploadedAt: blob.uploadedAt,
        contentType: mediaTypeFromPath(blob.pathname || blob.url),
        thumbnailStrategy: 'client-filmstrip',
      };
    });
}

async function loadCloudConfig() {
  const stored = await getCloudValue(PERSONA_CONFIG_KEY);
  return stored?.value && typeof stored.value === 'object' ? stored.value : null;
}

async function configWithCloudVideos(config) {
  const safeConfig = config && typeof config === 'object' ? structuredClone(config) : {};
  const cloudVideos = await listCloudVideos();
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

async function getCloudWorkflow(kind) {
  const config = await loadCloudConfig();
  if (!config) return emptyWorkflow(kind);
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

async function loadCloudVideoState() {
  const stored = await getCloudValue('video_state');
  const config = await loadCloudConfig();
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

async function saveCloudVideoState(videoId, patch = {}) {
  const config = await loadCloudConfig();
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
  await setCloudValue('video_state', state);
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
    if (!getSession(req)) return json(res, 401, { detail: 'Not authenticated' });
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
      cloudVideoCount = (await listCloudVideos()).length;
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
    const match = (await listCloudVideos()).find((video) => video.id === videoId);
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
    if (!SESSION_SECRET) {
      return json(res, 500, { detail: 'ODESSA_SESSION_SECRET nao configurado na Vercel.' });
    }
    const body = await readBody(req);
    if (!verifyPassword(String(body.password || ''))) {
      return json(res, 401, { detail: 'Invalid password' });
    }
    const sessionToken = createSessionToken();
    setSessionCookie(res, sessionToken);
    return json(res, 200, { authenticated: true, role: 'admin', sessionToken });
  }

  if (path === '/auth/logout') {
    clearSessionCookie(res);
    return json(res, 200, { authenticated: false });
  }

  if (path === '/auth/me') {
    const session = getSession(req);
    if (!session) return json(res, 401, { detail: 'Not authenticated' });
    return json(res, 200, { authenticated: true, role: 'admin' });
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
      if (!getSession(req)) return json(res, 401, { detail: 'Not authenticated' });
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

  if (!getSession(req)) return json(res, 401, { detail: 'Not authenticated' });
  try {
    return await protectedResponse(req, res, path);
  } catch (error) {
    return json(res, error.statusCode || 500, {
      detail: error.message || 'Erro inesperado no Odessa Cloud.',
      ...cloudCapabilities(),
    });
  }
}
