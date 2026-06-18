/**
 * api/ocr/test-zone.js
 * ─────────────────────
 * POST /api/ocr/test-zone
 *
 * Dry-run de OCR em uma zona específica:
 *   · Recebe texto de amostra + config da zona (coordenadas, role)
 *   · Parseia o texto exatamente como o /ocr/ingest faria para aquela zona
 *   · Roda o matching de gatilhos SEM disparar nada (dry-run)
 *   · Retorna: o que foi parseado, quais gatilhos combinariam, etc.
 *
 * Útil para validar zona antes de ir ao ar.
 * Self-contained — sem imports do app-code.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));

// ── KV store (duplicado de ingest.js) ─────────────────────────────────────
const SESSION_COOKIE_NAME  = 'odessa_admin_session';
const SESSION_SECRET       = process.env.ODESSA_SESSION_SECRET || 'odessa-hostinger-session-secret-v1-change-in-env';
const PERSONA_CONFIG_KEY   = 'persona_config';
const DEFAULT_ADMIN_EMAIL  = 'lucasbatista.c.l@gmail.com';
const DEFAULT_PASSWORD_HASH = '';
const ADMIN_EMAIL          = (process.env.ODESSA_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();

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
function getCloudValue(key) {
  try {
    const entry = readKv()[key];
    return entry ? { value: entry.value } : null;
  } catch { return null; }
}
function loadCloudConfig() {
  const stored = getCloudValue(PERSONA_CONFIG_KEY);
  return stored?.value && typeof stored.value === 'object' ? stored.value : null;
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
  const cookieSession = parseSessionToken(cookies[SESSION_COOKIE_NAME]);
  if (cookieSession) return cookieSession;
  const auth = String(req.headers.authorization || '');
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() === 'bearer') return parseSessionToken(token);
  return null;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 512_000) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ── Gift parser (espelhado de ingest.js) ─────────────────────────────────
const GIFT_VERB_RE  = /^([^@\s][^:]{1,40}?)\s+(?:enviou|mandou|presenteou\s+com|sent)\s+(.+?)(?:\s+[x×]\s*(\d+))?\s*$/i;
const GIFT_TIKTOK_RE = /^(.{2,40}?)\s+([^\s]{1,12})\s+[x×]\s*(\d+)\s*$/i;
const OCR_EMOJI_MAP = { o: 'heart', '0': 'heart', v: 'heart', e: 'heart', j: 'heart', '"': 'heart', "'": 'heart', d: 'diamond', r: 'rose', f: 'follow', l: 'like' };

function normaliseGiftKey(raw, fromVerbPattern = false) {
  const s = raw.trim();
  if (s.length === 1) return OCR_EMOJI_MAP[s.toLowerCase()] ?? (fromVerbPattern ? 'heart' : s);
  return s;
}

/**
 * Parseia uma linha de texto exatamente como o /ocr/ingest faria
 * para a zona indicada. Retorna {eventType, giftKey?, sender?, text}.
 */
function parseLine(line, zoneRole) {
  const giftVerbMatch = GIFT_VERB_RE.exec(line);
  const tiktokMatch   = !giftVerbMatch && (zoneRole === 'gifts' || line.length < 55)
    ? GIFT_TIKTOK_RE.exec(line) : null;

  if (giftVerbMatch) {
    const giftKey = normaliseGiftKey(giftVerbMatch[2], true);
    return { eventType: 'gift', giftKey, gift_key: giftKey, sender: giftVerbMatch[1].trim(), count: giftVerbMatch[3] ? parseInt(giftVerbMatch[3]) : 1 };
  }
  if (tiktokMatch) {
    const giftKey = normaliseGiftKey(tiktokMatch[2]);
    return { eventType: 'gift', giftKey, gift_key: giftKey, sender: tiktokMatch[1].trim(), count: parseInt(tiktokMatch[3]) };
  }
  // Fallback: comment/chat
  const chatMatch = /^([^:]{1,30}):\s*(.+)$/.exec(line);
  return {
    eventType: 'comment',
    sender: chatMatch ? chatMatch[1].trim() : null,
    text: chatMatch ? chatMatch[2].trim() : line,
  };
}

/**
 * Verifica se um trigger faz match dado o evento parseado.
 * Dry-run — não enfileira nada.
 */
