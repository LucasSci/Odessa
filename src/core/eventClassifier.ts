import type { LiveEvent, ToolCapability } from '../types';

// ─── Deterministic Patterns ────────────────────────────────────────────────────
// Order matters: checks are applied top-to-bottom and the first match wins.

/**
 * CRITICAL: Messages starting with @user: are ALWAYS chat (never gift).
 * This prevents "@AnaStarlight: Boa! Mandou muito bem" → gift false-positive.
 */
const AT_MENTION_RE = /^@([A-Za-z0-9_.-]{2,32})\s*:\s*.+/;

/**
 * Gift patterns — only match if text follows sender+verb+giftName structure.
 */
const GIFT_SENT_RE =
  /^(.{2,32}?)\s+(?:enviou|mandou|presenteou\s+com|sent)\s+(.+?)(?:\s+x\s*(\d+))?\s*$/i;

/**
 * Redeem pattern — handles both:
 *   "User resgatou Gift Name"
 *   "User resgatou: Gift Name" (colon variant)
 */
const REDEEM_RE = /^(.{2,32}?)\s+resgatou\s*:?\s*(.+)$/i;

const MODERATION_RE =
  /\b(spam|compre\s+seguidores|ganhe\s+dinheiro|www\.[a-z0-9-]+\.[a-z]{2,}|https?:\/\/|ban|mute|link\s+externo|ofensa|seguidor\s+barato)\b/i;

const ALERT_RE =
  /(novo\s+seguidor|began\s+following|comecou\s+a\s+seguir|começou\s+a\s+seguir|entrou\s+na\s+live|follower)/i;

const SCENE_RE =
  /(trocar\s+cena|troca\s+de\s+cena|gameplay\s+focus|cena\s+just\s+chatting|tela\s+de\s+reacts)/i;

const MUSIC_RE = /(escolher?\s+m[uú]sica|tocar\s*:|track\s*:)/i;

const QUIET_RE =
  /(chat\s+quieto|assunto\s+acabou|sem\s+assunto|puxar\s+assunto|novo\s+t[oó]pico|live\s+(est[aá]|está)\s+quieta|momento\s+sem\s+mensagens)/i;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function cleanText(text: string) {
  return text.replace(/^(Chat|Presentes|Alertas|Gifts|Alerts|OCR):\s*/i, '').trim();
}

function extractUser(text: string): string | null {
  // 1. @user: message
  const atMatch = text.match(/^@([A-Za-z0-9_.-]{2,32})\s*:/);
  if (atMatch) return atMatch[1];

  // 2. user: message
  const colonMatch = text.match(/^([A-Za-z0-9_.-]{2,32})\s*:/);
  if (colonMatch) return colonMatch[1];

  // 3. Gift sender from GIFT_SENT_RE
  const giftMatch = GIFT_SENT_RE.exec(text);
  if (giftMatch?.[1]) return giftMatch[1].trim();

  // 4. Redeem sender
  const redeemMatch = REDEEM_RE.exec(text);
  if (redeemMatch?.[1]) return redeemMatch[1].trim();

  // 5. Follower pattern
  const followerMatch = text.match(/(?:seguidor|follower)[:\s]+([A-Za-z0-9_.-]{2,32})/i);
  return followerMatch?.[1] ?? null;
}

function extractScene(text: string): string | undefined {
  const colonMatch = text.match(/(?:trocar\s+cena|troca\s+de\s+cena|cena)\s*:\s*([A-Za-z0-9 _-]{3,50})/i);
  if (colonMatch) return colonMatch[1].trim();
  if (/gameplay\s+focus/i.test(text)) return 'Gameplay Focus';
  if (/cena\s+just\s+chatting/i.test(text)) return 'Cena Just Chatting';
  if (/tela\s+de\s+reacts/i.test(text)) return 'Tela de reacts';
  return undefined;
}

function extractTrack(text: string): string | undefined {
  const match = text.match(/(?:escolher?\s+m[uú]sica|tocar|track|song)\s*:\s*([^,\n]+)/i);
  return match?.[1]?.trim();
}

function isGiftSender(sender: string): boolean {
  // Reject senders that look like chat prefixes (too many spaces, starts with @)
  if (sender.startsWith('@')) return false;
  if (sender.includes(':')) return false;
  // Must be a reasonable username/name (letters, numbers, underscores, dashes, accented chars)
  return /^[\w\-\s\u00C0-\u024F]{2,40}$/i.test(sender);
}

// ─── Deterministic Classifier ─────────────────────────────────────────────────

/**
 * Deterministic classification with strict priority ordering.
 * No AI fallback — pure rules.
 */
