/**
 * Contrato de decisão da IA.
 *
 * Três caminhos de execução:
 *  1. Direct Gemini (preferencial) — usa getEffectiveGeminiKey() que verifica
 *     VITE_GEMINI_API_KEY (build) e depois localStorage (configurado na aba IA).
 *  2. Server endpoint (/api/ai/decide) — fallback para servidor.
 *  3. Mock engine — fallback final para simulação local.
 */

import type { OcrEvent } from './ocrEventContract';
import type { LiveEvent } from '../types';
import { getEffectiveGeminiKey, getEffectiveSystemPrompt, getAiConfig, hasActiveGeminiKey } from './aiConfig';

export type AiStatus = 'offline' | 'simulated' | 'online' | 'checking';
export type AiIntentType =
  | 'gift_reaction'
  | 'greeting'
  | 'compliment_response'
  | 'question_response'
  | 'idle_maintenance'
  | 'special_event'
  | 'unknown';

export type EmotionTone =
  | 'happy'
  | 'excited'
  | 'grateful'
  | 'neutral'
  | 'shy'
  | 'playful'
  | 'surprised';

export interface AiDecision {
  /** Mensagem/evento que gerou a decisão */
  sourceEvent: OcrEvent | null;
  /** Intenção detectada */
  intent: AiIntentType;
  /** Emoção/tom sugerido para a persona */
  emotion: EmotionTone;
  /** Ação recomendada */
  recommendedAction: 'play_video' | 'queue_video' | 'wait' | 'no_action';
  /** ID do gatilho selecionado */
  selectedTriggerId: string | null;
  /** ID do vídeo selecionado */
  selectedVideoId: string | null;
  /** Label do vídeo para exibição */
  selectedVideoLabel: string | null;
  /** Confiança da decisão [0–1] */
  confidence: number;
  /** Motivo da escolha (texto legível) */
  reasoning: string;
  /** Estado da IA */
  status: AiStatus;
  /** Timestamp da decisão */
  timestamp: string;
}

/** Decisão vazia / estado inicial */
export const EMPTY_AI_DECISION: AiDecision = {
  sourceEvent: null,
  intent: 'unknown',
  emotion: 'neutral',
  recommendedAction: 'no_action',
  selectedTriggerId: null,
  selectedVideoId: null,
  selectedVideoLabel: null,
  confidence: 0,
  reasoning: 'Aguardando eventos.',
  status: 'offline',
  timestamp: new Date().toISOString(),
};

/** Labels legíveis para intenções */
export const INTENT_LABELS: Record<AiIntentType, string> = {
  gift_reaction: 'Reação a presente',
  greeting: 'Saudação',
  compliment_response: 'Resposta a elogio',
  question_response: 'Resposta a pergunta',
  idle_maintenance: 'Manutenção do idle',
  special_event: 'Evento especial',
  unknown: 'Desconhecido',
};

/** Labels legíveis para emoções */
export const EMOTION_LABELS: Record<EmotionTone, string> = {
  happy: 'Feliz',
  excited: 'Animada',
  grateful: 'Grata',
  neutral: 'Neutra',
  shy: 'Tímida',
  playful: 'Brincalhona',
  surprised: 'Surpresa',
};

/** Labels de ação */
export const ACTION_LABELS: Record<AiDecision['recommendedAction'], string> = {
  play_video: 'Tocar vídeo',
  queue_video: 'Enfileirar vídeo',
  wait: 'Aguardar',
  no_action: 'Sem ação',
};

/**
 * Decisão "checking" — placeholder enquanto a chamada assíncrona está em voo.
 */
