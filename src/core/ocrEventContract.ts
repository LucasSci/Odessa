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
  /** true quando o evento ja foi ingerido pelo backend (evita reprocessamento no cliente). */
  backendIngested?: boolean;
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

