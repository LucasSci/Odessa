import { normalizeTangoMessage, normalizeTangoUser } from './platformParsers/tangoChatParser';

export interface ChatDedupeInput {
  kind: string;
  user: string | null;
  message: string;
  rawText: string;
  rowHash: string;
  confidence: number;
}

export interface ChatDedupeOptions {
  ttlMs?: number;
  now?: number;
  minConfidence?: number;
}

export interface ChatDedupeResult {
  duplicate: boolean;
  reason?: string;
  key: string;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MIN_CONFIDENCE = 0.45;

export class ChatDedupeCache {
  private readonly seen = new Map<string, number>();

  constructor(private readonly defaultTtlMs = DEFAULT_TTL_MS) {}

  check(input: ChatDedupeInput, options: ChatDedupeOptions = {}): ChatDedupeResult {
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.prune(now, ttlMs);

    const normalizedMessage = normalizeTangoMessage(input.message || input.rawText);
    const normalizedUser = normalizeTangoUser(input.user) || 'anon';
    const key = `${input.kind}:${normalizedUser}:${normalizedMessage}`;
    const rowKey = `row:${input.rowHash}`;

    if (!normalizedMessage) return { duplicate: true, reason: 'empty_message', key };
    if (input.confidence < minConfidence) return { duplicate: true, reason: 'low_confidence', key };
    if (this.seen.has(key) || this.seen.has(rowKey)) {
      return { duplicate: true, reason: 'seen_recently', key };
    }

    this.seen.set(key, now);
    this.seen.set(rowKey, now);
    return { duplicate: false, key };
  }

  reset() {
    this.seen.clear();
  }

  private prune(now: number, ttlMs: number) {
    for (const [key, seenAt] of this.seen.entries()) {
      if (now - seenAt > ttlMs) this.seen.delete(key);
    }
  }
}

export const globalChatDedupe = new ChatDedupeCache();
