import { getAiConfig } from './aiConfig';
import { loadChatAutomationTarget } from '../lib/chatAutomation';
import type { AutopilotAction, LiveEvent, PersonaDecision } from '../types';

export interface LiveAutonomyGovernorOptions {
  now?: number;
  config?: ReturnType<typeof getAiConfig>;
  hasVisualTarget?: boolean;
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

export function recordLiveAutonomyReply(status: ReplyHistoryEntry['status'], reason?: string, at = Date.now()) {
  saveHistory([...loadHistory(), { at, status, reason }]);
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

function blockAction(action: AutopilotAction, reason: string): AutopilotAction {
  return {
    ...action,
    payload: { ...action.payload, governorBlockedReason: reason },
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
  const lastPublic = [...history]
    .reverse()
    .find((entry) => entry.status === 'sent' || entry.status === 'dry_run');
  const cooldownRemaining = lastPublic
    ? Math.max(0, config.chatReplyCooldownMs - (now - lastPublic.at))
    : 0;
  const visualReady = options.hasVisualTarget ?? hasVisualTargetConfigured();
  let publicReplySeen = false;

  const actions = decision.actions.map((action) => {
    if (action.type !== 'chat_reply' && action.capability !== 'chat.reply') return action;
    if (publicReplySeen) {
      logs.push('Resposta extra bloqueada: max_one_public_reply');
      return blockAction(action, 'max_one_public_reply');
    }
    publicReplySeen = true;

    if (!config.autoChatReplyEnabled) {
      logs.push('Resposta no chat bloqueada: auto_chat_disabled');
      return blockAction(action, 'auto_chat_disabled');
    }
    if (primary?.kind === 'moderation') {
      logs.push('Resposta no chat bloqueada: moderation_risk');
      return blockAction(action, 'moderation_risk');
    }
    if (minConfidence < config.chatReplyMinConfidence) {
      logs.push('Resposta no chat bloqueada: low_ocr_confidence');
      return blockAction(action, 'low_ocr_confidence');
    }
    if (!visualReady) {
      logs.push('Resposta no chat bloqueada: visual_target_missing');
      return blockAction(action, 'visual_target_missing');
    }
    if (cooldownRemaining > 0) {
      logs.push('Resposta no chat bloqueada: cooldown');
      return blockAction(action, 'cooldown');
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
