/**
 * ocrPipeline.ts
 * --------------
 * Single entry point for all captured text in Odessa.
 *
 * Pipeline:
 *   text input (OCR, test, manual)
 *   → parseCapturedText()   — classifies the text into a structured event
 *   → handleParsedEvent()   — applies rules, triggers video
 *   → onCapturedText()      — the public entry point that runs the full pipeline
 *
 * The video trigger uses the same POST /api/video/force path as manual clicks.
 * No AI, no TTS, no persona — just: text → event → video.
 */

// ─── Config ───────────────────────────────────────────────────────────────────

/** The video ID to play when a gift is detected. Change to match your catalog. */
export const DEFAULT_GIFT_VIDEO_ID = 'thank_you_for_the_gift';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventKind = 'gift' | 'chat' | 'moderation' | 'alert' | 'system' | 'unknown';

export interface ParsedEvent {
  kind: EventKind;
  rawText: string;
  source: string;
  // gift-specific
  sender?: string;
  giftName?: string;
  quantity?: number;
  // chat-specific
  user?: string;
  message?: string;
  // common
  timestamp: string;
}

export interface PipelineContext {
  source?: string;
}

export interface PipelineResult {
  event: ParsedEvent;
  videoTriggered: string | null;
  blocked: boolean;
  blockedReason: string | null;
  logs: string[];
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

export const runtimeCapabilities = {
  videoPlayback: true,
  manualVideoClick: true,
  ocrCapture: true,
  simulatedOCR: true,
  messageParsing: true,
  giftDetection: true,
  giftTriggers: true,
  flowTriggers: true,
  legacyAI: false,
  tts: false,
  personaConfig: false,
};

export function logCapabilities() {
  console.log(
    '[CAPABILITIES] videoPlayback:',
    runtimeCapabilities.videoPlayback ? 'enabled' : 'disabled',
  );
  console.log(
    '[CAPABILITIES] manualVideoClick:',
    runtimeCapabilities.manualVideoClick ? 'enabled' : 'disabled',
  );
  console.log(
    '[CAPABILITIES] ocrCapture:',
    runtimeCapabilities.ocrCapture ? 'enabled' : 'disabled',
  );
  console.log(
    '[CAPABILITIES] simulatedOCR:',
    runtimeCapabilities.simulatedOCR ? 'enabled' : 'disabled',
  );
  console.log(
    '[CAPABILITIES] messageParsing:',
    runtimeCapabilities.messageParsing ? 'enabled' : 'disabled',
  );
  console.log(
    '[CAPABILITIES] giftDetection:',
    runtimeCapabilities.giftDetection ? 'enabled' : 'disabled',
  );
  console.log(
    '[CAPABILITIES] giftTriggers:',
    runtimeCapabilities.giftTriggers ? 'enabled' : 'disabled',
  );
  console.log('[CAPABILITIES] legacyAI:', runtimeCapabilities.legacyAI ? 'enabled' : 'disabled');
  console.log('[CAPABILITIES] tts:', runtimeCapabilities.tts ? 'enabled' : 'disabled');
  console.log(
    '[CAPABILITIES] personaConfig:',
    runtimeCapabilities.personaConfig ? 'enabled' : 'disabled',
  );
}

// ─── Patterns ─────────────────────────────────────────────────────────────────

/**
 * Gift pattern: "Sender enviou|mandou|presenteou com GiftName [xN]"
 * Capture groups: [1]=sender, [2]=verb, [3]=giftName, [4]=quantity (optional)
 *
 * Does NOT match if text starts with '@' (always chat).
 */
const GIFT_RE =
  /^([^@\s][^:]{1,40}?)\s+(?:enviou|mandou|presenteou\s+com|sent)\s+(.+?)(?:\s+x\s*(\d+))?\s*$/i;

const SPAM_RE =
  /(spam|compre\s+seguidores|ganhe\s+dinheiro|www\.[a-z0-9-]+\.[a-z]{2,}|https?:\/\/|seguidor\s+barato)/i;

const AT_MENTION_RE = /^@([A-Za-z0-9_.-]{2,32})\s*:\s*(.+)/;

// ─── parseCapturedText ────────────────────────────────────────────────────────

/**
 * Deterministically parse raw text into a structured event.
 * No AI. Pure regex rules.
 */
export function parseCapturedText(rawText: string, context: PipelineContext = {}): ParsedEvent {
  const text = rawText.replace(/^(OCR|Chat|Presentes|Gifts|Alertas):\s*/i, '').trim();
  const source = context.source ?? 'unknown';
  const timestamp = new Date().toISOString();

  // ① Spam / moderation — highest priority
  if (SPAM_RE.test(text)) {
    return { kind: 'moderation', rawText, source, timestamp };
  }

  // ② @user: message — always chat, never gift
  const atMatch = AT_MENTION_RE.exec(text);
  if (atMatch) {
    return {
      kind: 'chat',
      rawText,
      source,
      timestamp,
      user: atMatch[1],
      message: atMatch[2].trim(),
    };
  }

  // ③ Gift pattern
  const giftMatch = GIFT_RE.exec(text);
  if (giftMatch) {
    const sender = giftMatch[1].trim();
    const giftName = giftMatch[2].trim();
    const quantity = giftMatch[3] ? Number(giftMatch[3]) : 1;

    return { kind: 'gift', rawText, source, timestamp, sender, giftName, quantity };
  }

  // ④ Default: treat as chat
  return { kind: 'chat', rawText, source, timestamp, message: text };
}

// ─── Video trigger (injected) ─────────────────────────────────────────────────

/**
 * The video trigger function is set externally by the React layer
 * (OdessaLiveCenter / PersonaStudio) so this module stays framework-agnostic.
 *
 * In tests, you can override it to spy on calls.
 */
let _triggerVideoFn: ((videoId: string, reason: string) => void) | null = null;

export function setVideoTriggerFn(fn: (videoId: string, reason: string) => void) {
  _triggerVideoFn = fn;
}

export function getVideoTriggerFn() {
  return _triggerVideoFn;
}

// ─── handleParsedEvent ────────────────────────────────────────────────────────

/**
 * Apply rules and trigger video if the event is a gift.
 */
export function handleParsedEvent(event: ParsedEvent, logs: string[]): string | null {
  logs.push(`[EVENT_PIPELINE] event_received: ${JSON.stringify(event)}`);

  if (event.kind !== 'gift') {
    logs.push(`[EVENT_PIPELINE] no_trigger_for_event: ${event.kind}`);
    return null;
  }

  const videoId = DEFAULT_GIFT_VIDEO_ID;
  logs.push(
    `[GIFT_TRIGGER] gift_detected: ${event.giftName} x${event.quantity} de ${event.sender}`,
  );
  logs.push(`[GIFT_TRIGGER] video_selected: ${videoId}`);

  if (!_triggerVideoFn) {
    logs.push('[GIFT_TRIGGER_ERROR] play_function_not_found');
    return null;
  }

  try {
    _triggerVideoFn(videoId, 'gift_detected');
    return videoId;
  } catch (err) {
    logs.push(
      `[GIFT_TRIGGER_ERROR] play_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ─── onCapturedText ───────────────────────────────────────────────────────────

/**
 * THE single public entry point for all captured text.
 *
 * Whether it comes from real OCR, a test button, or simulateOCRText(),
 * it all goes through here.
 */
export function onCapturedText(rawText: string, context: PipelineContext = {}): PipelineResult {
  const logs: string[] = [];

  logs.push(`[OCR_PIPELINE] text_received: ${rawText}`);

  let event: ParsedEvent;
  try {
    event = parseCapturedText(rawText, context);
    logs.push(`[OCR_PIPELINE] event_parsed: ${event.kind}`);
  } catch (err) {
    logs.push(
      `[OCR_PIPELINE_ERROR] parse_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    const fallback: ParsedEvent = {
      kind: 'unknown',
      rawText,
      source: context.source ?? 'unknown',
      timestamp: new Date().toISOString(),
    };
    return {
      event: fallback,
      videoTriggered: null,
      blocked: true,
      blockedReason: 'parse_failed',
      logs,
    };
  }

  const videoTriggered = handleParsedEvent(event, logs);

  return {
    event,
    videoTriggered,
    blocked: videoTriggered === null,
    blockedReason:
      videoTriggered === null ? (logs.find((l) => l.includes('_ERROR]')) ?? null) : null,
    logs,
  };
}

// ─── simulateOCRText ─────────────────────────────────────────────────────────

/**
 * Simulates OCR input without needing a real live stream.
 * Passes through the exact same pipeline as real OCR.
 *
 * Usage: simulateOCRText("Lucas enviou Rosa")
 */
export function simulateOCRText(text: string): PipelineResult {
  return onCapturedText(text, { source: 'test_ocr' });
}

// ─── isGiftEvent ──────────────────────────────────────────────────────────────

/**
 * Returns true if a raw event object (from capturedText) looks like a gift.
 * Used by OdessaLiveCenter to watch incoming events.
 */
export function isGiftEvent(event: { kind?: string; text?: string }): boolean {
  if (event.kind === 'gift') return true;
  const text = (event.text || '').trim();
  if (!text || text.startsWith('@')) return false;
  return GIFT_RE.test(text);
}
