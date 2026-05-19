// Self-contained workflow profiles endpoint (no imports from app code)
import crypto from 'node:crypto';
import fs from 'node:fs';
import nodePath from 'node:path';

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';
const PERSISTENT_DIR = HOME_DIR && !HOME_DIR.includes('Windows')
  ? nodePath.join(HOME_DIR, 'odessa-data')
  : '';
const DATA_DIR = process.env.ODESSA_DATA_DIR || (PERSISTENT_DIR ? nodePath.join(PERSISTENT_DIR, 'data') : nodePath.join(process.cwd(), 'data'));
const KV_PATH = nodePath.join(DATA_DIR, 'kv.json');
const SESSION_SECRET = process.env.ODESSA_SESSION_SECRET || 'odessa-hostinger-session-secret-v1-change-in-env';
const PERSONA_CONFIG_KEY = 'persona_config';

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

function readKv() {
  try { return JSON.parse(fs.readFileSync(KV_PATH, 'utf8')); } catch { return {}; }
}

function writeKv(store) {
  const tmp = KV_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, KV_PATH);
}

function loadProfiles() {
  const v = readKv()['workflow_profiles']?.value;
  return Array.isArray(v) ? v : [];
}

function saveProfilesList(profiles) {
  const kv = readKv();
  kv['workflow_profiles'] = { value: profiles, updatedAt: new Date().toISOString() };
  writeKv(kv);
}

function safeEqual(a, b) {
  try {
    const aBuf = Buffer.from(String(a), 'utf8');
    const bBuf = Buffer.from(String(b), 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch { return false; }
}

function parseToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.sub !== 'admin' || data.role !== 'admin') return null;
    if (Number(data.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

function getSession(req) {
  const cookie = (req.headers.cookie || '').match(/odessa_admin_session=([^;]+)/);
  if (cookie) { const s = parseToken(cookie[1]); if (s) return s; }
  const auth = req.headers.authorization || '';
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() === 'bearer') return parseToken(token);
  return null;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const data = Buffer.concat(chunks).toString('utf8');
        resolve(data ? JSON.parse(data) : {});
      } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function workflowProfiles(req, res) {
  const session = getSession(req);
  if (!session) return json(res, 401, { detail: 'Nao autenticado.' });

  if (req.method === 'GET') {
    return json(res, 200, { ok: true, profiles: loadProfiles(), source: 'standalone-v1' });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    if (!name) return json(res, 400, { ok: false, detail: 'Nome do perfil e obrigatorio.' });

    const profiles = loadProfiles();
    const config = readKv()[PERSONA_CONFIG_KEY]?.value || {};
    const snapshot = (body.workflow && typeof body.workflow === 'object') ? body.workflow : {
      flowNodes: config.flowNodes || [],
      flowConnections: config.flowConnections || [],
      triggers: config.triggers || [],
      idleVideoId: config.idleVideoId || null,
      videos: config.videos || [],
      giftMap: config.giftMap || config.gift_map || {},
      transitions: config.transitions || [],
      workflowName: name,
    };
    const existingIdx = profiles.findIndex((p) => p.id === body.id || p.name === name);
    const profile = {
      id: existingIdx >= 0 ? profiles[existingIdx].id : crypto.randomUUID(),
      name,
      workflow: snapshot,
      createdAt: existingIdx >= 0 ? profiles[existingIdx].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) profiles[existingIdx] = profile;
    else profiles.push(profile);
    saveProfilesList(profiles);
    return json(res, 200, { ok: true, profile, profiles, source: 'standalone-v1' });
  }

  if (req.method === 'DELETE') {
    const body = await readBody(req);
    const profiles = loadProfiles().filter((p) => p.id !== body.id);
    saveProfilesList(profiles);
    return json(res, 200, { ok: true, profiles, source: 'standalone-v1' });
  }

  return json(res, 405, { detail: 'Method not allowed' });
}
