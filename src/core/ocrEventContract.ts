/**
 * Contrato de evento normalizado que sai do OCR em direção à camada de decisão.
 * Toda fonte de captura (OBS, janela, link direto, manual) deve emitir este formato.
 * A camada de IA (futura) consome OcrEvent[] como entrada.
 */

export type OcrEventType = 'comment' | 'gift' | 'follow' | 'like' | 'system' | 'unknown';
export type OcrPlatform = 'tiktok' | 'tango' | 'twitch' | 'youtube' | 'manual' | 'unknown';
export type OcrZoneRole = 'chat' | 'gift' | 'system' | 'custom';

export interface OcrEventMetadata {
  giftName?: string | null;
  giftKey?: string | null;
  giftValue?: number | null;
  giftQuantity?: number | null;
  originalFrameId?: string | null;
  zoneImage?: string | null;          // base64 da zona capturada (para debug)
  visualMatchScore?: number | null;   // score do reconhecimento visual de presente
  matchMethod?: string | null;        // 'ahash' | 'ncc' | 'histogram' | 'color' | 'text'
}

export interface OcrEvent {
  /** ID único do evento */
  id: string;
  /** Fonte que gerou o evento */
  source: 'ocr' | 'manual' | 'test' | 'webhook';
  /** Plataforma da live */
  platform: OcrPlatform;
  /** Zona de captura que gerou o evento */
  zone: OcrZoneRole;
  /** Nome da zona de captura */
  zoneName: string;
  /** Texto bruto extraído pelo OCR */
  rawText: string;
  /** Texto normalizado (sem ruído, deduplicado, unicode) */
  normalizedText: string;
  /** Autor/usuário (quando identificável) */
  author?: string | null;
  /** Tipo do evento classificado */
  eventType: OcrEventType;
  /** Confiança do OCR ou do classificador [0–1] */
  confidence: number;
  /** ISO timestamp de captura */
  timestamp: string;
  /** Metadados adicionais (presentes, etc.) */
  metadata: OcrEventMetadata;
}

// ── Flow de processamento ──────────────────────────────────────────────────────
//
//  1. OCR captura texto bruto da tela
//  2. Parser transforma texto → OcrEvent estruturado
//  3. Filtro remove duplicatas / ruído (normForDedup)
//  4. Motor de regras verifica gatilhos diretos (trigger matching)
//  5. [FUTURO] Motor de IA avalia contexto, intenção e prioridade
//  6. Sistema escolhe clipe/ação
//  7. Palco executa transição
//  8. Ao terminar o clipe, retorna ao IDLE ou próximo estado configurado
//  9. Logs registram todo o processo
//
//  O sistema deve funcionar sem IA (passos 1–4 + 6–9) via fallback de regras.

/** Fábrica de ID de evento */
export function makeOcrEventId(): string {
  return `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Normaliza texto para comparação/deduplicação */
export function normalizeOcrText(raw: string): string {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\sÀ-ɏ]/g, '')
    .trim();
}

/** Converte texto bruto em OcrEvent parcial (sem classificação de IA) */
export function buildOcrEvent(
  rawText: string,
  opts: {
    source?: OcrEvent['source'];
    platform?: OcrPlatform;
    zone?: OcrZoneRole;
    zoneName?: string;
    eventType?: OcrEventType;
    confidence?: number;
    metadata?: Partial<OcrEventMetadata>;
    author?: string | null;
  } = {},
): OcrEvent {
  return {
    id: makeOcrEventId(),
    source: opts.source ?? 'ocr',
    platform: opts.platform ?? 'unknown',
    zone: opts.zone ?? 'chat',
    zoneName: opts.zoneName ?? 'chat',
    rawText,
    normalizedText: normalizeOcrText(rawText),
    author: opts.author ?? null,
    eventType: opts.eventType ?? 'unknown',
    confidence: opts.confidence ?? 1,
    timestamp: new Date().toISOString(),
    metadata: {
      giftName: null,
      giftKey: null,
      giftValue: null,
      giftQuantity: null,
      originalFrameId: null,
      zoneImage: null,
      visualMatchScore: null,
      matchMethod: null,
      ...opts.metadata,
    },
  };
}
