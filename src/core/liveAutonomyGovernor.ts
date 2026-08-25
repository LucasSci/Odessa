import { getAiConfig } from './aiConfig';
import { loadChatAutomationTarget } from '../lib/chatAutomation';
import type { AutopilotAction, LiveEvent, PersonaDecision } from '../types';

export interface LiveAutonomyGovernorOptions {
  now?: number;
  config?: ReturnType<typeof getAiConfig>;
  hasVisualTarget?: boolean;
  hasLocalAgent?: boolean;
}

export interface LiveAutonomyGovernorResult {
  decision: PersonaDecision;
  logs: string[];
}

const STORAGE_KEY = 'odessa:auto-chat:history:v1';
const MAX_HISTORY = 80;

type ReplyHistoryEntry = {
  at: number;
  status: 'sent' | 'dry_run' | 'blocked';
  reason?: string;
  message?: string;
};

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function loadHistory(): ReplyHistoryEntry[] {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(history: ReplyHistoryEntry[]) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {
    // Ignore local audit storage failures.
  }
}

export function resetLiveAutonomyGovernorHistory() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function recordLiveAutonomyReply(
  status: ReplyHistoryEntry['status'],
  reason?: string,
  at = Date.now(),
  message?: string,
) {
  saveHistory([...loadHistory(), { at, status, reason, message: normalizePublicText(message || '') || undefined }]);
}

function eventPriority(event: LiveEvent) {
  if (event.kind === 'moderation') return 100;
  if (event.kind === 'gift') return 90;
  if (event.kind === 'alert') return 70;
  if (event.kind === 'system') return 55;
  if (event.kind === 'chat') {
    const message = String(event.metadata?.message || event.text || '');
    return /[?？]|\b(odessa|juju|vc|você|voce|me ajuda|qual|como|quando|onde)\b/i.test(message)
      ? 60
      : 35;
  }
  return 20;
}

export function chooseGovernedEvent(events: LiveEvent[]) {
  return [...events].sort((a, b) => eventPriority(b) - eventPriority(a))[0] || events[0];
}

function confidenceForEvents(events: LiveEvent[]) {
  const values = events
    .map((event) => Number(event.metadata?.confidence))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return 1;
  return Math.min(...values);
}

export const PUBLIC_REPLY_BLOCKED_TERMS = [
  'compre seguidores',
  'link na bio',
  'pix',
  'paypal',
  'cartao',
  'cartão',
  'senha',
  'whatsapp',
  'telegram',
  'nude',
  'onlyfans',
  'violencia',
  'violência',
  'odio',
  'ódio',
  'racista',
  'assédio',
  'assedio',
  'menor de idade',
];

export const PUBLIC_REPLY_SPEND_PRESSURE_PATTERNS = [
  /\b(envia|manda|mande|mandem|compra|compre|comprar|gasta|gaste|doa|doe|doar|paga|pague)\b.{0,40}\b(presente|gift|rosa|diamante|moeda|coin|coins|pix|dinheiro)\b/i,
  /\b(presente|gift|rosa|diamante|moeda|coin|coins|pix|dinheiro)\b.{0,40}\b(agora|pra eu|para eu|me manda|me envia|preciso|meta)\b/i,
  /\b(segue|curte|compartilha)\b.{0,40}\b(agora|obrigatorio|obrigatório|tem que)\b/i,
];

