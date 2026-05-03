import type { LiveEvent, LiveEventKind, ToolCapability } from '../types';

const GIFT_RE = /\b(enviou|mandou|presente|gift|rosa|resgatou|resgate)\b/i;
const MODERATION_RE = /\b(spam|suspeita|modera|ban|mute|link externo|ofensa)\b/i;
const ALERT_RE = /\b(novo seguidor|seguidor|follow|follower|entrou na live)\b/i;
const SCENE_RE = /\b(trocar cena|troca de cena|scene|obs|gameplay focus|cena)\b/i;
const MUSIC_RE = /\b(musica|música|track|song|tocar|player)\b/i;
const QUIET_RE =
  /\b(chat quieto|assunto acabou|sem assunto|puxar assunto|novo topico|novo tópico)\b/i;

function cleanText(text: string) {
  return text.replace(/^(Chat|Presentes|Alertas|Gifts|Alerts|OCR):\s*/i, '').trim();
}

function extractUser(text: string) {
  const cleaned = cleanText(text);
  const atMatch = cleaned.match(/^@([A-Za-z0-9_.-]{2,25})\b/);
  if (atMatch) return atMatch[1];

  const colonMatch = cleaned.match(/^([A-Za-z0-9_.-]{2,25})\s*:/);
  if (colonMatch) return colonMatch[1];

  const actionMatch = cleaned.match(
    /^([A-Za-z0-9_.-]{2,25})\s+(enviou|mandou|resgatou|seguiu|entrou)/i,
  );
  if (actionMatch) return actionMatch[1];

  const followerMatch = cleaned.match(/(?:seguidor|follower):\s*([A-Za-z0-9_.-]{2,25})/i);
  return followerMatch?.[1] || null;
}

function extractGiftName(text: string) {
  const redeemMatch = text.match(/resgatou\s*:?\s*([^,.]+)/i);
  if (redeemMatch) return redeemMatch[1].trim();

  const giftMatch = text.match(/(?:enviou|mandou)\s+([^,.]+?)(?:\s+x\s*\d+|\s+e\s+|\.|,|$)/i);
  if (giftMatch) return giftMatch[1].trim();

  if (/rosa/i.test(text)) return 'Rosa';
  return null;
}

function extractQuantity(text: string) {
  const match = text.match(/\bx\s*(\d+)\b/i);
  return match ? Number(match[1]) : undefined;
}

function extractScene(text: string) {
  const match = text.match(/(?:cena|scene)\s*:?\s*([A-Za-z0-9 _-]{3,40})/i);
  if (match) return match[1].trim();
  if (/gameplay focus/i.test(text)) return 'Gameplay Focus';
  if (/trocar cena|troca de cena/i.test(text)) return 'Gameplay Focus';
  return undefined;
}

function extractTrack(text: string) {
  const match = text.match(/(?:musica|música|track|song|tocar)\s*:?\s*([^,.]+)/i);
  return match?.[1]?.trim();
}

function mappedActionFromText(text: string): ToolCapability | undefined {
  if (SCENE_RE.test(text)) return 'obs.switch_scene';
  if (MUSIC_RE.test(text)) return 'media.play_music';
  if (QUIET_RE.test(text)) return 'topic.suggest';
  return undefined;
}

function kindFromText(text: string, currentKind: LiveEventKind): LiveEventKind {
  if (MODERATION_RE.test(text)) return 'moderation';
  if (GIFT_RE.test(text)) return 'gift';
  if (ALERT_RE.test(text)) return 'alert';
  if (SCENE_RE.test(text)) return 'scene';
  if (QUIET_RE.test(text)) return 'system';
  return currentKind;
}

export function classifyEvent(event: LiveEvent): LiveEvent {
  const text = cleanText(event.text);
  const kind = kindFromText(text, event.kind);
  const user = extractUser(text);
  const mappedAction = mappedActionFromText(text);
  const redeemable =
    /resgatou|resgate|escolher|trocar|pedido/i.test(text) ||
    Boolean(mappedAction && kind === 'gift');
  const giftName = kind === 'gift' ? extractGiftName(text) : undefined;
  const quantity = kind === 'gift' ? extractQuantity(text) : undefined;
  const requestedScene = mappedAction === 'obs.switch_scene' ? extractScene(text) : undefined;
  const requestedTrack = mappedAction === 'media.play_music' ? extractTrack(text) : undefined;

  return {
    ...event,
    text,
    kind,
    metadata: {
      ...event.metadata,
      ...(user ? { user } : {}),
      ...(giftName ? { giftName } : {}),
      ...(quantity ? { quantity } : {}),
      ...(typeof redeemable === 'boolean' && kind === 'gift' ? { redeemable } : {}),
      ...(mappedAction ? { mappedAction } : {}),
      ...(requestedScene ? { requestedScene } : {}),
      ...(requestedTrack ? { requestedTrack } : {}),
      classifiedAt: new Date().toISOString(),
    },
  };
}
