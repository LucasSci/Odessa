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

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

export function readKv() {
  try { return JSON.parse(fs.readFileSync(KV_PATH, 'utf8')); }
  catch { return {}; }
}

export function writeKv(store) {
  const tmp = KV_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, KV_PATH);
}

export function getKvValue(key) {
  const kv = readKv();
  return kv[key]?.value;
}

export function setKvValue(key, value) {
  const kv = readKv();
  kv[key] = { value, updatedAt: new Date().toISOString() };
  writeKv(kv);
}

export function loadProfiles(kind) {
  const v = getKvValue(`${kind}_profiles`);
  return Array.isArray(v) ? v : [];
}

export function saveProfiles(kind, profiles) {
  setKvValue(`${kind}_profiles`, profiles);
}

function safeEqual(a, b) {
  try {
    const aBuf = Buffer.from(String(a), 'utf8');
    const bBuf = Buffer.from(String(b), 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch { return false; }
}

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

function parseSessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.sub !== 'admin' || data.role !== 'admin') return null;
    if (Number(data.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

export function getSession(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/odessa_admin_session=([^;]+)/);
  if (match) {
    const session = parseSessionToken(match[1]);
    if (session) return session;
  }
  const auth = req.headers.authorization || '';
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() === 'bearer') {
    return parseSessionToken(token);
  }
  return null;
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const data = Buffer.concat(chunks).toString('utf8');
        if (!data) return resolve({});
        resolve(JSON.parse(data));
      } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function newId() {
  return crypto.randomUUID();
}
