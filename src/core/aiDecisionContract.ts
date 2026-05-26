/**
 * Contrato de decisão da IA.
 * Por enquanto apenas mock — a interface e os tipos estão prontos para
 * integração com um motor de IA real (Gemini, GPT, ou motor local).
 */

import type { OcrEvent } from './ocrEventContract';

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

/**
 * Chama o endpoint real de decisão da IA (POST /api/ai/decide).
 * Retorna status 'online' em caso de sucesso.
 * Cai automaticamente para mockAiDecision (status 'simulated') em caso de erro
 * ou se o servidor não estiver configurado (sem chave de API).
 */
export async function callAiDecision(
  event: OcrEvent,
  config?: { videos?: Array<{ id: string; label?: string; name?: string }>; triggers?: Array<{ id: string; name?: string; label?: string; enabled?: boolean }> },
): Promise<AiDecision> {
  try {
    const res = await fetch('/api/ai/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ocrEvent: event, config }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // 503 = API key not configured → silently fall back to mock
      if (res.status !== 503) {
        const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
        console.warn('[callAiDecision] server error:', err.error);
      }
      return mockAiDecision(event);
    }

    const decision = (await res.json()) as AiDecision;
    return { ...decision, sourceEvent: event };
  } catch (err) {
    // Network error / timeout → fall back silently
    console.warn('[callAiDecision] fallback to mock:', err instanceof Error ? err.message : err);
    return mockAiDecision(event);
  }
}

/**
 * Mock engine — simula uma decisão de IA com base no tipo de evento OCR.
 * Substituir por chamada real à API de IA quando disponível.
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
    const giftName = event.metadata.giftName || event.metadata.giftKey || 'presente';
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
