import crypto from 'node:crypto';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

// Strip any query string from import.meta.url before passing to fileURLToPath.
// The old hot-reload mechanism appends ?v=mtime to force a new cache entry;
// fileURLToPath throws if the URL contains a query string.
const _metaUrl = import.meta.url.includes('?') ? import.meta.url.split('?')[0] : import.meta.url;
const __dirname = nodePath.dirname(fileURLToPath(_metaUrl));

const SESSION_COOKIE_NAME = 'odessa_admin_session';
const PERSONA_CONFIG_KEY = 'persona_config';
const CONVERSATIONS_KEY = 'conversations';
const CHAT_AUTOMATION_KEY = 'chat_automation';
const AUTH_BUILD = 'ai-decide-2026-05-27-gemini-v1';
const SESSION_TTL_SECONDS = Number(process.env.ODESSA_SESSION_TTL_SECONDS || 12 * 60 * 60);
const DEFAULT_ADMIN_EMAIL = 'lucasbatista.c.l@gmail.com';
const DEFAULT_PASSWORD_HASH = '';
const ADMIN_EMAIL = (process.env.ODESSA_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
const _rawAdminHash = (process.env.ODESSA_ADMIN_PASSWORD_HASH || '').trim();
const ADMIN_PASSWORD_HASH = _rawAdminHash && /^[0-9a-f]{64}$/i.test(_rawAdminHash) ? _rawAdminHash : _rawAdminHash ? crypto.createHash('sha256').update(_rawAdminHash).digest('hex') : '';
const SESSION_SECRET = process.env.ODESSA_SESSION_SECRET || 'odessa-hostinger-session-secret-v1-change-in-env';
const AGENT_TOKEN = process.env.ODESSA_AGENT_TOKEN || '+jj4LlhjinNG46KhmJxqgm0g4t4JYizSmiW12g1ZJy8=';
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
// ── AI / Gemini ───────────────────────────────────────────────────────────────
const AI_PROVIDER   = (process.env.AI_PROVIDER || 'gemini').toLowerCase().trim();
const GEMINI_KEY    = process.env.GEMINI_API_KEY || '';
const OPENAI_KEY    = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL  = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const GEMINI_MODEL  = 'gemini-2.5-flash';
const AI_TIMEOUT_MS = Number(process.env.AI_DECISION_TIMEOUT || 8000);
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(nodePath.join(UPLOADS_DIR, 'videos'), { recursive: true }); } catch {}
const cloudStore = (globalThis.__ODESSA_CLOUD_STORE ||= {
  agentStatus: null,
  commandQueue: [],
  commandRecords: {},
  events: [],
  pendingTriggerQueue: [],
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
  if (!normalizedPassword) return false;
  const incomingHash = hashPassword(normalizedPassword);
  const storedHash = getStoredPasswordHash();
  if (!storedHash) return false;
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
  return {
    mode: 'cloud',
    message: 'Odessa Cloud esta online.',
  };
}

function cloudCapabilities() {
  return {
    databaseConfigured: true,
    blobConfigured: true,
  };
}

// ── AI helper functions ───────────────────────────────────────────────────────
const AI_SYSTEM_PROMPT = `\
Você é o motor de decisão de IA da Odessa, uma persona de live TikTok interativa.
Sua tarefa: analisar um evento capturado por OCR ao vivo e decidir como a persona deve reagir.

Responda SOMENTE com um objeto JSON válido. Sem markdown, sem texto fora do JSON.

Estrutura obrigatória:
{
  "intent": "gift_reaction" | "greeting" | "compliment_response" | "question_response" | "idle_maintenance" | "special_event" | "unknown",
  "emotion": "happy" | "excited" | "grateful" | "neutral" | "shy" | "playful" | "surprised",
  "recommendedAction": "play_video" | "queue_video" | "wait" | "no_action",
  "selectedTriggerId": "<id do gatilho selecionado da lista>" | null,
  "selectedVideoId": "<id do vídeo selecionado da lista>" | null,
  "selectedVideoLabel": "<label do vídeo>" | null,
  "confidence": <número entre 0 e 1>,
  "reasoning": "<motivo em português, máximo 120 caracteres>"
}

Regras:
- Prefira gatilhos que combinem com o tipo do evento (gift → gatilhos de gift)
- Se nenhum gatilho combinar, deixe selectedTriggerId e selectedVideoId como null
- confidence acima de 0.8 → play_video; entre 0.5–0.8 → queue_video; abaixo → wait
- Para eventos de baixa relevância use intent: "idle_maintenance" e wait
`;

const AI_VALID_INTENTS  = ['gift_reaction','greeting','compliment_response','question_response','idle_maintenance','special_event','unknown'];
const AI_VALID_EMOTIONS = ['happy','excited','grateful','neutral','shy','playful','surprised'];
const AI_VALID_ACTIONS  = ['play_video','queue_video','wait','no_action'];

function buildAiUserMessage(ocrEvent, config) {
  const lines = [
    `Tipo de evento: ${ocrEvent.eventType ?? 'desconhecido'}`,
    `Texto bruto: "${ocrEvent.rawText ?? ''}"`,
    `Texto normalizado: "${ocrEvent.normalizedText ?? ''}"`,
    `Zona: ${ocrEvent.zoneName ?? 'desconhecida'} (${ocrEvent.zone ?? ''})`,
    `Confiança do OCR: ${Math.round((ocrEvent.confidence ?? 0) * 100)}%`,
  ];
  if (ocrEvent.metadata?.giftName || ocrEvent.metadata?.giftKey) {
    lines.push(`Presente: ${ocrEvent.metadata.giftName || ocrEvent.metadata.giftKey}`);
  }
  if (ocrEvent.author) lines.push(`Autor/usuário: ${ocrEvent.author}`);
  if (config?.triggers?.length) {
    const tList = config.triggers.filter(t => t.enabled !== false).slice(0, 10)
      .map(t => `  - id:"${t.id}" label:"${t.name || t.label || t.id}"`).join('\n');
    lines.push(`\nGatilhos disponíveis:\n${tList}`);
  } else {
    lines.push('\nGatilhos disponíveis: nenhum');
  }
  if (config?.videos?.length) {
    const vList = config.videos.slice(0, 10)
      .map(v => `  - id:"${v.id}" label:"${v.label || v.name || v.id}"`).join('\n');
    lines.push(`\nVídeos disponíveis:\n${vList}`);
  }
  return lines.join('\n');
}

function sanitizeAiDecision(raw, ocrEvent) {
  let parsed;
  try {
    const clean = (raw || '').replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(clean);
  } catch { return null; }
  return {
    sourceEvent: ocrEvent,
    intent: AI_VALID_INTENTS.includes(parsed.intent) ? parsed.intent : 'unknown',
    emotion: AI_VALID_EMOTIONS.includes(parsed.emotion) ? parsed.emotion : 'neutral',
    recommendedAction: AI_VALID_ACTIONS.includes(parsed.recommendedAction) ? parsed.recommendedAction : 'no_action',
    selectedTriggerId: typeof parsed.selectedTriggerId === 'string' ? parsed.selectedTriggerId : null,
    selectedVideoId: typeof parsed.selectedVideoId === 'string' ? parsed.selectedVideoId : null,
    selectedVideoLabel: typeof parsed.selectedVideoLabel === 'string' ? parsed.selectedVideoLabel : null,
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 200) : 'Decisão gerada pela IA.',
    status: 'online',
    timestamp: new Date().toISOString(),
  };
}

