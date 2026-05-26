/**
 * api/ocr/presets.js
 * ───────────────────
 * CRUD de presets de OCR. Todos os presets são guardados no KV store
 * sob a chave "ocr_presets" como { [name]: { zones, ocrConfig, updatedAt } }.
 *
 * GET    /api/ocr/presets           → lista todos os presets (sem conteúdo completo)
 * GET    /api/ocr/presets?name=xxx  → carrega preset específico
 * POST   /api/ocr/presets           → salva/sobrescreve preset  { name, zones, ocrConfig }
 * DELETE /api/ocr/presets?name=xxx  → apaga preset
 *
 * Self-contained — sem imports do app-code.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));

// ── KV store ───────────────────────────────────────────────────────────────
const SESSION_COOKIE_NAME   = 'odessa_admin_session';
const SESSION_SECRET        = process.env.ODESSA_SESSION_SECRET || 'odessa-hostinger-session-secret-v1-change-in-env';
const OCR_PRESETS_KEY       = 'ocr_presets';
const DEFAULT_ADMIN_EMAIL   = 'lucasbatista.c.l@gmail.com';

const HOME_DIR       = process.env.HOME || process.env.USERPROFILE || '';
const PERSISTENT_DIR = HOME_DIR && !HOME_DIR.includes('Windows')
  ? nodePath.join(HOME_DIR, 'odessa-data') : '';
const DATA_DIR = process.env.ODESSA_DATA_DIR
  || (PERSISTENT_DIR ? nodePath.join(PERSISTENT_DIR, 'data') : nodePath.join(__dirname, '..', '..', 'data'));
const KV_PATH = nodePath.join(DATA_DIR, 'kv.json');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

function readKv() {
  try { return JSON.parse(fs.readFileSync(KV_PATH, 'utf8')); } catch { return {}; }
}
function writeKv(store) {
  const tmp = KV_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, KV_PATH);
}
function getKvEntry(key) {
  try { const e = readKv()[key]; return e ?? null; } catch { return null; }
}
function setKvEntry(key, value) {
  const store = readKv();
  store[key] = { value, updatedAt: new Date().toISOString() };
  writeKv(store);
}

function loadPresets() {
  const entry = getKvEntry(OCR_PRESETS_KEY);
  const val = entry?.value ?? entry;
  return val && typeof val === 'object' && !Array.isArray(val) ? val : {};
}
function savePresets(presets) {
  setKvEntry(OCR_PRESETS_KEY, presets);
}

// ── Auth ───────────────────────────────────────────────────────────────────
function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}
function parseSessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (sign(payload) !== signature) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.sub !== 'admin' || data.role !== 'admin') return null;
    if (Number(data.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}
function getSession(req) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie || '').split(';').map(s => s.trim()).filter(Boolean)
      .map(s => { const i = s.indexOf('='); return i === -1 ? [s, ''] : [s.slice(0, i), decodeURIComponent(s.slice(i + 1))]; })
  );
  const cs = parseSessionToken(cookies[SESSION_COOKIE_NAME]);
  if (cs) return cs;
  const auth = String(req.headers.authorization || '');
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() === 'bearer') return parseSessionToken(token);
  return null;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 256_000) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
function getQueryParam(req, key) {
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get(key) ?? null;
  } catch { return null; }
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const session = getSession(req);
  if (!session) return json(res, 401, { error: 'Não autenticado.' });

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const name = getQueryParam(req, 'name');
    const presets = loadPresets();

    if (name) {
      // Load a specific preset
      const preset = presets[name];
      if (!preset) return json(res, 404, { error: `Preset "${name}" não encontrado.` });
      return json(res, 200, { ok: true, name, ...preset });
    }

    // List all presets (without full zone data — just metadata)
    const list = Object.entries(presets).map(([n, p]) => ({
      name: n,
      zoneCount: Array.isArray(p.zones) ? p.zones.length : 0,
      updatedAt: p.updatedAt || null,
    }));
    return json(res, 200, { ok: true, presets: list });
  }

  // ── POST (save/overwrite) ────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await readBody(req); }
    catch { return json(res, 400, { error: 'Corpo inválido' }); }

    const { name, zones, ocrConfig } = body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return json(res, 400, { error: 'name é obrigatório.' });
    }
    const safeName = name.trim().slice(0, 80).replace(/[^\w\s\-áéíóúàâêôãõçÁÉÍÓÚÀÂÊÔÃÕÇ]/g, '');
    if (!safeName) return json(res, 400, { error: 'Nome inválido.' });

    if (!Array.isArray(zones)) {
      return json(res, 400, { error: 'zones deve ser um array.' });
    }

    const presets = loadPresets();
    presets[safeName] = {
      zones,
      ocrConfig: ocrConfig ?? null,
      updatedAt: new Date().toISOString(),
    };
    savePresets(presets);

    return json(res, 200, {
      ok: true,
      name: safeName,
      zoneCount: zones.length,
      updatedAt: presets[safeName].updatedAt,
    });
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const name = getQueryParam(req, 'name');
    if (!name) return json(res, 400, { error: 'name é obrigatório.' });

    const presets = loadPresets();
    if (!presets[name]) return json(res, 404, { error: `Preset "${name}" não encontrado.` });

    delete presets[name];
    savePresets(presets);
    return json(res, 200, { ok: true, deleted: name });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
