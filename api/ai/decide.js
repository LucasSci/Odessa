/**
 * api/ai/decide.js
 * ─────────────────
 * POST /api/ai/decide
 *
 * Recebe um OcrEvent + config do workflow (vídeos + gatilhos) e
 * retorna um AiDecision gerado por Gemini ou OpenAI.
 *
 * Self-contained — sem imports do app-code para funcionar no Hostinger.
 *
 * Env vars:
 *   AI_PROVIDER           "gemini" | "openai"  (default: gemini)
 *   GEMINI_API_KEY        chave da Gemini API
 *   OPENAI_API_KEY        chave da OpenAI API
 *   OPENAI_TEXT_MODEL     modelo a usar (default: gpt-4o-mini)
 *   AI_DECISION_TIMEOUT   timeout em ms (default: 8000)
 */

const AI_PROVIDER   = (process.env.AI_PROVIDER || 'gemini').toLowerCase().trim();
const GEMINI_KEY    = process.env.GEMINI_API_KEY || '';
const OPENAI_KEY    = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL  = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const GEMINI_MODEL  = 'gemini-2.5-flash';
const TIMEOUT_MS    = Number(process.env.AI_DECISION_TIMEOUT || 8000);

// ── Tipos reutilizados do contrato (sem import) ─────────────────────────────

const VALID_INTENTS = [
  'gift_reaction', 'greeting', 'compliment_response',
  'question_response', 'idle_maintenance', 'special_event', 'unknown',
];
const VALID_EMOTIONS = [
  'happy', 'excited', 'grateful', 'neutral', 'shy', 'playful', 'surprised',
];
const VALID_ACTIONS = ['play_video', 'queue_video', 'wait', 'no_action'];

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `\
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

// ── Formata mensagem do usuário ──────────────────────────────────────────────

function buildUserMessage(ocrEvent, config) {
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
  if (ocrEvent.author) {
    lines.push(`Autor/usuário: ${ocrEvent.author}`);
  }

  if (config?.triggers?.length) {
    const tList = config.triggers
      .filter((t) => t.enabled !== false)
      .slice(0, 10)
      .map((t) => `  - id:"${t.id}" label:"${t.name || t.label || t.id}"`)
      .join('\n');
    lines.push(`\nGatilhos disponíveis:\n${tList}`);
  } else {
    lines.push('\nGatilhos disponíveis: nenhum');
  }

  if (config?.videos?.length) {
    const vList = config.videos
      .slice(0, 10)
      .map((v) => `  - id:"${v.id}" label:"${v.label || v.name || v.id}"`)
      .join('\n');
    lines.push(`\nVídeos disponíveis:\n${vList}`);
  }

  return lines.join('\n');
}

// ── Valida e sanitiza resposta do LLM ────────────────────────────────────────

function sanitizeDecision(raw, ocrEvent) {
  let parsed;
  try {
    // Strip markdown fences if present
    const clean = (raw || '').replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    return null;
  }

  return {
    sourceEvent: ocrEvent,
    intent: VALID_INTENTS.includes(parsed.intent) ? parsed.intent : 'unknown',
    emotion: VALID_EMOTIONS.includes(parsed.emotion) ? parsed.emotion : 'neutral',
    recommendedAction: VALID_ACTIONS.includes(parsed.recommendedAction)
      ? parsed.recommendedAction
      : 'no_action',
    selectedTriggerId: typeof parsed.selectedTriggerId === 'string' ? parsed.selectedTriggerId : null,
    selectedVideoId: typeof parsed.selectedVideoId === 'string' ? parsed.selectedVideoId : null,
    selectedVideoLabel: typeof parsed.selectedVideoLabel === 'string' ? parsed.selectedVideoLabel : null,
    confidence: typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5,
    reasoning: typeof parsed.reasoning === 'string'
      ? parsed.reasoning.slice(0, 200)
      : 'Decisão gerada pela IA.',
    status: 'online',
    timestamp: new Date().toISOString(),
  };
}

// ── Gemini ───────────────────────────────────────────────────────────────────

async function callGemini(userMessage) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 256,
      temperature: 0.3,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 120)}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

async function callOpenAi(userMessage) {
  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 256,
    temperature: 0.3,
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`OpenAI ${res.status}: ${err.slice(0, 120)}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? null;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Parse body
  let body;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  const { ocrEvent, config } = body ?? {};

  if (!ocrEvent?.rawText && !ocrEvent?.normalizedText) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ocrEvent.rawText is required' }));
    return;
  }

  // Check API key availability
  const hasKey = AI_PROVIDER === 'openai' ? Boolean(OPENAI_KEY) : Boolean(GEMINI_KEY);
  if (!hasKey) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: `${AI_PROVIDER} API key not configured`,
      provider: AI_PROVIDER,
      available: false,
    }));
    return;
  }

  try {
    const userMessage = buildUserMessage(ocrEvent, config);
    const rawText = AI_PROVIDER === 'openai'
      ? await callOpenAi(userMessage)
      : await callGemini(userMessage);

    if (!rawText) {
      throw new Error('LLM returned empty response');
    }

    const decision = sanitizeDecision(rawText, ocrEvent);
    if (!decision) {
      throw new Error(`Could not parse LLM response: ${rawText.slice(0, 80)}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(decision));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ai/decide]', message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message, provider: AI_PROVIDER }));
  }
}