async function callAiGemini(userMessage) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    system_instruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 256, temperature: 0.3 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 120)}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function callAiOpenAi(userMessage) {
  const body = {
    model: OPENAI_MODEL,
    messages: [{ role: 'system', content: AI_SYSTEM_PROMPT }, { role: 'user', content: userMessage }],
    response_format: { type: 'json_object' },
    max_tokens: 256,
    temperature: 0.3,
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`OpenAI ${res.status}: ${err.slice(0, 120)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? null;
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

function nowIso() {
  return new Date().toISOString();
}

function loadConversations() {
  const stored = getCloudValue(CONVERSATIONS_KEY);
  const conversations = Array.isArray(stored?.value?.conversations)
    ? stored.value.conversations
    : Array.isArray(stored?.value)
      ? stored.value
      : [];
  return { conversations };
}

function saveConversations(conversations) {
  setCloudValue(CONVERSATIONS_KEY, { conversations });
  return { conversations };
}

function sortConversations(conversations) {
  return [...conversations].sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
  );
}

function findConversation(conversationId) {
  return loadConversations().conversations.find((item) => item.id === conversationId) || null;
}

function upsertConversation(conversation) {
  const data = loadConversations();
  const next = data.conversations.filter((item) => item.id !== conversation.id);
  next.push(conversation);
  saveConversations(next);
  return conversation;
}

function createConversationRecord(body) {
  const participantId = String(body?.participantId || '').trim();
  if (!participantId) {
    const error = new Error('participantId e obrigatorio');
    error.statusCode = 400;
    throw error;
  }
  const at = nowIso();
  const conversation = {
    id: `conv-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    source: String(body?.source || 'generic'),
    participantId,
    participantName: String(body?.participantName || participantId),
    status: 'open',
    metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    messages: [],
    createdAt: at,
    updatedAt: at,
  };
  upsertConversation(conversation);
  return conversation;
}