export function classifyEventDeterministic(event: LiveEvent): LiveEvent {
  const text = cleanText(event.text);

  // ① MODERATION — highest priority (spam/links override everything)
  if (MODERATION_RE.test(text)) {
    return {
      ...event,
      text,
      kind: 'moderation',
      metadata: {
        ...event.metadata,
        classifiedAt: new Date().toISOString(),
        classifiedBy: 'deterministic',
      },
    };
  }

  // ② CHAT — @user: message pattern is ALWAYS chat (never gift)
  if (AT_MENTION_RE.test(text)) {
    const user = extractUser(text);
    const messageMatch = text.match(/^@[A-Za-z0-9_.-]+\s*:\s*(.+)/);
    return {
      ...event,
      text,
      kind: 'chat',
      metadata: {
        ...event.metadata,
        ...(user ? { user } : {}),
        ...(messageMatch ? { message: messageMatch[1].trim() } : {}),
        classifiedAt: new Date().toISOString(),
        classifiedBy: 'deterministic',
      },
    };
  }

  // ③ REDEEM — "User resgatou [:]? ..."
  const redeemMatch = REDEEM_RE.exec(text);
  if (redeemMatch && isGiftSender(redeemMatch[1])) {
    const sender = redeemMatch[1].trim();
    const giftName = redeemMatch[2].trim();
    const mappedAction: ToolCapability | undefined = SCENE_RE.test(text)
      ? 'obs.switch_scene'
      : MUSIC_RE.test(text)
      ? 'media.play_music'
      : undefined;
    const requestedScene = mappedAction === 'obs.switch_scene' ? extractScene(text) : undefined;
    const requestedTrack = mappedAction === 'media.play_music' ? extractTrack(text) : undefined;

    return {
      ...event,
      text,
      kind: 'gift',
      metadata: {
        ...event.metadata,
        user: sender,
        giftName,
        quantity: 1,
        redeemable: true,
        ...(mappedAction ? { mappedAction } : {}),
        ...(requestedScene ? { requestedScene } : {}),
        ...(requestedTrack ? { requestedTrack } : {}),
        classifiedAt: new Date().toISOString(),
        classifiedBy: 'deterministic',
      },
    };
  }

  // ④ GIFT — "User enviou/mandou GiftName [x5]"
  const giftMatch = GIFT_SENT_RE.exec(text);
  if (giftMatch && isGiftSender(giftMatch[1])) {
    const sender = giftMatch[1].trim();
    const giftName = giftMatch[2].trim();
    const quantity = giftMatch[3] ? Number(giftMatch[3]) : 1;

    return {
      ...event,
      text,
      kind: 'gift',
      metadata: {
        ...event.metadata,
        user: sender,
        giftName,
        quantity,
        redeemable: false,
        classifiedAt: new Date().toISOString(),
        classifiedBy: 'deterministic',
      },
    };
  }

  // ⑤ ALERT — follower notifications
  if (ALERT_RE.test(text)) {
    const user = extractUser(text);
    return {
      ...event,
      text,
      kind: 'alert',
      metadata: {
        ...event.metadata,
        ...(user ? { user } : {}),
        alertType: 'new_follower',
        classifiedAt: new Date().toISOString(),
        classifiedBy: 'deterministic',
      },
    };
  }

  // ⑥ SYSTEM — quiet live events
  if (QUIET_RE.test(text)) {
    return {
      ...event,
      text,
      kind: 'system',
      metadata: {
        ...event.metadata,
        mappedAction: 'topic.suggest' as ToolCapability,
        classifiedAt: new Date().toISOString(),
        classifiedBy: 'deterministic',
      },
    };
  }

  // ⑦ Standalone music request — "tocar: track", "escolher musica: track"
  if (MUSIC_RE.test(text)) {
    const track = extractTrack(text);
    return {
      ...event,
      text,
      kind: event.kind ?? 'chat',
      metadata: {
        ...event.metadata,
        mappedAction: 'media.play_music' as ToolCapability,
        ...(track ? { requestedTrack: track } : {}),
        classifiedAt: new Date().toISOString(),
        classifiedBy: 'deterministic',
      },
    };
  }

  // ⑧ DEFAULT — treat as chat
  const user = extractUser(text);
  return {
    ...event,
    text,
    kind: event.kind ?? 'chat',
    metadata: {
      ...event.metadata,
      ...(user ? { user } : {}),
      classifiedAt: new Date().toISOString(),
      classifiedBy: 'deterministic',
    },
  };
}

/**
 * Legacy export — keeps backward compatibility with existing callers.
 */
export function classifyEvent(event: LiveEvent): LiveEvent {
  return classifyEventDeterministic(event);
}