function matchTrigger(trigger, parsed) {
  if (!trigger.enabled && trigger.enabled !== undefined) return false;
  if (trigger.eventType === 'gift' && parsed.eventType === 'gift') {
    const condKey = (trigger.conditions?.giftKey || trigger.giftKey || '').toLowerCase();
    const eventKey = (parsed.giftKey || '').toLowerCase();
    return condKey && (condKey === eventKey || eventKey.includes(condKey) || condKey.includes(eventKey));
  }
  if ((trigger.eventType === 'chat' || trigger.eventType === 'keyword') && parsed.eventType === 'comment') {
    const keyword = (trigger.conditions?.keyword || trigger.keyword || '').toLowerCase();
    const text    = (parsed.text || '').toLowerCase();
    return keyword.length > 0 && text.includes(keyword);
  }
  return false;
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const session = getSession(req);
  if (!session) return json(res, 401, { error: 'Não autenticado. Faça login primeiro.' });

  const t0 = Date.now();
  let body;
  try { body = await readBody(req); }
  catch { return json(res, 400, { error: 'Corpo inválido' }); }

  const { zone, sampleText, ocrConfig } = body ?? {};

  if (!zone || typeof zone !== 'object') {
    return json(res, 400, { error: 'zone é obrigatório' });
  }
  if (!sampleText || !String(sampleText).trim()) {
    return json(res, 400, { error: 'sampleText é obrigatório' });
  }

  // ── Validação das coordenadas da zona ──────────────────────────────────
  const zoneWarnings = [];
  const regionW = ocrConfig?.width || 1920;
  const regionH = ocrConfig?.height || 1080;
  if ((zone.width || 0) <= 0 || (zone.height || 0) <= 0) {
    zoneWarnings.push('Zona com dimensões inválidas (width/height = 0).');
  }
  if ((zone.x || 0) + (zone.width || 0) > regionW) {
    zoneWarnings.push(`Zona ultrapassa a largura da região de captura (${regionW}px).`);
  }
  if ((zone.y || 0) + (zone.height || 0) > regionH) {
    zoneWarnings.push(`Zona ultrapassa a altura da região de captura (${regionH}px).`);
  }
  const zonePx = (zone.width || 0) * (zone.height || 0);
  if (zonePx > 0 && zonePx < 2000) {
    zoneWarnings.push(`Zona muito pequena (${zonePx}px²). OCR pode ter baixa precisão.`);
  }

  // ── Parsear texto com contexto da zona ────────────────────────────────
  const lines = String(sampleText).split('\n').map(l => l.trim()).filter(l => l.length > 1);
  if (lines.length === 0) {
    return json(res, 200, {
      ok: true, dryRun: true, zone: zone.name || zone.id,
      parsed: [], matchedTriggers: [], noMatch: [],
      wouldFire: false, zoneWarnings, latencyMs: Date.now() - t0,
    });
  }

  const config   = loadCloudConfig() || {};
  const wf       = config.draftWorkflow || config.publishedWorkflow || config;
  const triggers = (wf.triggers || config.triggers || []);
  const videos   = (wf.videos   || config.videos   || []);

  const parsedLines = lines.map(line => ({ line, ...parseLine(line, zone.role) }));
  const matchedTriggers = [];
  const noMatch = [];

  for (const parsed of parsedLines) {
    const matched = triggers.filter(t => matchTrigger(t, parsed));
    if (matched.length > 0) {
      for (const t of matched) {
        const targetVideo = videos.find(v => v.id === t.videoId);
        matchedTriggers.push({
          triggerId:   t.id,
          triggerName: t.name || t.label || t.id,
          targetVideoId:   t.videoId || null,
          targetVideoLabel: targetVideo?.label || targetVideo?.name || t.videoId || null,
          line:        parsed.line,
          eventType:   parsed.eventType,
          giftKey:     parsed.giftKey || null,
          sender:      parsed.sender  || null,
        });
      }
    } else {
      noMatch.push({
        line:      parsed.line,
        eventType: parsed.eventType,
        giftKey:   parsed.giftKey || null,
        sender:    parsed.sender  || null,
        text:      parsed.text    || null,
        reason:    triggers.length === 0 ? 'no_triggers_configured' : 'no_trigger_matched',
      });
    }
  }

  return json(res, 200, {
    ok: true,
    dryRun: true,
    zone: zone.name || zone.id,
    zoneRole: zone.role,
    parsed: parsedLines.map(({ line, eventType, giftKey, sender, text }) => ({
      line, eventType, giftKey: giftKey || null, sender: sender || null, text: text || null,
    })),
    matchedTriggers,
    noMatch,
    wouldFire: matchedTriggers.length > 0,
    totalTriggers: triggers.length,
    zoneWarnings,
    latencyMs: Date.now() - t0,
  });
}