function addConversationMessageRecord(conversationId, body, status = 'received') {
  const conversation = findConversation(conversationId);
  if (!conversation) {
    const error = new Error('Conversation not found');
    error.statusCode = 404;
    throw error;
  }
  const text = String(body?.text || '').trim();
  if (!text) {
    const error = new Error('text e obrigatorio');
    error.statusCode = 400;
    throw error;
  }
  const at = nowIso();
  const message = {
    id: `msg-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    role: String(body?.role || 'user'),
    text,
    status,
    metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    createdAt: at,
  };
  conversation.messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  conversation.messages.push(message);
  conversation.updatedAt = at;
  upsertConversation(conversation);
  return message;
}

function buildConversationPrompt(conversation) {
  const history = (conversation.messages || [])
    .slice(-12)
    .map((message) => `${message.role}: ${message.text}`)
    .join('\n');
  return (
    'Conversa privada 1-1. Responda em tom natural, seguro e coerente com Odessa.\n' +
    `Participante: ${conversation.participantName || conversation.participantId}\n` +
    `Historico recente:\n${history}\n\n` +
    'Gere uma resposta curta pronta para aprovacao humana.'
  );
}

async function callConversationGemini({ systemPrompt, userPrompt, model, temperature }) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY nao configurada');
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model || GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 220, temperature },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!upstream.ok) {
    const err = await upstream.text().catch(() => `HTTP ${upstream.status}`);
    throw new Error(`Gemini ${upstream.status}: ${err.slice(0, 160)}`);
  }
  const data = await upstream.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callConversationOpenAi({ systemPrompt, userPrompt, temperature }) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY nao configurada');
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 220,
      temperature,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!upstream.ok) {
    const err = await upstream.text().catch(() => `HTTP ${upstream.status}`);
    throw new Error(`OpenAI ${upstream.status}: ${err.slice(0, 160)}`);
  }
  const data = await upstream.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function generateConversationReplyRecord(conversationId, body) {
  const conversation = findConversation(conversationId);
  if (!conversation) {
    const error = new Error('Conversation not found');
    error.statusCode = 404;
    throw error;
  }
  const systemPrompt = String(body?.personaPrompt || AI_SYSTEM_PROMPT);
  const userPrompt = buildConversationPrompt(conversation);
  const temperature = Math.max(0, Math.min(1.2, Number(body?.temperature ?? 0.72)));
  const model = String(body?.model || GEMINI_MODEL);
  const providers = AI_PROVIDER === 'openai' ? ['openai', 'gemini'] : ['gemini', 'openai'];
  const errors = [];
  for (const provider of providers) {
    try {
      const text = provider === 'openai'
        ? await callConversationOpenAi({ systemPrompt, userPrompt, temperature })
        : await callConversationGemini({ systemPrompt, userPrompt, model, temperature });
      if (text.trim()) {
        const message = addConversationMessageRecord(conversationId, {
          role: 'assistant',
          text: text.trim(),
          metadata: { provider, generated: true },
        }, 'draft');
        return { message, provider };
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  const fallbackText = 'Entendi. Vou responder com calma e manter a conversa leve por aqui.';
  const message = addConversationMessageRecord(conversationId, {
    role: 'assistant',
    text: fallbackText,
    metadata: { provider: 'local_fallback', generated: true, errors },
  }, 'draft');
  return { message, provider: 'local_fallback' };
}

function approveConversationMessageRecord(conversationId, body) {
  const messageId = String(body?.messageId || '').trim();
  const conversation = findConversation(conversationId);
  if (!conversation || !messageId) {
    const error = new Error('Message not found');
    error.statusCode = 404;
    throw error;
  }
  const message = (conversation.messages || []).find((item) => item.id === messageId);
  if (!message) {
    const error = new Error('Message not found');
    error.statusCode = 404;
    throw error;
  }
  const at = nowIso();
  message.status = 'approved';
  message.approvedAt = at;
  conversation.updatedAt = at;
  upsertConversation(conversation);
  return message;
}

function emptyChatAutomationConfig() {
  return { allowlist: [], logs: [] };
}

function loadChatAutomationConfig() {
  const stored = getCloudValue(CHAT_AUTOMATION_KEY);
  const value = stored?.value && typeof stored.value === 'object' ? stored.value : emptyChatAutomationConfig();
  return {
    allowlist: Array.isArray(value.allowlist) ? value.allowlist : [],
    logs: Array.isArray(value.logs) ? value.logs : [],
  };
}

function saveChatAutomationConfig(config) {
  const next = {
    allowlist: Array.isArray(config.allowlist) ? config.allowlist : [],
    logs: Array.isArray(config.logs) ? config.logs.slice(-300) : [],
  };
  setCloudValue(CHAT_AUTOMATION_KEY, next);
  return next;
}

function normalizeChatAutomationAllowlist(allowlist) {
  const cleaned = [];
  for (const entry of Array.isArray(allowlist) ? allowlist : []) {
    if (!entry || typeof entry !== 'object') continue;
    const mode = entry.mode === 'visual' ? 'visual' : 'selector';
    const domain = String(entry.domain || '').trim().toLowerCase();
    const inputSelector = String(entry.inputSelector || '').trim();
    const inputPoint = normalizeChatAutomationPoint(entry.inputPoint);
    const sendPoint = normalizeChatAutomationPoint(entry.sendPoint);
    const viewport = normalizeChatAutomationViewport(entry.viewport);
    if (mode === 'visual') {
      if (!inputPoint) continue;
    } else if (!domain || !inputSelector) {
      continue;
    }
    cleaned.push({
      id: String(entry.id || `allow-${crypto.randomUUID()}`),
      label: String(entry.label || domain || 'Chat visual'),
      mode,
      domain: mode === 'visual' ? domain || 'visual:tango-live' : domain,
      urlPattern: String(entry.urlPattern || '').trim(),
      inputSelector: mode === 'visual' ? inputSelector || 'visual-point' : inputSelector,
      sendSelector: String(entry.sendSelector || '').trim(),
      inputPoint,
      sendPoint,
      viewport,
      submitWithEnter: entry.submitWithEnter !== false,
      typingDelayMs: Math.max(0, Math.min(Number(entry.typingDelayMs || 25), 2000)),
      maxPerMinute: Math.max(1, Math.min(Number(entry.maxPerMinute || 6), 60)),
      enabled: entry.enabled !== false,
    });
  }
  return cleaned;
}

function normalizeChatAutomationPoint(point) {
  if (!point || typeof point !== 'object') return null;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
}

function normalizeChatAutomationViewport(viewport) {
  if (!viewport || typeof viewport !== 'object') return null;
  const width = Math.round(Number(viewport.width));
  const height = Math.round(Number(viewport.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  return { width, height };
}

function plannedChatAutomationPixel(point, viewport) {
  const normalizedPoint = normalizeChatAutomationPoint(point);
  const normalizedViewport = normalizeChatAutomationViewport(viewport);
  if (!normalizedPoint || !normalizedViewport) return null;
  return {
    x: Math.round(normalizedPoint.x * normalizedViewport.width),
    y: Math.round(normalizedPoint.y * normalizedViewport.height),
  };
}

function matchChatAutomationTarget(url, inputSelector = '', mode = 'selector', inputPoint = null) {
  if (mode === 'visual') {
    if (!normalizeChatAutomationPoint(inputPoint)) return null;
    const config = loadChatAutomationConfig();
    return config.allowlist.find((entry) => entry.enabled !== false && entry.mode === 'visual') || null;
  }

  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return null;
  }
  const host = (parsed.hostname || '').toLowerCase();
  const config = loadChatAutomationConfig();
  for (const entry of config.allowlist) {
    if (entry.enabled === false) continue;
    if (entry.mode === 'visual') continue;
    const domain = String(entry.domain || '').toLowerCase();
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    const pattern = String(entry.urlPattern || '').trim();
    if (pattern && !(new RegExp(pattern).test(String(url)))) continue;
    if (inputSelector && inputSelector !== entry.inputSelector) continue;
    return entry;
  }
  return null;
}

function logChatAutomationAttempt(url, text, result, inputSelector = '', mode = 'selector', inputPoint = null) {
  const config = loadChatAutomationConfig();
  config.logs.push({
    id: `chatlog-${crypto.randomUUID()}`,
    createdAt: nowIso(),
    mode,
    url: String(url || ''),
    inputSelector: inputSelector || null,
    inputPoint: normalizeChatAutomationPoint(inputPoint),
    text: String(text || '').slice(0, 500),
    result,
  });
  saveChatAutomationConfig(config);
}

function updateChatAutomationCommandLog(commandId, patch) {
  if (!commandId) return;
  const config = loadChatAutomationConfig();
  let changed = false;
  config.logs = config.logs.map((entry) => {
    const result = entry?.result || {};
    if (result.commandId !== commandId && result.command?.id !== commandId) return entry;
    changed = true;
    return {
      ...entry,
      updatedAt: nowIso(),
      result: {
        ...result,
        ...patch,
      },
    };
  });
  if (changed) saveChatAutomationConfig(config);
}

function validateChatAutomationTarget(body) {
  const mode = body?.mode === 'visual' ? 'visual' : 'selector';
  const target = matchChatAutomationTarget(body?.url, body?.inputSelector, mode, body?.inputPoint);
  return { allowed: Boolean(target), target, reason: target ? null : 'not_allowlisted' };
}

function sendChatAutomationMessageRecord(body) {
  const url = String(body?.url || '').trim();
  const text = String(body?.text || '').trim();
  const inputSelector = String(body?.inputSelector || '').trim();
  const mode = body?.mode === 'visual' ? 'visual' : 'selector';
  const inputPoint = normalizeChatAutomationPoint(body?.inputPoint);
  const sendPoint = normalizeChatAutomationPoint(body?.sendPoint);
  const viewport = normalizeChatAutomationViewport(body?.viewport);
  const target = matchChatAutomationTarget(url, inputSelector, mode, inputPoint);
  if (!target) {
    const result = { status: 'blocked', allowed: false, reason: 'not_allowlisted' };
    logChatAutomationAttempt(url, text, result, inputSelector, mode, inputPoint);
    return result;
  }
  if (!text) {
    const result = { status: 'blocked', allowed: false, reason: 'empty_text', target };
    logChatAutomationAttempt(url, text, result, inputSelector, mode, inputPoint);
    return result;
  }
  const dryRun = body?.dryRun !== false;
  const submit = body?.submit !== false;
  const result = {
    status: dryRun ? 'dry_run' : 'ready',
    allowed: true,
    target,
    text,
    mode,
    inputPoint: inputPoint || target.inputPoint || null,
    sendPoint: sendPoint || target.sendPoint || null,
    viewport: viewport || target.viewport || null,
    plannedInputPixel: plannedChatAutomationPixel(inputPoint || target.inputPoint, viewport || target.viewport),
    plannedSendPixel: plannedChatAutomationPixel(sendPoint || target.sendPoint, viewport || target.viewport),
    submit,
    wouldClick: mode === 'visual',
    wouldType: true,
    wouldSend: !dryRun && submit,
  };
  if (mode === 'visual' && !dryRun) {
    const commandId = crypto.randomUUID();
    const queued = enqueueAgentCommand({
      id: commandId,
      type: 'chat.send_visual',
      timeoutMs: Number(body?.timeoutMs || 20_000),
      maxAttempts: Number(body?.maxAttempts || 2),
      payload: {
        commandId,
        text,
        mode,
        targetUrl: url,
        inputPoint: result.inputPoint,
        sendPoint: result.sendPoint,
        viewport: result.viewport,
        plannedInputPixel: result.plannedInputPixel,
        plannedSendPixel: result.plannedSendPixel,
        submit,
      },
    });
    result.status = 'queued';
    result.queued = true;
    result.commandId = commandId;
    result.command = queued.command;
    result.queueSize = queued.queueSize;
    result.executionMode = 'cloud-agent';
    result.reason = 'queued_for_local_agent';
  }
  logChatAutomationAttempt(url, text, result, inputSelector, mode, inputPoint);
  return result;
}

function stateFromAgentStatus(agentStatus) {
  const lastSeenMs = Date.parse(agentStatus?.lastSeenAt || '');
  const online = Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs < 45_000;
  return {
    mode: online ? 'local-agent' : 'cloud',
    message: online ? 'Agente local conectado.' : 'Odessa Cloud esta online; agente local offline.',
    localAgent: {
      online,
      lastSeenAt: agentStatus?.lastSeenAt || null,
      capabilities: Array.isArray(agentStatus?.capabilities) ? agentStatus.capabilities : [],
    },
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

// ── Profile helpers (OBS settings + Workflow) ──
function loadProfiles(kind) {
  const stored = getCloudValue(`${kind}_profiles`);
  return Array.isArray(stored?.value) ? stored.value : [];
}

function saveProfiles(kind, profiles) {
  setCloudValue(`${kind}_profiles`, profiles);
}

function enqueueAgentCommand(command) {
  const id = command.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const normalized = {
    id,
    type: command.type || 'noop',
    payload: command.payload || {},
    createdAt: command.createdAt || now,
    updatedAt: now,
    status: 'queued',
    attempts: 0,
    maxAttempts: Math.max(1, Math.min(Number(command.maxAttempts || 2), 5)),
    timeoutMs: Math.max(5_000, Math.min(Number(command.timeoutMs || 20_000), 120_000)),
  };
  cloudStore.commandRecords ||= {};
  cloudStore.commandRecords[id] = normalized;
  cloudStore.commandQueue.push(id);
  return { command: publicAgentCommand(normalized), queueSize: cloudStore.commandQueue.length, persisted: false };
}

function publicAgentCommand(command) {
  if (!command) return null;
  return {
    id: command.id,
    type: command.type,
    payload: command.payload || {},
    createdAt: command.createdAt,
    attempt: command.attempts || 0,
    timeoutMs: command.timeoutMs,
  };
}

function refreshTimedOutCommands(now = Date.now()) {
  cloudStore.commandRecords ||= {};
  for (const command of Object.values(cloudStore.commandRecords)) {
    if (!command || command.status !== 'in_flight') continue;
    const claimedAtMs = Date.parse(command.claimedAt || '');
    if (!Number.isFinite(claimedAtMs) || now - claimedAtMs <= command.timeoutMs) continue;
    if ((command.attempts || 0) < command.maxAttempts) {
      command.status = 'queued';
      command.updatedAt = new Date(now).toISOString();
      command.lastError = 'agent_command_timeout';
      cloudStore.commandQueue.push(command.id);
      updateChatAutomationCommandLog(command.id, {
        status: 'queued',
        reason: 'retry_after_agent_timeout',
        attempts: command.attempts || 0,
        error: 'agent_command_timeout',
      });
    } else {
      command.status = 'failed';
      command.updatedAt = new Date(now).toISOString();
      command.completedAt = new Date(now).toISOString();
      command.error = 'agent_command_timeout';
      updateChatAutomationCommandLog(command.id, {
        status: 'failed',
        executed: false,
        completedAt: command.completedAt,
        error: 'agent_command_timeout',
      });
    }
  }
}

function claimNextAgentCommand() {
  refreshTimedOutCommands();
  cloudStore.commandRecords ||= {};
  while (cloudStore.commandQueue.length) {
    const queued = cloudStore.commandQueue.shift();
    let command = typeof queued === 'string' ? cloudStore.commandRecords[queued] : queued;
    if (!command) continue;
    if (typeof queued !== 'string') {
      command = {
        id: command.id || crypto.randomUUID(),
        type: command.type || 'noop',
        payload: command.payload || {},
        createdAt: command.createdAt || new Date().toISOString(),
        status: 'queued',
        attempts: command.attempts || 0,
        maxAttempts: command.maxAttempts || 2,
        timeoutMs: command.timeoutMs || 20_000,
      };
      cloudStore.commandRecords[command.id] = command;
    }
    if (command.status !== 'queued') continue;
    command.status = 'in_flight';
    command.claimedAt = new Date().toISOString();
    command.updatedAt = command.claimedAt;
    command.attempts = (command.attempts || 0) + 1;
    return { command: publicAgentCommand(command), queueSize: cloudStore.commandQueue.length };
  }
  return { command: null, queueSize: cloudStore.commandQueue.length };
}

function queuedCommandCount() {
  refreshTimedOutCommands();
  cloudStore.commandRecords ||= {};
  return Object.values(cloudStore.commandRecords).filter((command) =>
    command && (command.status === 'queued' || command.status === 'in_flight')
  ).length;
}

function recordAgentEvent(event) {
  const payload = { ...event, receivedAt: new Date().toISOString() };
  const commandId = payload.commandId || payload.command?.id || payload.command?.commandId;
  if (commandId) {
    cloudStore.commandRecords ||= {};
    const record = cloudStore.commandRecords[commandId];
    const result = payload.result || {};
    const status = payload.status || (result.ok === true ? 'executed' : result.ok === false ? 'failed' : 'reported');
    if (record) {
      record.status = status === 'executed' || status === 'sent' || status === 'done' ? 'executed' : status === 'queued' ? 'queued' : status === 'sending' ? 'in_flight' : 'failed';
      record.updatedAt = payload.receivedAt;
      record.completedAt = payload.receivedAt;
      record.result = result.result || result;
      record.coordinates = payload.coordinates || result.coordinates || result.result?.coordinates || null;
      record.error = payload.error || result.error || result.result?.reason || null;
    }
    updateChatAutomationCommandLog(commandId, {
      status: status === 'executed' || status === 'sent' || status === 'done' ? 'executed' : 'failed',
      executed: status === 'executed' || status === 'sent' || status === 'done',
      completedAt: payload.receivedAt,
      coordinates: payload.coordinates || result.coordinates || result.result?.coordinates || null,
      error: payload.error || result.error || result.result?.reason || null,
      agentResult: result,
    });
  }
  cloudStore.events.push(payload);
  cloudStore.events = cloudStore.events.slice(-100);
  return { persisted: false };
}

function recentAgentEvents() {
  return cloudStore.events.slice(-20);
}

function recentAgentCommands() {
  refreshTimedOutCommands();
  cloudStore.commandRecords ||= {};
  return Object.values(cloudStore.commandRecords)
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.updatedAt || a.createdAt || '') - Date.parse(b.updatedAt || b.createdAt || ''))
    .slice(-20)
    .map((command) => ({
      id: command.id,
      type: command.type,
      status: command.status,
      attempts: command.attempts || 0,
      maxAttempts: command.maxAttempts,
      createdAt: command.createdAt,
      updatedAt: command.updatedAt,
      completedAt: command.completedAt,
      coordinates: command.coordinates || null,
      error: command.error || null,
    }));
}

// ── Trigger queue helpers ──────────────────────────────────────────────────
// Triggers are no longer fired immediately. Instead they go into a persistent
// KV queue. When idle finishes and /video/advance is called, the first entry
// is popped and played. The idle video stays loop:false while the queue has
// items so the player knows to call advance instead of restarting the loop.

function loadTriggerQueue() {
  try {
    const stored = getCloudValue('trigger_queue');
    return Array.isArray(stored?.value) ? stored.value : [];
  } catch { return []; }
}

function saveTriggerQueue(queue) {
  setCloudValue('trigger_queue', queue);
  cloudStore.pendingTriggerQueue = queue;
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

function dequeueTriggerAction() {
  const queue = loadTriggerQueue();
  if (!queue.length) return { entry: null, queueSize: 0 };
  const [entry, ...rest] = queue;
  saveTriggerQueue(rest);
  return { entry, queueSize: rest.length };
}

function getTriggerQueueSize() {
  try {
    const stored = getCloudValue('trigger_queue');
    return Array.isArray(stored?.value) ? stored.value.length : 0;
  } catch { return 0; }
}

// ── Time-based schedule engine ─────────────────────────────────────────────
// Schedules live inside the workflow config as `schedules[]`. On every
// /video/state poll this function is called to enqueue any schedule whose
// interval has elapsed. Writing lastFiredAt BEFORE enqueueing is safe because
// Node.js is single-threaded — no two requests can check the same schedule
// simultaneously within the same process.

function getScheduleState() {
  try { return getCloudValue('schedule_state')?.value || {}; } catch { return {}; }
}

function checkAndFireDueSchedules() {
  try {
    const config = loadCloudConfig() || {};
    const wf = config.draftWorkflow || config.publishedWorkflow || config;
    const schedules = wf.schedules || config.schedules || [];
    if (!schedules.length) return;

    const now = Date.now() / 1000;
    const stored = getScheduleState();
    const flowNodes = wf.flowNodes || config.flowNodes || [];

    for (const schedule of schedules) {
      if (schedule.enabled === false || !schedule.intervalMinutes || !schedule.videoId) continue;
      const intervalSec = Number(schedule.intervalMinutes) * 60;
      if (intervalSec <= 0) continue;

      const lastFired = stored[schedule.id] || 0;
      if (now - lastFired < intervalSec) continue;

      // Mark fired FIRST — prevents a second concurrent request from also firing
      setCloudValue('schedule_state', { ...stored, [schedule.id]: now });

      // Resolve playback settings from the matching flow node (if any)
      const targetNode = schedule.nodeId
        ? flowNodes.find((n) => n.nodeId === schedule.nodeId)
        : flowNodes.find((n) => n.videoId === schedule.videoId);
      const pb = targetNode?.playback || {};

      enqueueTriggerAction({
        triggerId: `schedule:${schedule.id}`,
        triggerName: schedule.name || `Automacao ${schedule.intervalMinutes}min`,
        eventType: 'schedule',
        targetVideoId: schedule.videoId,
        targetNodeId: targetNode?.nodeId || schedule.nodeId || null,
        currentClip: {
          nodeId: targetNode?.nodeId || null,
          videoId: schedule.videoId,
          startSec: pb.startSec || 0,
          endSec: pb.endSec ?? null,
          transitionMs: pb.transitionMs || 220,
          loop: false,
          returnToIdle: true,
          audio: targetNode?.audio || { mode: 'muted', volume: 1 },
        },
      });

      console.log(`[Odessa] Schedule fired: "${schedule.name || schedule.id}" -> ${schedule.videoId}`);
      break; // Fire at most one schedule per poll to avoid flooding
    }
  } catch (err) {
    console.error('[Odessa] checkAndFireDueSchedules error:', err);
  }
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

/** True when the node has a "ao finalizar" (natural) connection to ANOTHER node. */
function nodeHasNaturalNext(nodeId) {
  if (!nodeId) return false;
  const config = loadCloudConfig() || {};
  const wf = config.draftWorkflow || config.publishedWorkflow || config;
  const flowConnections = wf.flowConnections || config.flowConnections || [];
  const triggers = wf.triggers || config.triggers || [];
  const outConnections = flowConnections.filter((c) => c.fromNodeId === nodeId);
  const endConnection = outConnections.find((c) => {
    const trigger = triggers.find((t) => t.id === c.triggerId);
    if (!trigger) return true; // connection without trigger = implicit natural
    const tp = trigger.type || trigger.eventType || '';
    return tp === 'natural' || tp === 'on_end' || tp === 'ao_finalizar' || tp === 'video_end' || tp === 'finish';
  });
  return Boolean(endConnection && endConnection.toNodeId && endConnection.toNodeId !== nodeId);
}

/**
 * Whether a clip should loop. A clip loops ONLY when:
 *  - the node's playback is explicitly set to loop, OR
 *  - it is the designated idle clip AND has no natural "ao finalizar" exit.
 * An idle that is wired into a sequence (01→02→…→01) advances instead of
 * looping on itself — the sequence as a whole is the loop.
 */
function resolveClipLoop(videoId, nodeId) {
  if (!videoId) return false;
  const config = loadCloudConfig() || {};
  const wf = config.draftWorkflow || config.publishedWorkflow || config;
  const flowNodes = wf.flowNodes || config.flowNodes || [];
  const idleVideoId = wf.idleVideoId || config.idleVideoId || null;
  const node = nodeId ? flowNodes.find((n) => n.nodeId === nodeId) : null;
  if (node?.playback?.loop) return true;
  const isIdle = Boolean(idleVideoId && videoId === idleVideoId);
  // If idle but trigger queue has pending items → don't loop so player calls /advance
  if (isIdle && getTriggerQueueSize() > 0) return false;
  return isIdle && !nodeHasNaturalNext(nodeId);
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
    loop: shouldLoop,
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
        // A clip loops only when it has no natural exit (see resolveClipLoop).
        loop: resolveClipLoop(currentVideoId, activeNodeId),
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
    nextClip: resolveNextClip(activeNodeId, currentVideoId),
    queue: [],
    activeNodeId,
    activeConnectionId: stored?.value?.activeConnectionId || null,
    executionMode: 'cloud',
  };
}

/**
 * Computes the clip that naturally follows the given node — i.e. the target
 * of the "ao finalizar" (natural) connection, or idle when there is none.
 * Used to expose `nextClip` on the video_state so players can preload it and
 * cut to it seamlessly when the current clip ends.
 */
function resolveNextClip(currentNodeId, currentVideoId) {
  const config = loadCloudConfig() || {};
  const wf = config.draftWorkflow || config.publishedWorkflow || config;
  const flowNodes = wf.flowNodes || config.flowNodes || [];
  const flowConnections = wf.flowConnections || config.flowConnections || [];
  const triggers = wf.triggers || config.triggers || [];
  const idleVideoId = wf.idleVideoId || config.idleVideoId || null;

  let nodeId = currentNodeId || null;
  if (!nodeId && currentVideoId) {
    nodeId = flowNodes.find((n) => n.videoId === currentVideoId)?.nodeId || null;
  }
  if (!nodeId) return null;

  // If currently idle and trigger queue has items, next clip is the first queued trigger
  const isCurrentlyIdle = Boolean(idleVideoId && currentVideoId === idleVideoId);
  if (isCurrentlyIdle) {
    const queue = loadTriggerQueue();
    if (queue.length > 0) {
      const pending = queue[0];
      if (pending.targetVideoId) {
        const targetNode = pending.targetNodeId ? flowNodes.find((n) => n.nodeId === pending.targetNodeId) : null;
        const pb = targetNode?.playback || {};
        return {
          nodeId: pending.targetNodeId,
          videoId: pending.targetVideoId,
          startSec: pb.startSec || 0,
          endSec: pb.endSec ?? null,
          transitionMs: pb.transitionMs || 220,
          loop: Boolean(pb.loop),
          returnToIdle: true,
          audio: targetNode?.audio || { mode: 'muted', volume: 1 },
        };
      }
    }
  }

  const outConnections = flowConnections.filter((c) => c.fromNodeId === nodeId);
  const endConnection =
    outConnections.find((c) => {
      const trigger = triggers.find((t) => t.id === c.triggerId);
      if (!trigger) return true;
      const tp = trigger.type || trigger.eventType || '';
      return tp === 'natural' || tp === 'on_end' || tp === 'ao_finalizar' || tp === 'video_end' || tp === 'finish';
    }) || outConnections[0];

  let nextNodeId = endConnection ? endConnection.toNodeId : null;
  let nextVideoId = nextNodeId ? flowNodes.find((n) => n.nodeId === nextNodeId)?.videoId || null : null;
  // No outgoing connection — the sequence returns to idle.
  if (!nextNodeId || !nextVideoId) {
    const idleNode = flowNodes.find((n) => n.videoId === idleVideoId);
    if (!idleNode) return null;
    nextNodeId = idleNode.nodeId;
    nextVideoId = idleVideoId;
  }
  // Never point back at the same node — that would freeze playback.
  if (nextNodeId === nodeId && nextVideoId !== idleVideoId) {
    const idleNode = flowNodes.find((n) => n.videoId === idleVideoId);
    nextNodeId = idleNode?.nodeId || null;
    nextVideoId = idleVideoId;
  }
  if (!nextVideoId) return null;

  const targetNode = flowNodes.find((n) => n.nodeId === nextNodeId);
  const isIdle = Boolean(idleVideoId && nextVideoId === idleVideoId);
  const pb = targetNode?.playback || {};
  return {
    nodeId: nextNodeId,
    videoId: nextVideoId,
    startSec: pb.startSec || 0,
    endSec: pb.endSec || null,
    transitionMs: 0,
    loop: resolveClipLoop(nextVideoId, nextNodeId),
    returnToIdle: !isIdle,
    audio: targetNode?.audio || { mode: 'muted', volume: 1 },
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
        // A clip loops only when it has no natural exit (see resolveClipLoop).
        loop: resolveClipLoop(videoId, patch.activeNodeId || null),
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
    nextClip: resolveNextClip(patch.activeNodeId || null, videoId),
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
      recentCommands: recentAgentCommands(),
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
      warnings: [],
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
      _serverBuild: 'schedule-v2-2026-05-22',
      _hasSchedules: typeof checkAndFireDueSchedules === 'function',
      _triggerQueueSize: getTriggerQueueSize(),
      _scheduleState: getScheduleState(),
      _kvKeys: Object.keys(readKv()),
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
    // Fire any time-based schedules that are due (at most one per poll)
    checkAndFireDueSchedules();
    return json(res, 200, {
      ...(loadCloudVideoState()),
      triggerQueueSize: getTriggerQueueSize(),
      ...cloudState(),
    });
  }

  // Schedule status — used by the UI to show "fires in Xmin / last fired at"
  if (path === '/video/schedule/state' || path.endsWith('/video/schedule/state')) {
    const config = loadCloudConfig() || {};
    const wf = config.draftWorkflow || config.publishedWorkflow || config;
    const schedules = wf.schedules || config.schedules || [];
    const stored = getScheduleState();
    const now = Date.now() / 1000;
    return json(res, 200, {
      schedules: schedules
        .filter((s) => s.id)
        .map((s) => {
          const lastFiredAt = stored[s.id] || null;
          const intervalSec = (Number(s.intervalMinutes) || 0) * 60;
          const nextFireAt = lastFiredAt ? lastFiredAt + intervalSec : now;
          return {
            id: s.id,
            name: s.name || '',
            enabled: s.enabled !== false,
            intervalMinutes: s.intervalMinutes || 0,
            lastFiredAt,
            nextFireAt,
            secondsUntilNext: Math.max(0, nextFireAt - now),
          };
        }),
    });
  }

  if (path.includes('/video/advance') && req.method === 'POST') {
    const body = await readBody(req);
    const config = loadCloudConfig() || {};
    // Prefer the most recently edited workflow (draft first, then published, then top-level)
    const activeWorkflow = config.draftWorkflow || config.publishedWorkflow || config;
    const flowNodes = activeWorkflow.flowNodes || config.flowNodes || [];
    const flowConnections = activeWorkflow.flowConnections || config.flowConnections || [];
    const triggers = activeWorkflow.triggers || config.triggers || [];
    const idleVideoId = activeWorkflow.idleVideoId || config.idleVideoId || null;
    const currentState = getCloudValue('video_state')?.value || {};

    // Resolve the currently active node. Fall back to the clip's node, then
    // to looking the node up from the playing video id.
    const currentVideoId = currentState.current_video_id || currentState.currentClip?.videoId || null;
    let activeNodeId = currentState.activeNodeId || currentState.currentClip?.nodeId || null;
    if (!activeNodeId && currentVideoId) {
      activeNodeId = flowNodes.find((n) => n.videoId === currentVideoId)?.nodeId || null;
    }

    // Idempotency — multiple players (overlay, Palco, Início) may all report
    // the same clip ending. The caller passes the node/video it just finished;
    // if that no longer matches the live state, another client already
    // advanced, so this call is a no-op that just echoes the current state.
    const fromNodeId = body.fromNodeId || null;
    const fromVideoId = body.fromVideoId || null;
    const staleByNode = fromNodeId && activeNodeId && fromNodeId !== activeNodeId;
    const staleByVideo = !fromNodeId && fromVideoId && currentVideoId && fromVideoId !== currentVideoId;
    if (staleByNode || staleByVideo) {
      return json(res, 200, {
        ok: true,
        advanced: false,
        reason: 'already-advanced',
        ...currentState,
        ...cloudState(),
      });
    }

    // ── Trigger queue: if we're advancing FROM idle and queue has items, pop ──
    // The idle video just finished its play-through (loop was false because the
    // queue was non-empty). Fire the first pending trigger instead of returning
    // to idle normally.
    const isAdvancingFromIdle = Boolean(idleVideoId && currentVideoId === idleVideoId);
    if (isAdvancingFromIdle) {
      const { entry: queuedTrigger, queueSize: remainingQueueSize } = dequeueTriggerAction();
      if (queuedTrigger && queuedTrigger.targetVideoId) {
        const targetFlowNodeQ = flowNodes.find((n) => n.nodeId === queuedTrigger.targetNodeId);
        const pbQ = targetFlowNodeQ?.playback || {};
        const clipQ = queuedTrigger.currentClip || {
          nodeId: queuedTrigger.targetNodeId,
          videoId: queuedTrigger.targetVideoId,
          startSec: pbQ.startSec || 0,
          endSec: pbQ.endSec ?? null,
          transitionMs: pbQ.transitionMs || 220,
          loop: Boolean(pbQ.loop),
          returnToIdle: true,
          audio: targetFlowNodeQ?.audio || { mode: 'muted', volume: 1 },
        };
        console.log('[Odessa] /video/advance: popping trigger from queue →', queuedTrigger.targetVideoId, 'remaining:', remainingQueueSize);
        const savedQ = saveCloudVideoState(queuedTrigger.targetVideoId, {
          activeNodeId: queuedTrigger.targetNodeId,
          activeConnectionId: queuedTrigger.connectionId || null,
          currentClip: clipQ,
        });
        return json(res, 200, {
          ok: true,
          advanced: true,
          fromNodeId: activeNodeId,
          toNodeId: queuedTrigger.targetNodeId,
          triggeredFromQueue: true,
          triggerQueueSize: remainingQueueSize,
          trigger: { id: queuedTrigger.triggerId, name: queuedTrigger.triggerName, eventType: queuedTrigger.eventType },
          ...savedQ,
          ...cloudState(),
        });
      }
    }

    // Find the next node via the "natural / ao finalizar" connection.
    let nextVideoId = idleVideoId;
    let nextNodeId = null;
    let nextConnectionId = null;
    if (activeNodeId) {
      const outConnections = flowConnections.filter((c) => c.fromNodeId === activeNodeId);
      // Prefer "natural" (ao finalizar) connections — these fire when the video ends.
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
    // No outgoing connection (or none found) — return to idle.
    if (!nextNodeId && idleVideoId) {
      const idleNode = flowNodes.find((n) => n.videoId === idleVideoId);
      nextNodeId = idleNode?.nodeId || null;
      nextVideoId = idleVideoId;
    }
    // Safety: never "advance" to the exact same node — that would freeze the
    // player on the last frame. Fall back to idle instead.
    if (nextNodeId && activeNodeId && nextNodeId === activeNodeId && nextVideoId !== idleVideoId) {
      const idleNode = flowNodes.find((n) => n.videoId === idleVideoId);
      nextNodeId = idleNode?.nodeId || null;
      nextVideoId = idleVideoId;
      nextConnectionId = null;
    }
    console.log('[Odessa] /video/advance:', { fromNodeId: activeNodeId, toNodeId: nextNodeId, nextVideoId });

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

    // ── Enqueue the trigger instead of firing immediately ──
    // The trigger will fire the next time the IDLE clip finishes and
    // /video/advance is called. This lets multiple triggers queue up and
    // play one-after-another, all starting/ending cleanly on the idle boundary.
    const { entry, queueSize } = enqueueTriggerAction({
      triggerId: matchedTrigger.id,
      triggerName: matchedTrigger.name,
      eventType: matchedTrigger.eventType,
      targetVideoId,
      targetNodeId,
      connectionId: connection?.id || null,
      currentClip: triggerClip,
    });

    // If IDLE is playing right now and its loop flag is still true, break it
    // immediately in the KV so the player sees loop:false on the next poll
    // and knows to call /advance when the current play-through finishes.
    // (currentState was already fetched above to resolve currentNodeId)
    const currentVideoId = currentState.current_video_id || null;
    const isCurrentlyIdle = Boolean(idleVideoId && currentVideoId === idleVideoId);
    if (isCurrentlyIdle && currentState.currentClip?.loop !== false) {
      const patchedState = {
        ...currentState,
        server_time: Date.now() / 1000,
        currentClip: { ...(currentState.currentClip || {}), loop: false },
        nextClip: resolveNextClip(currentState.activeNodeId, currentVideoId),
      };
      setCloudValue('video_state', patchedState);
    }

    return json(res, 200, {
      ok: true,
      matched: true,
      triggered: false,
      queued: true,
      queueSize,
      queueEntryId: entry.id,
      trigger: { id: matchedTrigger.id, name: matchedTrigger.name, eventType: matchedTrigger.eventType },
      targetVideoId,
      targetNodeId,
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
      // Guard: detect empty/invalid payloads (e.g. body parse failure returns {})
      const hasData = Array.isArray(workflow.flowNodes) || Array.isArray(workflow.triggers) || Array.isArray(workflow.videos) || workflow.idleVideoId;
      if (!hasData && !workflow.planningCanvas) {
        return json(res, 400, { ok: false, detail: 'Payload vazio ou invalido. Verifique o JSON enviado.' });
      }
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
      // If no video is currently playing, auto-start the idle video
      const currentVideoState = getCloudValue('video_state')?.value;
      const draftIdleId = workflow.idleVideoId || config.idleVideoId;
      if (draftIdleId && !currentVideoState?.current_video_id) {
        const draftNodes = workflow.flowNodes || config.flowNodes || [];
        const idleNode = draftNodes.find((n) => n.videoId === draftIdleId);
        saveCloudVideoState(draftIdleId, { activeNodeId: idleNode?.nodeId || null });
      }
      return json(res, 200, {
        ok: true,
        status: 'draft',
        updatedAt: config.updatedAt,
        validation: { ok: true, warnings: [], errors: [] },
        cloudStorage: cloudCapabilities(),
      });
    }
  }
  // ── Workflow profiles ──
  if (path === '/workflow/profiles') {
    if (req.method === 'GET') {
      return json(res, 200, { ok: true, profiles: loadProfiles('workflow') });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { ok: false, detail: 'Nome do perfil e obrigatorio.' });
      const profiles = loadProfiles('workflow');
      const config = loadCloudConfig() || {};
      const snapshot = body.workflow || {
        flowNodes: config.flowNodes || [],
        flowConnections: config.flowConnections || [],
        triggers: config.triggers || [],
        idleVideoId: config.idleVideoId || null,
        videos: config.videos || [],
        giftMap: config.giftMap || config.gift_map || {},
        transitions: config.transitions || [],
        workflowName: name,
      };
      const existing = profiles.findIndex((p) => p.id === body.id);
      const profile = {
        id: existing >= 0 ? profiles[existing].id : crypto.randomUUID(),
        name,
        workflow: snapshot,
        createdAt: existing >= 0 ? profiles[existing].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (existing >= 0) profiles[existing] = profile;
      else profiles.push(profile);
      saveProfiles('workflow', profiles);
      return json(res, 200, { ok: true, profile, profiles });
    }
    if (req.method === 'DELETE') {
      const body = await readBody(req);
      const profiles = loadProfiles('workflow').filter((p) => p.id !== body.id);
      saveProfiles('workflow', profiles);
      return json(res, 200, { ok: true, profiles });
    }
  }
  if (path === '/workflow/profiles/apply' && req.method === 'POST') {
    const body = await readBody(req);
    const profiles = loadProfiles('workflow');
    const profile = profiles.find((p) => p.id === body.id);
    if (!profile) return json(res, 404, { ok: false, detail: 'Perfil nao encontrado.' });
    const config = loadCloudConfig() || {};
    const w = profile.workflow;
    if (Array.isArray(w.videos)) config.videos = w.videos;
    if (Array.isArray(w.triggers)) config.triggers = w.triggers;
    if (Array.isArray(w.flowNodes)) config.flowNodes = w.flowNodes;
    if (Array.isArray(w.flowConnections)) config.flowConnections = w.flowConnections;
    if (w.idleVideoId !== undefined) config.idleVideoId = w.idleVideoId;
    if (w.giftMap) config.giftMap = w.giftMap;
    if (w.transitions) config.transitions = w.transitions;
    config.draftWorkflow = w;
    config.updatedAt = new Date().toISOString();
    setCloudValue(PERSONA_CONFIG_KEY, config);
    return json(res, 200, { ok: true, appliedProfile: profile.name, updatedAt: config.updatedAt });
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
      // Auto-start idle video so the overlay immediately picks it up
      const idleVideoId = draft.idleVideoId || config.idleVideoId || null;
      if (idleVideoId) {
        const flowNodes = draft.flowNodes || config.flowNodes || [];
        const idleNode = flowNodes.find((n) => n.videoId === idleVideoId);
        const pb = idleNode?.playback || {};
        saveCloudVideoState(idleVideoId, {
          activeNodeId: idleNode?.nodeId || null,
          currentClip: {
            nodeId: idleNode?.nodeId || null,
            videoId: idleVideoId,
            startSec: pb.startSec || 0,
            endSec: pb.endSec || null,
            transitionMs: pb.transitionMs || 220,
            loop: true,
            returnToIdle: false,
            audio: idleNode?.audio || { mode: 'muted', volume: 1 },
          },
        });
      }
      return json(res, 200, {
        ok: true,
        status: 'published',
        publishedAt: config.publishedWorkflow.publishedAt,
        updatedAt: config.updatedAt,
        idleVideoStarted: !!idleVideoId,
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

    // OBS profiles
    if (action === 'profiles') {
      if (req.method === 'GET') {
        return json(res, 200, { ok: true, profiles: loadProfiles('obs') });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const name = String(body.name || '').trim();
        if (!name) return json(res, 400, { ok: false, detail: 'Nome do perfil e obrigatorio.' });
        const profiles = loadProfiles('obs');
        const settings = body.settings || loadObsSettings(req);
        const existing = profiles.findIndex((p) => p.id === body.id);
        const profile = {
          id: existing >= 0 ? profiles[existing].id : crypto.randomUUID(),
          name,
          settings,
          createdAt: existing >= 0 ? profiles[existing].createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (existing >= 0) profiles[existing] = profile;
        else profiles.push(profile);
        saveProfiles('obs', profiles);
        return json(res, 200, { ok: true, profile, profiles });
      }
      if (req.method === 'DELETE') {
        const body = await readBody(req);
        const profiles = loadProfiles('obs').filter((p) => p.id !== body.id);
        saveProfiles('obs', profiles);
        return json(res, 200, { ok: true, profiles });
      }
    }

    if (action === 'profiles-apply' && req.method === 'POST') {
      const body = await readBody(req);
      const profiles = loadProfiles('obs');
      const profile = profiles.find((p) => p.id === body.id);
      if (!profile) return json(res, 404, { ok: false, detail: 'Perfil nao encontrado.' });
      const settings = saveObsSettings(profile.settings);
      return json(res, 200, { ok: true, settings, appliedProfile: profile.name });
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
          { id: 'health', label: 'Verificar saude do OBS', enabled: true, blocked: false },
          { id: 'setup', label: 'Preparar cena da live', enabled: true, blocked: false },
          { id: 'stage', label: 'Colocar palco ao vivo', enabled: true, blocked: false },
        ],
        risks: [],
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
            { id: 'health', label: 'Verificar saude do OBS', enabled: true, blocked: false },
            { id: 'setup', label: 'Preparar cena da live', enabled: body.prepareObs !== false, blocked: false },
            { id: 'stage', label: 'Colocar palco ao vivo', enabled: body.showStage !== false, blocked: false },
            { id: 'automation', label: 'Iniciar automacao do fluxo', enabled: body.startAutomation !== false, blocked: false },
          ],
          risks: [],
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

  // ── OCR Ingest — central routing engine for all captured OCR text ──────
  //
  // This is the bridge between the Capture Studio and the trigger/video system.
  //
  // Flow:
  //   CaptureStudio (fresh OCR lines)
  //     → POST /ocr/ingest  { lines, zoneRole, zoneName }
  //       → parse each line  (gift pattern OR comment keyword)
  //       → find matching trigger in active workflow
  //       → enqueueTriggerAction  (same queue used by /video/trigger)
  //       → return { triggered[], noMatch[], linesProcessed }
  //
  // The client uses the response to show "→ gatilho: X" or "sem gatilho"
  // for each captured event, giving full visibility into what fired.
  if (path === '/ocr/ingest' && req.method === 'POST') {
    const body = await readBody(req);
    const rawLines = Array.isArray(body.lines)
      ? body.lines.map((l) => String(l).trim()).filter((l) => l.length > 1)
      : String(body.text || '').split('\n').map((l) => l.trim()).filter((l) => l.length > 1);
    const zoneRole = body.zoneRole || 'chat'; // 'chat' | 'gifts' | 'alerts' | 'custom'
    const zoneName = body.zoneName || '';

    if (rawLines.length === 0) {
      return json(res, 200, { ok: true, linesProcessed: 0, triggered: [], noMatch: [] });
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

    // ── Gift recognition patterns ───────────────────────────────────────
    //
    // Pattern A — verb format (Portuguese / English):
    //   "Sender enviou|mandou|sent GiftName [xN]"
    const GIFT_VERB_RE = /^([^@\s][^:]{1,40}?)\s+(?:enviou|mandou|presenteou\s+com|sent)\s+(.+?)(?:\s+[x×]\s*(\d+))?\s*$/i;
    //
    // Pattern B — TikTok notification format (no verb):
    //   "Username [emoji/short-word] x[N]"
    //   e.g. "Slaanesh O x2" where O = ❤ OCR artifact
    //   Applied when line is short (< 55 chars) OR zone role is gifts.
    const GIFT_TIKTOK_RE = /^(.{2,40}?)\s+([^\s]{1,12})\s+[x×]\s*(\d+)\s*$/i;
    //
    // OCR artifacts → canonical gift key mapping.
    // Tesseract commonly substitutes emoji with these chars.
    const OCR_EMOJI_MAP = {
      'o': 'heart', '0': 'heart',       // ❤ / ♥
      'v': 'heart',                      // ❤ V-shape artifact
      'e': 'heart',                      // ❤ E-shape artifact
      'j': 'heart',                      // ❤ J-shape artifact
      '"': 'heart',                      // ❤ curved-glyph reads as double-quote
      "'": 'heart',                      // ❤ single-quote artifact
      'd': 'diamond',                    // 💎
      'r': 'rose',                       // 🌹 (if single letter)
      'f': 'follow',                     // Follow sticker
      'l': 'like',                       // 👍
    };
    function normaliseGiftKey(raw, fromVerbPattern = false) {
      const s = raw.trim();
      if (s.length === 1) return OCR_EMOJI_MAP[s.toLowerCase()] ?? (fromVerbPattern ? 'heart' : s);
      return s;
    }

    const triggered = [];
    const noMatch = [];
    let idleAlreadyBroken = false;

    for (const line of rawLines) {
      // ── Step 1: parse the line ────────────────────────────────────────
      let eventType, eventData, parsedKind;

      const giftVerbMatch = GIFT_VERB_RE.exec(line);
      const tiktokMatch = !giftVerbMatch && (zoneRole === 'gifts' || line.length < 55)
        ? GIFT_TIKTOK_RE.exec(line)
        : null;

      if (giftVerbMatch) {
        // Pattern A: "Sender enviou GiftName x2"
        const giftKey = normaliseGiftKey(giftVerbMatch[2], true); // fromVerbPattern → unknown single-char → 'heart'
        eventType = 'gift';
        parsedKind = 'gift';
        eventData = { giftKey, gift_key: giftKey, sender: giftVerbMatch[1].trim(), count: giftVerbMatch[3] ? parseInt(giftVerbMatch[3]) : 1 };
      } else if (tiktokMatch) {
        // Pattern B: "Slaanesh O x2" (TikTok notification, no verb)
        // Requires explicit count suffix — strong gift signal.
        const giftKey = normaliseGiftKey(tiktokMatch[2]);
        eventType = 'gift';
        parsedKind = 'gift';
        eventData = { giftKey, gift_key: giftKey, sender: tiktokMatch[1].trim(), count: parseInt(tiktokMatch[3]), ocrRaw: tiktokMatch[2] };
      } else {
        // No gift pattern matched → chat event.
        // We do NOT fall back to "everything in gifts zone = gift" because
        // on TikTok, chat and gift notifications appear in the same area.
        eventType = 'comment';
        parsedKind = 'chat';
        eventData = { text: line, message: line };
      }

      // ── Step 2: find matching trigger ────────────────────────────────
      const matchedTrigger = triggers.find((t) => {
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
        noMatch.push({ eventType, kind: parsedKind, line, giftKey: eventData.giftKey, ocrRaw: eventData.ocrRaw, sender: eventData.sender });
        continue;
      }

      // ── Step 3: resolve target video ─────────────────────────────────
      const connection =
        flowConnections.find((c) => c.triggerId === matchedTrigger.id && c.fromNodeId === currentNodeId) ||
        flowConnections.find((c) => c.triggerId === matchedTrigger.id);
      const action = matchedTrigger.actions?.find((a) => a.type === 'play_video');
      const targetNodeId = connection?.toNodeId || action?.nodeId || null;
      const targetNode = targetNodeId ? flowNodes.find((n) => n.nodeId === targetNodeId) : null;
      const targetVideoId = targetNode?.videoId || action?.videoId || null;

      if (!targetVideoId) {
        noMatch.push({ eventType, kind: parsedKind, line, triggerId: matchedTrigger.id, reason: 'no_video_configured' });
        continue;
      }

      // ── Step 4: enqueue trigger ───────────────────────────────────────
      const isIdle = Boolean(targetVideoId === idleVideoId);
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

      // Break idle loop once per batch
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
        giftKey: eventData.giftKey,
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
      ...cloudState(),
    });
  }

  if (path.startsWith('/ocr/')) {
    return json(res, 202, { ok: false, simulated: true, text: '', lines: [], ...cloudState() });
  }

  if (path.startsWith('/memory/')) {
    return json(res, 200, { profiles: [], items: [], context: null, ...cloudState() });
  }

  if (path === '/chat-automation/config' && req.method === 'GET') {
    const config = loadChatAutomationConfig();
    return json(res, 200, { allowlist: config.allowlist, logs: config.logs.slice(-100) });
  }

  if (path === '/chat-automation/config' && req.method === 'POST') {
    const body = await readBody(req);
    const current = loadChatAutomationConfig();
    const next = saveChatAutomationConfig({
      allowlist: normalizeChatAutomationAllowlist(body?.allowlist),
      logs: current.logs,
    });
    return json(res, 200, { allowlist: next.allowlist, logs: next.logs.slice(-100) });
  }

  if (path === '/chat-automation/validate' && req.method === 'POST') {
    const body = await readBody(req);
    return json(res, 200, validateChatAutomationTarget(body));
  }

  if (path === '/chat-automation/send' && req.method === 'POST') {
    const body = await readBody(req);
    return json(res, 200, sendChatAutomationMessageRecord(body));
  }

  if (path === '/conversations' && req.method === 'GET') {
    return json(res, 200, {
      conversations: sortConversations(loadConversations().conversations),
      total: loadConversations().conversations.length,
      ...cloudState(),
    });
  }

  if (path === '/conversations' && req.method === 'POST') {
    const body = await readBody(req);
    return json(res, 200, createConversationRecord(body));
  }

  if (path.startsWith('/conversations/')) {
    const parts = path.split('/').filter(Boolean);
    const conversationId = decodeURIComponent(parts[1] || '');
    const action = parts[2] || '';
    if (!conversationId) return json(res, 400, { detail: 'conversation_id ausente' });

    if (!action && req.method === 'GET') {
      const conversation = findConversation(conversationId);
      if (!conversation) return json(res, 404, { detail: 'Conversation not found' });
      return json(res, 200, conversation);
    }

    if (action === 'messages' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, addConversationMessageRecord(conversationId, body));
    }

    if (action === 'reply' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, await generateConversationReplyRecord(conversationId, body));
    }

    if (action === 'approve' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, approveConversationMessageRecord(conversationId, body));
    }

    return json(res, 405, { detail: 'Metodo ou acao de conversa nao suportado' });
  }

  // ── Proxy genérico da Gemini ───────────────────────────────────────────────
  // O browser NÃO consegue chamar a Gemini direto: o endpoint do Google não
  // responde o preflight CORS, então toda chamada vira "Failed to fetch". Aqui o
  // cliente manda { key, model, payload } e o servidor encaminha o generateContent
  // (mesma origem, sem CORS) devolvendo a resposta do Google tal qual. A chave vem
  // no corpo porque é guardada no cliente (localStorage / VITE_GEMINI_API_KEY).
  if (path.replace(/^\/(api\/)?v1\//, '/') === '/ai/gemini' && req.method === 'POST') {
    const session = getSession(req);
    if (!session) return json(res, 401, { error: 'Não autenticado. Faça login primeiro.' });
    const reqBody = await readBody(req);
    const apiKey = (typeof reqBody?.key === 'string' && reqBody.key.trim()) || GEMINI_KEY;
    if (!apiKey) return json(res, 503, { error: 'Nenhuma chave Gemini disponível (cliente nem servidor).' });
    const model = (typeof reqBody?.model === 'string' && reqBody.model.trim()) || GEMINI_MODEL;
    const payload = reqBody?.payload && typeof reqBody.payload === 'object' ? reqBody.payload : null;
    if (!payload) return json(res, 400, { error: 'payload (corpo do generateContent) é obrigatório.' });
    try {
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20_000),
        },
      );
      const text = await upstream.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
      return json(res, upstream.status, parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      console.error('[ai/gemini proxy]', message);
      return json(res, 502, { error: `Proxy Gemini falhou: ${message}` });
    }
  }

  if (path === '/ai/decide' && req.method === 'POST') {
    const session = getSession(req);
    if (!session) return json(res, 401, { error: 'Não autenticado. Faça login primeiro.' });
    const body = await readBody(req);
    const { ocrEvent, config } = body ?? {};
    if (!ocrEvent?.rawText && !ocrEvent?.normalizedText) {
      return json(res, 400, { error: 'ocrEvent.rawText ou ocrEvent.normalizedText é obrigatório' });
    }
    const hasKey = AI_PROVIDER === 'openai' ? Boolean(OPENAI_KEY) : Boolean(GEMINI_KEY);
    if (!hasKey) {
      return json(res, 503, { error: `${AI_PROVIDER} API key não configurada no servidor`, provider: AI_PROVIDER, available: false });
    }
    try {
      const userMessage = buildAiUserMessage(ocrEvent, config);
      const rawText = AI_PROVIDER === 'openai' ? await callAiOpenAi(userMessage) : await callAiGemini(userMessage);
      if (!rawText) throw new Error('LLM retornou resposta vazia');
      const decision = sanitizeAiDecision(rawText, ocrEvent);
      if (!decision) throw new Error(`Não foi possível parsear a resposta do LLM: ${rawText.slice(0, 80)}`);
      return json(res, 200, decision);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      console.error('[ai/decide]', message);
      return json(res, 502, { error: message, provider: AI_PROVIDER });
    }
  }

  if (path.startsWith('/ai/')) {
    return json(res, 202, { response: '', provider: 'cloud-placeholder', ...cloudState() });
  }

  if (path.startsWith('/tts/')) {
    return json(res, 202, { ok: false, audioUrl: null, ...cloudState() });
  }

  if (path.startsWith('/webhooks')) return json(res, 200, { webhooks: [], ...cloudState() });

  // Force-restart the server process so a fresh deploy takes effect immediately.
  // The process manager (PM2 / Hostinger) will restart it automatically.
  if (path === '/admin/restart' && hasAgentAccess(req)) {
    json(res, 200, { ok: true, message: 'Restarting server...' });
    setTimeout(() => process.exit(0), 200);
    return;
  }

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