export function checkingAiDecision(event: OcrEvent): AiDecision {
  return {
    sourceEvent: event,
    intent: 'unknown',
    emotion: 'neutral',
    recommendedAction: 'no_action',
    selectedTriggerId: null,
    selectedVideoId: null,
    selectedVideoLabel: null,
    confidence: 0,
    reasoning: 'Consultando IA...',
    status: 'checking',
    timestamp: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini direct (client-side)
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-2.5-flash';
const AI_TIMEOUT_MS = 10_000;

const AI_VALID_INTENTS = ['gift_reaction','greeting','compliment_response','question_response','idle_maintenance','special_event','unknown'];
const AI_VALID_EMOTIONS = ['happy','excited','grateful','neutral','shy','playful','surprised'];
const AI_VALID_ACTIONS  = ['play_video','queue_video','wait','no_action'];

export type AiConfig = {
  videos?: Array<{ id: string; label?: string; name?: string }>;
  triggers?: Array<{ id: string; name?: string; label?: string; enabled?: boolean }>;
};

export function buildAiUserMessage(event: OcrEvent, config?: AiConfig): string {
  const lines: string[] = [
    `Tipo de evento: ${event.eventType ?? 'desconhecido'}`,
    `Texto bruto: "${event.rawText ?? ''}"`,
    `Texto normalizado: "${event.normalizedText ?? ''}"`,
    `Zona: ${event.zoneName ?? 'desconhecida'} (${event.zone ?? ''})`,
    `Confiança do OCR: ${Math.round((event.confidence ?? 0) * 100)}%`,
  ];
  const meta = event.metadata as Record<string, string> | undefined;
  if (meta?.giftName || meta?.giftKey) {
    lines.push(`Presente: ${meta.giftName || meta.giftKey}`);
  }
  if (event.author) lines.push(`Autor/usuário: ${event.author}`);
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

function sanitizeAiDecision(raw: string, event: OcrEvent): AiDecision | null {
  let parsed: Record<string, unknown>;
  try {
    const clean = (raw || '').replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    return null;
  }
  return {
    sourceEvent: event,
    intent: AI_VALID_INTENTS.includes(parsed.intent as string) ? (parsed.intent as AiIntentType) : 'unknown',
    emotion: AI_VALID_EMOTIONS.includes(parsed.emotion as string) ? (parsed.emotion as EmotionTone) : 'neutral',
    recommendedAction: AI_VALID_ACTIONS.includes(parsed.recommendedAction as string)
      ? (parsed.recommendedAction as AiDecision['recommendedAction'])
      : 'no_action',
    selectedTriggerId: typeof parsed.selectedTriggerId === 'string' ? parsed.selectedTriggerId : null,
    selectedVideoId: typeof parsed.selectedVideoId === 'string' ? parsed.selectedVideoId : null,
    selectedVideoLabel: typeof parsed.selectedVideoLabel === 'string' ? parsed.selectedVideoLabel : null,
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    reasoning: typeof parsed.reasoning === 'string' ? (parsed.reasoning as string).slice(0, 200) : 'Decisão gerada pela IA.',
    status: 'online',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Chama a Gemini API diretamente do browser.
 * Usa getEffectiveGeminiKey() — verifica VITE_GEMINI_API_KEY (build) e depois localStorage.
 * Retorna null se nenhuma chave estiver disponível.
 * Exportada para que AiConfigPanel possa testá-la isoladamente.
 */
export async function callGeminiDirect(event: OcrEvent, config?: AiConfig): Promise<AiDecision | null> {
  const apiKey = getEffectiveGeminiKey();
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: getEffectiveSystemPrompt() }] },
    contents: [{ role: 'user', parts: [{ text: buildAiUserMessage(event, config) }] }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 256, temperature: 0.3 },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 120)}`);
  }

  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  if (!rawText) throw new Error('Gemini retornou resposta vazia');

  return sanitizeAiDecision(rawText, event);
}

// ─────────────────────────────────────────────────────────────────────────────
// Diretora — decisão de rodada (cérebro único)
// ─────────────────────────────────────────────────────────────────────────────
//
// Diferente de callGeminiDirect (que escolhe apenas um vídeo), a Diretora recebe
// uma RODADA de eventos + o contexto rico (persona, memória, humor, biblioteca) e
// devolve uma decisão completa no formato PersonaDecision: fala + lista de ações
// (tocar vídeo, trocar cena, responder no chat, etc.). É multilíngue por natureza:
// o modelo lê qualquer idioma e casa por significado, não por palavra exata.

/** Contexto que a Diretora recebe para decidir a rodada. */
export type DirectorContext = {
  /** Prompt de sistema completo (persona + memória + humor + biblioteca + RAG). */
  systemPrompt: string;
  /** Vídeos disponíveis para a IA escolher (id + label). */
  videos?: Array<{ id: string; label?: string; name?: string; title?: string }>;
  /** Gatilhos configurados (referência para a IA). */
  triggers?: Array<{ id: string; name?: string; label?: string; enabled?: boolean }>;
  /** Cenas de OBS permitidas (para switch_scene). */
  scenes?: string[];
  /** Ferramentas habilitadas (capabilities que a IA pode usar). */
  tools?: Array<{ capability: string; label?: string; enabled?: boolean }>;
  /** Temperatura da geração (humor). Default 0.6. */
  temperature?: number;
};

/** Decisão crua devolvida pela Diretora — passa por normalizeDecision no chamador. */
export type RawDirectorDecision = {
  context_analysis?: string;
  sentiment?: string;
  speech: string;
  intent: string;
  confidence: number;
  reason: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  actions: Array<{
    type: string;
    capability?: string;
    label?: string;
    payload?: Record<string, unknown>;
  }>;
};

const DIRECTOR_INSTRUCTION = `\
Você está dirigindo uma rodada ao vivo. Receberá um lote de eventos capturados (chat, presentes,
alertas, sistema). IMPORTANTE: o chat pode estar em QUALQUER idioma — interprete pelo SIGNIFICADO,
não pela palavra exata. Os gatilhos/vídeos podem ter nomes em português; case por intenção.

Responda SOMENTE com um objeto JSON válido (sem markdown, sem texto fora do JSON):
{
  "context_analysis": "<o que está acontecendo na rodada, 1 frase>",
  "sentiment": "positivo" | "neutro" | "negativo",
  "speech": "<UMA fala curta da persona, em português do Brasil>",
  "intent": "<intenção curta, ex: ack_gift, welcome, respond_chat, recover_quiet>",
  "confidence": <número entre 0 e 1>,
  "reason": "<por que essa decisão, curto>",
  "priority": "low" | "normal" | "high" | "urgent",
  "actions": [
    { "type": "play_video", "payload": { "videoId": "<id EXATO da lista de vídeos>" } },
    { "type": "switch_scene", "payload": { "sceneName": "<cena EXATA da lista>" } },
    { "type": "chat_reply", "payload": { "message": "<resposta curta no chat>" } }
  ]
}

Regras:
- No máximo UMA fala por rodada. Chat comum vira contexto quando houver presente/resgate/moderação.
- Só inclua "play_video" se algum vídeo da lista fizer sentido para o evento; use o id EXATO.
- Só inclua "switch_scene" se a cena estiver na lista de cenas permitidas.
- Para presente, prefira reagir (play_video) e agradecer sem pressionar a gastar.
- Se nada relevante, retorne actions: [] e uma fala leve de manutenção.
- Tipos de ação válidos: speak, chat_reply, ack_gift, moderate_message, switch_scene,
  show_overlay, play_music, play_video, webhook, stop_media, set_topic, suggest_topic, remember.`;

function buildDirectorUserMessage(events: LiveEvent[], ctx: DirectorContext): string {
  const lines: string[] = [];
  lines.push('EVENTOS DA RODADA:');
  events.forEach((ev, i) => {
    const meta = (ev.metadata || {}) as Record<string, unknown>;
    const extra: string[] = [];
    if (meta.user) extra.push(`autor:${String(meta.user)}`);
    if (meta.giftName) extra.push(`presente:${String(meta.giftName)}`);
    if (meta.quantity) extra.push(`x${String(meta.quantity)}`);
    lines.push(`  ${i + 1}. [${ev.kind}/${ev.source}] "${ev.text}"${extra.length ? ` (${extra.join(' ')})` : ''}`);
  });

  const vids = (ctx.videos || []).slice(0, 24);
  if (vids.length) {
    lines.push('\nVÍDEOS DISPONÍVEIS (use o id EXATO em play_video):');
    vids.forEach((v) => lines.push(`  - id:"${v.id}" label:"${v.label || v.name || v.title || v.id}"`));
  } else {
    lines.push('\nVÍDEOS DISPONÍVEIS: nenhum (não use play_video).');
  }

  const scenes = (ctx.scenes || []).slice(0, 16);
  if (scenes.length) {
    lines.push('\nCENAS PERMITIDAS (use o nome EXATO em switch_scene):');
    scenes.forEach((s) => lines.push(`  - "${s}"`));
  } else {
    lines.push('\nCENAS PERMITIDAS: nenhuma (não use switch_scene).');
  }

  const tools = (ctx.tools || []).filter((t) => t.enabled !== false).slice(0, 20);
  if (tools.length) {
    lines.push('\nFERRAMENTAS HABILITADAS:');
    lines.push('  ' + tools.map((t) => t.capability).join(', '));
  }

  lines.push(`\n${DIRECTOR_INSTRUCTION}`);
  return lines.join('\n');
}

function parseDirectorDecision(raw: string): RawDirectorDecision | null {
  let parsed: Record<string, unknown>;
  try {
    const clean = (raw || '').replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof parsed.speech !== 'string' && !Array.isArray(parsed.actions)) return null;
  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const actions = rawActions
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object')
    .map((a) => ({
      type: typeof a.type === 'string' ? a.type : 'log_event',
      capability: typeof a.capability === 'string' ? a.capability : undefined,
      label: typeof a.label === 'string' ? a.label : undefined,
      payload: (a.payload && typeof a.payload === 'object' ? a.payload : {}) as Record<string, unknown>,
    }));
  return {
    context_analysis: typeof parsed.context_analysis === 'string' ? parsed.context_analysis : undefined,
    sentiment: typeof parsed.sentiment === 'string' ? parsed.sentiment : undefined,
    speech: typeof parsed.speech === 'string' ? parsed.speech : '',
    intent: typeof parsed.intent === 'string' ? parsed.intent : 'respond_live_event',
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : 'Decisão da Diretora.',
    priority: (['low', 'normal', 'high', 'urgent'] as const).includes(parsed.priority as never)
      ? (parsed.priority as RawDirectorDecision['priority'])
      : 'normal',
    actions,
  };
}

/**
 * Chama a Diretora (Gemini direto, multilíngue) para decidir a rodada inteira.
 * Retorna null se não houver chave disponível (chamador usa fallback local).
 * Lança em erro de rede/HTTP (chamador trata).
 */
export async function callDirectorDecision(
  events: LiveEvent[],
  ctx: DirectorContext,
): Promise<RawDirectorDecision | null> {
  const apiKey = getEffectiveGeminiKey();
  if (!apiKey) return null;
  if (!events.length) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: ctx.systemPrompt || getEffectiveSystemPrompt() }] },
    contents: [{ role: 'user', parts: [{ text: buildDirectorUserMessage(events, ctx) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 640,
      temperature: typeof ctx.temperature === 'number' ? ctx.temperature : 0.6,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 120)}`);
  }

  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  if (!rawText) throw new Error('Diretora: Gemini retornou resposta vazia');

  return parseDirectorDecision(rawText);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ponto de entrada principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chama o motor de decisão da IA.
 *
 * Ordem de tentativa:
 *  1. Gemini direto do browser (se chave disponível via build ou localStorage e
 *     provider !== 'mock')
 *  2. Endpoint do servidor /api/ai/decide (status 200 explícito — ignora 202)
 *  3. Mock engine (simulação local)
 */
