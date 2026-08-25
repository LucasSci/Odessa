import type { LiveEvent } from '../types';
import { ChatDedupeCache, globalChatDedupe } from './chatDedupe';
import { parseTangoChatLine } from './platformParsers/tangoChatParser';

export type ChatCaptureMode = 'obs' | 'screen' | 'direct';

export interface ChatCapturePipelineInput {
  lines?: string[];
  text?: string;
  zoneName?: string;
  confidence?: number | null;
  captureMode?: string | null;
  backendIngested?: boolean;
  now?: Date;
  dedupe?: ChatDedupeCache;
  ownNames?: string[];
  minConfidence?: number;
  dedupeWindowMs?: number;
}

export interface ChatCapturePipelineResult {
  events: LiveEvent[];
  discarded: Array<{ line: string; reason: string }>;
}

function formatClock(date: Date) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function hashChatRow(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeCaptureMode(mode?: string | null): ChatCaptureMode {
  return mode === 'obs' || mode === 'direct' || mode === 'screen' ? mode : 'screen';
}

function inputLines(input: ChatCapturePipelineInput) {
  const lines = input.lines?.length ? input.lines : String(input.text || '').split('\n');
  return lines.map((line) => line.trim()).filter(Boolean);
}

export function processChatCapture(input: ChatCapturePipelineInput): ChatCapturePipelineResult {
  const dedupe = input.dedupe || globalChatDedupe;
  const now = input.now || new Date();
  const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 1)));
  const captureMode = normalizeCaptureMode(input.captureMode);
  const zoneName = /tango|chat/i.test(input.zoneName || '') ? 'Chat Tango' : input.zoneName || 'Chat Tango';
  const events: LiveEvent[] = [];
  const discarded: Array<{ line: string; reason: string }> = [];

  for (const line of inputLines(input)) {
    const parsed = parseTangoChatLine(line, {
      confidence,
      ownNames: input.ownNames,
      minConfidence: input.minConfidence,
    });
    if (parsed.discarded) {
      discarded.push({ line, reason: parsed.reason });
      continue;
    }

    const rowHash = hashChatRow(`${parsed.user || 'anon'}:${parsed.message}`);
    const dedupeResult = dedupe.check({
      kind: parsed.kind,
      user: parsed.user,
      message: parsed.message,
      rawText: parsed.rawText,
      rowHash,
      confidence: parsed.confidence,
    }, {
      now: now.getTime(),
      ttlMs: input.dedupeWindowMs,
      minConfidence: input.minConfidence,
    });
    if (dedupeResult.duplicate) {
      discarded.push({ line, reason: dedupeResult.reason || 'duplicate' });
      continue;
    }

    events.push({
      id: makeId('chat-ocr'),
      source: 'ocr',
      kind: parsed.kind,
      zoneName,
      text: parsed.text,
      createdAt: now.toISOString(),
      time: formatClock(now),
      metadata: {
        platform: 'tango',
        user: parsed.user ?? '',
        message: parsed.message,
        rawText: parsed.rawText,
        confidence: parsed.confidence,
        rowHash,
        dedupeHash: dedupeResult.key,
        captureMode,
        backendIngested: input.backendIngested === true,
        ...(parsed.metadata || {}),
      },
    });
  }

  return { events, discarded };
}