function normalizePublicText(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/[@#]\w+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function publicReplyText(action: AutopilotAction) {
  return String(action.payload?.message || action.payload?.text || '').trim();
}

function containsBlockedPublicTopic(text: string) {
  const normalized = normalizePublicText(text);
  return PUBLIC_REPLY_BLOCKED_TERMS.some((term) => normalized.includes(normalizePublicText(term)));
}

function pressuresSpendOrPlatformAction(text: string) {
  return PUBLIC_REPLY_SPEND_PRESSURE_PATTERNS.some((pattern) => pattern.test(text));
}

function isProblematicEvent(event: LiveEvent) {
  if (event.kind === 'moderation') return true;
  const text = String(event.metadata?.message || event.text || '');
  return containsBlockedPublicTopic(text) || pressuresSpendOrPlatformAction(text);
}

function isGiftAlignedReply(message: string, events: LiveEvent[]) {
  const normalized = normalizePublicText(message);
  if (/\b(obrigad|valeu|presente|gift|rosa|diamante|fortaleceu)\b/i.test(normalized)) return true;
  return events
    .filter((event) => event.kind === 'gift')
    .some((event) => {
      const user = normalizePublicText(String(event.metadata?.user || event.metadata?.sender || ''));
      const giftName = normalizePublicText(String(event.metadata?.giftName || event.metadata?.giftKey || ''));
      return Boolean((user && normalized.includes(user)) || (giftName && normalized.includes(giftName)));
    });
}

function semanticTokens(text: string) {
  const stop = new Set([
    'a',
    'o',
    'e',
    'de',
    'do',
    'da',
    'um',
    'uma',
    'pra',
    'para',
    'por',
    'com',
    'que',
    'eu',
    'voce',
    'vc',
    'sua',
    'seu',
    'aqui',
    'chat',
  ]);
  return normalizePublicText(text)
    .split(' ')
    .filter((token) => token.length > 2 && !stop.has(token));
}

function semanticSimilarity(a: string, b: string) {
  const left = new Set(semanticTokens(a));
  const right = new Set(semanticTokens(b));
  if (!left.size || !right.size) return normalizePublicText(a) === normalizePublicText(b) ? 1 : 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function hasRecentSimilarReply(message: string, history: ReplyHistoryEntry[], now: number) {
  const recentReplies = history.filter(
    (entry) =>
      (entry.status === 'sent' || entry.status === 'dry_run') &&
      entry.message &&
      now - entry.at <= 5 * 60_000,
  );
  return recentReplies.some((entry) => semanticSimilarity(message, entry.message || '') >= 0.72);
}

function hasVisualTargetConfigured() {
  const target = loadChatAutomationTarget();
  return Boolean(
    target.mode === 'visual' &&
      target.inputPoint &&
      typeof target.inputPoint.x === 'number' &&
      typeof target.inputPoint.y === 'number' &&
      target.viewport &&
      typeof target.viewport.width === 'number' &&
      typeof target.viewport.height === 'number',
  );
}

function blockAction(action: AutopilotAction, reason: string, extraPayload: Record<string, unknown> = {}): AutopilotAction {
  return {
    ...action,
    payload: { ...action.payload, ...extraPayload, governorBlockedReason: reason },
    simulated: false,
  };
}

function allowAction(action: AutopilotAction, config: ReturnType<typeof getAiConfig>): AutopilotAction {
  return {
    ...action,
    payload: {
      ...action.payload,
      targetMode: 'visual',
      dryRun: config.autoChatReplyMode !== 'real',
      submit: true,
      governorAllowed: true,
    },
    simulated: config.autoChatReplyMode !== 'real',
  };
}

export function governPersonaDecision(
  events: LiveEvent[],
  decision: PersonaDecision,
  options: LiveAutonomyGovernorOptions = {},
): LiveAutonomyGovernorResult {
  const config = options.config || getAiConfig();
  const now = options.now ?? Date.now();
  const logs: string[] = [];
  const primary = chooseGovernedEvent(events);
  const minConfidence = confidenceForEvents(events);
  const history = loadHistory();
  const recent = history.filter((entry) => now - entry.at <= 60_000);

  // ⚡ Bolt: Using a backward for-loop instead of [...history].reverse().find(...)
  // to avoid O(N) memory allocation and iterate efficiently from the end.
  let lastPublic: typeof history[number] | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].status === 'sent' || history[i].status === 'dry_run') {
      lastPublic = history[i];
      break;
    }
  }

  const cooldownRemaining = lastPublic
    ? Math.max(0, config.chatReplyCooldownMs - (now - lastPublic.at))
    : 0;
  const visualReady = options.hasVisualTarget ?? hasVisualTargetConfigured();
  const localAgentReady = options.hasLocalAgent ?? false;
  const hasModerationEvent = events.some((event) => event.kind === 'moderation');
  const hasProblematicEvent = events.some(isProblematicEvent);
  const hasGiftEvent = events.some((event) => event.kind === 'gift');
  let publicReplySeen = false;

  const actions = decision.actions.map((action) => {
    if (action.type !== 'chat_reply' && action.capability !== 'chat.reply') return action;
    const replyText = publicReplyText(action);
    if (publicReplySeen) {
      logs.push('Resposta extra bloqueada: max_one_public_reply');
      return blockAction(action, 'max_one_public_reply');
    }
    publicReplySeen = true;

    if (!config.autoChatReplyEnabled) {
      logs.push('Resposta no chat bloqueada: auto_chat_disabled');
      return blockAction(action, 'auto_chat_disabled');
    }
    if (!replyText) {
      logs.push('Resposta no chat bloqueada: empty_public_reply');
      return blockAction(action, 'empty_public_reply');
    }
    if (hasModerationEvent || primary?.kind === 'moderation') {
      logs.push('Resposta no chat bloqueada: moderation_risk');
      return blockAction(action, 'moderation_risk');
    }
    if (hasProblematicEvent) {
      logs.push('Resposta no chat bloqueada: problematic_event');
      return blockAction(action, 'problematic_event');
    }
    if (minConfidence < config.chatReplyMinConfidence) {
      logs.push('Resposta no chat bloqueada: low_ocr_confidence');
      return blockAction(action, 'low_ocr_confidence');
    }
    if (hasGiftEvent && primary?.kind === 'gift' && !isGiftAlignedReply(replyText, events)) {
      logs.push('Resposta no chat bloqueada: gift_priority');
      return blockAction(action, 'gift_priority');
    }
    if (containsBlockedPublicTopic(replyText)) {
      logs.push('Resposta no chat bloqueada: blocked_public_topic');
      return blockAction(action, 'blocked_public_topic');
    }
    if (pressuresSpendOrPlatformAction(replyText)) {
      logs.push('Resposta no chat bloqueada: spend_pressure');
      return blockAction(action, 'spend_pressure');
    }
    if (hasRecentSimilarReply(replyText, history, now)) {
      logs.push('Resposta no chat bloqueada: semantic_duplicate');
      return blockAction(action, 'semantic_duplicate');
    }
    if (!visualReady) {
      logs.push('Resposta no chat bloqueada: visual_target_missing');
      return blockAction(action, 'visual_target_missing');
    }
    if (config.autoChatReplyMode === 'real' && !localAgentReady) {
      logs.push('Resposta no chat bloqueada: local_agent_missing');
      return blockAction(action, 'local_agent_missing');
    }
    if (cooldownRemaining > 0) {
      logs.push('Resposta no chat bloqueada: cooldown');
      return blockAction(action, 'cooldown', { governorCooldownMs: cooldownRemaining });
    }
    if (recent.filter((entry) => entry.status === 'sent' || entry.status === 'dry_run').length >= config.chatReplyMaxPerMinute) {
      logs.push('Resposta no chat bloqueada: rate_limited');
      return blockAction(action, 'rate_limited');
    }

    logs.push(config.autoChatReplyMode === 'real' ? 'Resposta no chat liberada para envio real' : 'Resposta no chat liberada em dry-run');
    return allowAction(action, config);
  });

  return {
    decision: { ...decision, actions },
    logs,
  };
}