export async function callAiDecision(
  event: OcrEvent,
  config?: AiConfig,
): Promise<AiDecision> {
  const { provider } = getAiConfig();

  // ── 1. Gemini direto ──────────────────────────────────────────────────────
  if (provider !== 'mock' && hasActiveGeminiKey()) {
    try {
      const decision = await callGeminiDirect(event, config);
      if (decision) return decision;
    } catch (err) {
      console.warn('[callAiDecision] direct Gemini error:', err instanceof Error ? err.message : err);
    }
  }

  // Se provider === 'mock', pula direto para o mock sem tentar o servidor
  if (provider === 'mock') return mockAiDecision(event);

  // ── 2. Server endpoint ────────────────────────────────────────────────────
  try {
    const res = await fetch('/api/ai/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ocrEvent: event, config }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    // Apenas 200 é resposta válida de decisão (202 = cloud-placeholder, 503 = sem key)
    if (res.status === 200) {
      const decision = (await res.json()) as AiDecision;
      return { ...decision, sourceEvent: event };
    }

    if (res.status !== 503 && res.status !== 202) {
      const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
      console.warn('[callAiDecision] server error:', err.error);
    }
  } catch (err) {
    console.warn('[callAiDecision] server unavailable:', err instanceof Error ? err.message : err);
  }

  // ── 3. Mock ───────────────────────────────────────────────────────────────
  return mockAiDecision(event);
}

/**
 * Mock engine — simula uma decisão de IA com base no tipo de evento OCR.
 */
export function mockAiDecision(event: OcrEvent): AiDecision {
  const base: Omit<AiDecision, 'intent' | 'emotion' | 'recommendedAction' | 'reasoning' | 'confidence'> = {
    sourceEvent: event,
    selectedTriggerId: null,
    selectedVideoId: null,
    selectedVideoLabel: null,
    status: 'simulated',
    timestamp: new Date().toISOString(),
  };

  if (event.eventType === 'gift') {
    const meta = event.metadata as Record<string, string> | undefined;
    const giftName = meta?.giftName || meta?.giftKey || 'presente';
    return {
      ...base,
      intent: 'gift_reaction',
      emotion: 'excited',
      recommendedAction: 'play_video',
      confidence: 0.92,
      reasoning: `Presente "${giftName}" detectado. Reação imediata tem alta prioridade.`,
    };
  }

  if (event.eventType === 'comment') {
    const text = event.normalizedText;
    if (/linda|bonita|gostosa|amor|amo/.test(text)) {
      return {
        ...base,
        intent: 'compliment_response',
        emotion: 'shy',
        recommendedAction: 'play_video',
        confidence: 0.78,
        reasoning: 'Elogio detectado no comentário. Resposta tímida sugerida.',
      };
    }
    if (/oi|olá|hello|boa noite|boa tarde|bom dia/.test(text)) {
      return {
        ...base,
        intent: 'greeting',
        emotion: 'happy',
        recommendedAction: 'play_video',
        confidence: 0.85,
        reasoning: 'Saudação no chat. Resposta amigável com alta confiança.',
      };
    }
  }

  if (event.eventType === 'follow') {
    return {
      ...base,
      intent: 'greeting',
      emotion: 'grateful',
      recommendedAction: 'play_video',
      confidence: 0.88,
      reasoning: 'Novo seguidor. Agradecimento programado.',
    };
  }

  return {
    ...base,
    intent: 'idle_maintenance',
    emotion: 'neutral',
    recommendedAction: 'wait',
    confidence: 0.45,
    reasoning: 'Evento de baixa prioridade. Mantendo idle.',
  };
}
