/**
 * api/ocr/ingest.js
 * -----------------
 * Self-contained handler for POST /api/ocr/ingest.
 *
 * Receives freshly-deduped OCR lines from CaptureStudio, parses each one
 * into a structured event (gift or comment), matches active triggers, and
 * enqueues the winning trigger for the video player to consume on advance.
 *
 * Deliberately self-contained — no imports from api/[...path].js so that
 * this file always loads fresh when Hostinger routes to it.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));

// ── Constants ──────────────────────────────────────────────────────────────
const SESSION_COOKIE_NAME = 'odessa_admin_session';
const SESSION_SECRET = process.env.ODESSA_SESSION_SECRET || 'odessa-hostinger-session-secret-v1-change-in-env';
const PERSONA_CONFIG_KEY = 'persona_config';
const DEFAULT_ADMIN_EMAIL = 'lucasbatista.c.l@gmail.com';
const DEFAULT_PASSWORD_HASH = '';
const ADMIN_EMAIL = (process.env.ODESSA_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';
const PERSISTENT_DIR = HOME_DIR && !HOME_DIR.includes('Windows')
  ? nodePath.join(HOME_DIR, 'odessa-data')
  : '';
const DATA_DIR = process.env.ODESSA_DATA_DIR
  || (PERSISTENT_DIR ? nodePath.join(PERSISTENT_DIR, 'data') : nodePath.join(__dirname, '..', '..', 'data'));
const KV_PATH = nodePath.join(DATA_DIR, 'kv.json');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

// ── KV store ───────────────────────────────────────────────────────────────
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

// ── Auth ───────────────────────────────────────────────────────────────────
function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}
function parseSessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = sign(payload);
  const left = Buffer.from(String(signature));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
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
      .map(s => { const i = s.indexOf('='); return i === -1 ? [s,''] : [s.slice(0,i), decodeURIComponent(s.slice(i+1))]; })
  );
  const cookieSession = parseSessionToken(cookies[SESSION_COOKIE_NAME]);
  if (cookieSession) return cookieSession;
  const auth = String(req.headers.authorization || '');
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() === 'bearer') return parseSessionToken(token);
  return null;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────
function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1_048_576) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ── Config & trigger queue ─────────────────────────────────────────────────
function loadCloudConfig() {
  const stored = getCloudValue(PERSONA_CONFIG_KEY);
  return stored?.value && typeof stored.value === 'object' ? stored.value : null;
}
function loadTriggerQueue() {
  try {
    const stored = getCloudValue('trigger_queue');
    return Array.isArray(stored?.value) ? stored.value : [];
  } catch { return []; }
}
function saveTriggerQueue(queue) {
  setCloudValue('trigger_queue', queue);
}
function enqueueTriggerAction(entry) {
  const queue = loadTriggerQueue();
  const normalized = {
    id: entry.id || crypto.randomUUID(),
    triggerId: entry.triggerId || null,
    triggerName: entry.triggerName || null,
    eventType: entry.eventType || null,
    targetVideoId: entry.targetVideoId || null,
    targetNodeId: entry.targetNodeId || null,
    connectionId: entry.connectionId || null,
    currentClip: entry.currentClip || null,
    enqueuedAt: entry.enqueuedAt || new Date().toISOString(),
  };
  queue.push(normalized);
  saveTriggerQueue(queue);
  return { entry: normalized, queueSize: queue.length };
}
function getTriggerQueueSize() {
  try {
    const stored = getCloudValue('trigger_queue');
    return Array.isArray(stored?.value) ? stored.value.length : 0;
  } catch { return 0; }
}

// ── resolveNextClip (for idle loop patch) ─────────────────────────────────
function resolveNextClip(currentNodeId, currentVideoId) {
  const config = loadCloudConfig() || {};
  const wf = config.draftWorkflow || config.publishedWorkflow || config;
  const flowNodes = wf.flowNodes || config.flowNodes || [];
  const flowConnections = wf.flowConnections || config.flowConnections || [];
  const idleVideoId = wf.idleVideoId || config.idleVideoId || null;

  let nodeId = currentNodeId || null;
  if (!nodeId && currentVideoId) {
    nodeId = flowNodes.find(n => n.videoId === currentVideoId)?.nodeId || null;
  }
  if (!nodeId) return null;

  const naturalConn = flowConnections.find(
    c => c.fromNodeId === nodeId && (c.type === 'natural' || !c.triggerId)
  );
  const nextNodeId = naturalConn?.toNodeId || null;
  const nextNode = nextNodeId ? flowNodes.find(n => n.nodeId === nextNodeId) : null;
  const nextVideoId = nextNode?.videoId || idleVideoId || null;
  if (!nextVideoId) return null;

  const idleNode = idleVideoId ? flowNodes.find(n => n.videoId === idleVideoId) : null;
  const isNextIdle = nextVideoId === idleVideoId;
  const pb = nextNode?.playback || {};
  return {
    nodeId: nextNodeId || idleNode?.nodeId || null,
    videoId: nextVideoId,
    startSec: pb.startSec || 0,
    endSec: pb.endSec ?? null,
    transitionMs: pb.transitionMs || 220,
    loop: isNextIdle,
    audio: nextNode?.audio || { mode: 'muted', volume: 1 },
  };
}

// ── Gift recognition patterns ──────────────────────────────────────────────
//
// Pattern A — verb format (Portuguese / English):
//   "Sender enviou|mandou|sent GiftName [xN]"
const GIFT_VERB_RE = /^([^@\s][^:]{1,40}?)\s+(?:enviou|mandou|presenteou\s+com|sent)\s+(.+?)(?:\s+[x×]\s*(\d+))?\s*$/i;
//
// Pattern B — TikTok notification format (no verb):
//   "Username [emoji/short-word] x[N]"
//   e.g. "Slaanesh O x2" where "O" = ❤ OCR artefact
//   Applied when line is short (< 55 chars) OR zone role is gifts.
const GIFT_TIKTOK_RE = /^(.{2,40}?)\s+([^\s]{1,12})\s+[x×]\s*(\d+)\s*$/i;
//
// OCR artefacts → canonical gift-key mapping.
// Tesseract commonly substitutes emoji with these single characters.
const OCR_EMOJI_MAP = {
  'o': 'heart',   '0': 'heart',   // ❤ / ♥
  'v': 'heart',                    // ❤ V-shape artifact
  'e': 'heart',                    // ❤ E-shape artifact
  'j': 'heart',                    // ❤ J-shape artifact
  '"': 'heart',                    // ❤ curved-glyph reads as double-quote
  "'": 'heart',                    // ❤ single-quote artifact
  'd': 'diamond',                  // 💎
  'r': 'rose',                     // 🌹
  'f': 'follow',                   // Follow sticker
  'l': 'like',                     // 👍
};
function normaliseGiftKey(raw, fromVerbPattern = false) {
  const s = raw.trim();
  if (s.length === 1) return OCR_EMOJI_MAP[s.toLowerCase()] ?? (fromVerbPattern ? 'heart' : s);
  return s;
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Auth guard
  const session = getSession(req);
  if (!session) {
    return json(res, 401, { detail: 'Nao autenticado. Faca login em /auth/login.' });
  }
  if (req.method !== 'POST') {
    return json(res, 405, { detail: 'Method not allowed' });
  }

  const body = await readBody(req);
  const rawLines = Array.isArray(body.lines)
    ? body.lines.map(l => String(l).trim()).filter(l => l.length > 1)
    : String(body.text || '').split('\n').map(l => l.trim()).filter(l => l.length > 1);
  const zoneRole = body.zoneRole || 'chat'; // 'chat' | 'gifts' | 'alerts' | 'custom'
  const zoneName = body.zoneName || '';

  if (rawLines.length === 0) {
    return json(res, 200, { ok: true, linesProcessed: 0, triggered: [], noMatch: [], mode: 'cloud' });
  }

  const config = loadCloudConfig() || {};
  const activeWorkflow = config.draftWorkflow || config.publishedWorkflow || config;
  const flowNodes = activeWorkflow.flowNodes || config.flowNodes || [];
  const flowConnections = activeWorkflow.flowConnections || config.flowConnections || [];
  const triggers = activeWorkflow.triggers || config.triggers || [];
  const idleVideoId = activeWorkflow.idleVideoId || config.idleVideoId || null;
  const currentState = getCloudValue('video_state')?.value || {};
  const currentNodeId = currentState.activeNodeId || null;
  const currentVideoId = currentState.current_video_id || null;

  const triggered = [];
  const noMatch = [];
  let idleAlreadyBroken = false;

  for (const line of rawLines) {
    // ── Step 1: parse the line ──────────────────────────────────────────
    let eventType, eventData, parsedKind;

    const giftVerbMatch = GIFT_VERB_RE.exec(line);
    const tiktokMatch = !giftVerbMatch && (zoneRole === 'gifts' || line.length < 55)
      ? GIFT_TIKTOK_RE.exec(line)
      : null;

    if (giftVerbMatch) {
      // Pattern A: "Sender enviou GiftName x2"
      const giftKey = normaliseGiftKey(giftVerbMatch[2], true); // fromVerbPattern=true → unknown single-char → 'heart'
      eventType = 'gift';
      parsedKind = 'gift';
      eventData = {
        giftKey, gift_key: giftKey,
        sender: giftVerbMatch[1].trim(),
        count: giftVerbMatch[3] ? parseInt(giftVerbMatch[3]) : 1,
      };
    } else if (tiktokMatch) {
      // Pattern B: "Slaanesh O x2" — TikTok notification without verb
      // Requires explicit count suffix (x1, x2, ×3…) — strong gift signal.
      const giftKey = normaliseGiftKey(tiktokMatch[2]);
      eventType = 'gift';
      parsedKind = 'gift';
      eventData = {
        giftKey, gift_key: giftKey,
        sender: tiktokMatch[1].trim(),
        count: parseInt(tiktokMatch[3]),
        ocrRaw: tiktokMatch[2],
      };
    } else {
      // No gift pattern matched → treat as chat.
      // We do NOT fall back to "everything in a gifts zone = gift" because
      // on TikTok, chat and gift notifications appear in the same screen area.
      eventType = 'comment';
      parsedKind = 'chat';
      eventData = { text: line, message: line };
    }

    // ── Step 2: find matching trigger ──────────────────────────────────
    const matchedTrigger = triggers.find(t => {
      if (t.enabled === false) return false;
      const tType = (t.eventType || t.type || '').toLowerCase();
      if (tType !== eventType) return false;
      if (eventType === 'gift') {
        const gKey = (eventData.giftKey || '').toLowerCase();
        const condKey = (t.conditions?.giftKey || '').toLowerCase();
        return !condKey || condKey === gKey || condKey === '*';
      }
      if (eventType === 'comment') {
        const text = (eventData.text || '').toLowerCase();
        const keyword = (t.conditions?.keyword || '').toLowerCase();
        return !keyword || text.includes(keyword);
      }
      return true;
    });

    if (!matchedTrigger) {
      noMatch.push({
        eventType, kind: parsedKind, line,
        giftKey: eventData?.giftKey,
        ocrRaw: eventData?.ocrRaw,
        sender: eventData?.sender,
      });
      continue;
    }

    // ── Step 3: resolve target video ───────────────────────────────────
    const connection =
      flowConnections.find(c => c.triggerId === matchedTrigger.id && c.fromNodeId === currentNodeId) ||
      flowConnections.find(c => c.triggerId === matchedTrigger.id);
    const action = matchedTrigger.actions?.find(a => a.type === 'play_video');
    const targetNodeId = connection?.toNodeId || action?.nodeId || null;
    const targetNode = targetNodeId ? flowNodes.find(n => n.nodeId === targetNodeId) : null;
    const targetVideoId = targetNode?.videoId || action?.videoId || null;

    if (!targetVideoId) {
      noMatch.push({ eventType, kind: parsedKind, line, triggerId: matchedTrigger.id, reason: 'no_video_configured' });
      continue;
    }

    // ── Step 4: enqueue trigger ─────────────────────────────────────────
    const isIdle = targetVideoId === idleVideoId;
    const pb = targetNode?.playback || action?.playback || {};
    const triggerClip = {
      nodeId: targetNodeId,
      videoId: targetVideoId,
      startSec: pb.startSec || 0,
      endSec: pb.endSec ?? null,
      transitionMs: pb.transitionMs || 220,
      loop: isIdle || Boolean(pb.loop),
      returnToIdle: connection?.returnToIdle !== false,
      audio: targetNode?.audio || action?.audio || { mode: 'muted', volume: 1 },
    };

    const { entry, queueSize } = enqueueTriggerAction({
      triggerId: matchedTrigger.id,
      triggerName: matchedTrigger.name,
      eventType,
      targetVideoId,
      targetNodeId,
      connectionId: connection?.id || null,
      currentClip: triggerClip,
    });

    // Break idle loop once per batch so the player advances immediately
    if (!idleAlreadyBroken && idleVideoId && currentVideoId === idleVideoId && currentState.currentClip?.loop !== false) {
      const patchedState = {
        ...currentState,
        server_time: Date.now() / 1000,
        currentClip: { ...(currentState.currentClip || {}), loop: false },
        nextClip: resolveNextClip(currentNodeId, currentVideoId),
      };
      setCloudValue('video_state', patchedState);
      idleAlreadyBroken = true;
    }

    triggered.push({
      triggerId: matchedTrigger.id,
      triggerName: matchedTrigger.name,
      eventType,
      kind: parsedKind,
      targetVideoId,
      queueSize,
      queued: true,
      line,
      giftKey: eventData?.giftKey,
      ocrRaw: eventData?.ocrRaw,
      sender: eventData?.sender,
      queueEntryId: entry.id,
    });
  }

  return json(res, 200, {
    ok: true,
    linesProcessed: rawLines.length,
    triggered,
    noMatch,
    triggerQueueSize: getTriggerQueueSize(),
    zoneName,
    zoneRole,
    mode: 'cloud',
  });
}
