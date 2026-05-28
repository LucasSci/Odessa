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
import { getEffectiveGeminiKey, getEffectiveSystemPrompt, getAiConfig } from './aiConfig';

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
