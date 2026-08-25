import type { LiveEventKind } from '../../types';

export type TangoParsedChatLine =
  | {
      discarded: true;
      reason: string;
      rawText: string;
      confidence: number;
    }
  | {
      discarded: false;
      kind: Extract<LiveEventKind, 'chat' | 'gift' | 'alert' | 'moderation'>;
      user: string | null;
      message: string;
      text: string;
      rawText: string;
      confidence: number;
      metadata?: Record<string, unknown>;
    };

export interface TangoParseOptions {
  confidence?: number | null;
  ownNames?: string[];
  minConfidence?: number;
}

const DEFAULT_OWN_NAMES = ['odessa', 'juju'];
const DEFAULT_MIN_CONFIDENCE = 0.45;

const GIFT_RE =
  /^@?(.{2,40}?)\s+(?:enviou|mandou|presenteou\s+com|sent|send|gifted)\s+(.+?)(?:\s+[x×]\s*(\d+))?\s*$/i;
const TANGO_GIFT_RE = /^@?(.{2,40}?)\s+(.{1,24}?)\s+[x×]\s*(\d{1,4})\s*$/i;
const USER_MESSAGE_RE = /^@?([A-Za-zÀ-ÿ0-9_.-][A-Za-zÀ-ÿ0-9_. -]{1,38})\s*[:：]\s*(.+)$/;
const FOLLOW_RE =
  /^@?(.{2,40}?)\s+(?:entrou|chegou|começou\s+a\s+seguir|comecou\s+a\s+seguir|seguiu|followed|joined|is\s+watching)\b/i;
const MODERATION_RE =
  /(spam|golpe|scam|compre\s+seguidores|seguidor(?:es)?\s+barato|ganhe\s+dinheiro|pix\s+gratis|https?:\/\/|www\.|telegram|whatsapp|onlyfans|idiota|burro|ot[aá]ri[oa]|lixo|kill\s+yourself|kys)/i;
const OCR_UI_RE =
  /^(ao vivo|live|seguir|presente|presentes|top gifters|ranking|coment[aá]rios?|digite|enviar|send|share|compartilhar|host|tango)$/i;
const EMOJI_ONLY_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u;

function cleanText(rawText: string) {
  return rawText
    .replace(/^(OCR|Chat|Tango|Comentários?|Comentarios?|Presentes|Gifts|Alertas):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTangoUser(value: string | null | undefined) {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '')
    .trim();
}

export function normalizeTangoMessage(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[0|]/g, 'o')
    .replace(/1/g, 'i')
    .replace(/[?!.]+/g, '')
    .replace(/[^a-z0-9@\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isOwnUser(user: string | null, ownNames: string[]) {
  const normalized = normalizeTangoUser(user);
  return Boolean(normalized) && ownNames.map(normalizeTangoUser).includes(normalized);
}

function isNoise(text: string) {
  if (!text) return 'empty_line';
  if (OCR_UI_RE.test(text)) return 'ocr_ui_noise';
  if (EMOJI_ONLY_RE.test(text)) return 'emoji_only';
  const normalized = normalizeTangoMessage(text);
  if (normalized.length <= 1) return 'too_short';
  if (normalized.length < 4 && !/[?]/.test(text)) return 'short_fragment';
  if (/^[^\p{L}\p{N}]+$/u.test(text)) return 'symbol_fragment';
  return '';
}

export function parseTangoChatLine(
  rawText: string,
  options: TangoParseOptions = {},
): TangoParsedChatLine {
  const confidence = Math.max(0, Math.min(1, Number(options.confidence ?? 1)));
  const minConfidence = Math.max(0, Math.min(1, Number(options.minConfidence ?? DEFAULT_MIN_CONFIDENCE)));
  const ownNames = options.ownNames?.length ? options.ownNames : DEFAULT_OWN_NAMES;
  const text = cleanText(String(rawText || ''));

  if (confidence < minConfidence) {
    return { discarded: true, reason: 'low_confidence', rawText, confidence };
  }

  const noise = isNoise(text);
  if (noise) return { discarded: true, reason: noise, rawText, confidence };

  const userMessage = USER_MESSAGE_RE.exec(text);
  if (userMessage) {
    const user = userMessage[1].trim();
    const message = userMessage[2].trim();
    const nestedNoise = isNoise(message);
    if (nestedNoise) return { discarded: true, reason: nestedNoise, rawText, confidence };
    if (isOwnUser(user, ownNames)) {
      return { discarded: true, reason: 'own_message', rawText, confidence };
    }
    const kind = MODERATION_RE.test(message) ? 'moderation' : 'chat';
    return {
      discarded: false,
      kind,
      user,
      message,
      text: `${user}: ${message}`,
      rawText,
      confidence,
      metadata: kind === 'moderation' ? { risk: 'suspect_text' } : undefined,
    };
  }

  const gift = GIFT_RE.exec(text) || TANGO_GIFT_RE.exec(text);
  if (gift) {
    const user = gift[1].trim();
    if (isOwnUser(user, ownNames)) {
      return { discarded: true, reason: 'own_message', rawText, confidence };
    }
    const giftName = gift[2].trim();
    const quantity = gift[3] ? Math.max(1, Number(gift[3]) || 1) : 1;
    return {
      discarded: false,
      kind: 'gift',
      user,
      message: `enviou ${giftName}${quantity > 1 ? ` x${quantity}` : ''}`,
      text: `${user}: enviou ${giftName}${quantity > 1 ? ` x${quantity}` : ''}`,
      rawText,
      confidence,
      metadata: { giftName, quantity },
    };
  }

  const follow = FOLLOW_RE.exec(text);
  if (follow) {
    const user = follow[1].trim();
    if (isOwnUser(user, ownNames)) {
      return { discarded: true, reason: 'own_message', rawText, confidence };
    }
    return {
      discarded: false,
      kind: 'alert',
      user,
      message: text.replace(follow[1], '').trim() || 'entrou na live',
      text: `${user}: ${text.replace(follow[1], '').trim() || 'entrou na live'}`,
      rawText,
      confidence,
      metadata: { alertType: 'join_or_follow' },
    };
  }

  if (MODERATION_RE.test(text)) {
    return {
      discarded: false,
      kind: 'moderation',
      user: null,
      message: text,
      text,
      rawText,
      confidence,
      metadata: { risk: 'suspect_text' },
    };
  }

  return {
    discarded: false,
    kind: 'chat',
    user: null,
    message: text,
    text,
    rawText,
    confidence,
  };
}
