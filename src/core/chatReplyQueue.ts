import type { AiAutonomyLevel } from './aiConfig';
import type {
  AutopilotAction,
  AutopilotCycle,
  ChatReplyQueueItem,
  ChatReplyQueueStatus,
  PersonaDecision,
} from '../types';

export interface ChatReplyQueuePreparation {
  queueItems: ChatReplyQueueItem[];
  executableActions: AutopilotAction[];
}

function nowIso() {
  return new Date().toISOString();
}

function chatReplyText(action: AutopilotAction) {
  return String(action.payload?.message || action.payload?.text || '').trim();
}

function cooldownFromAction(action: AutopilotAction) {
  const value = Number(action.payload?.governorCooldownMs || action.payload?.cooldownMs || 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function queueStatusForAction(
  action: AutopilotAction,
  autonomyLevel: AiAutonomyLevel,
): ChatReplyQueueStatus {
  if (typeof action.payload?.governorBlockedReason === 'string' || action.status === 'blocked') {
    return 'blocked';
  }
  if (action.status === 'error') return 'error';
  if (autonomyLevel === 'manual' || autonomyLevel === 'assistido' || action.requiresApproval) {
    return 'approval_required';
  }
  return 'queued';
}

function queueItemFromAction(
  action: AutopilotAction,
  cycle: Pick<AutopilotCycle, 'id' | 'event'>,
  decision: PersonaDecision,
  autonomyLevel: AiAutonomyLevel,
): ChatReplyQueueItem {
  const createdAt = nowIso();
  const text = chatReplyText(action);
  const blockedReason =
    typeof action.payload?.governorBlockedReason === 'string'
      ? action.payload.governorBlockedReason
      : undefined;
  return {
    id: `chat-reply-${cycle.id}-${action.id}`,
    actionId: action.id,
    cycleId: cycle.id,
    sourceEvent: cycle.event,
    action,
    status: queueStatusForAction(action, autonomyLevel),
    text,
    originalText: text,
    reason: blockedReason || decision.reason || 'Resposta sugerida pela Diretora.',
    confidence: Math.max(0, Math.min(1, Number(decision.confidence || 0))),
    cooldownMs: cooldownFromAction(action),
    result: action.result,
    governorBlockedReason: blockedReason,
    createdAt,
    updatedAt: createdAt,
  };
}

export function prepareChatReplyQueue(
  actions: AutopilotAction[],
  cycle: Pick<AutopilotCycle, 'id' | 'event'>,
  decision: PersonaDecision,
  autonomyLevel: AiAutonomyLevel,
): ChatReplyQueuePreparation {
  const queueItems: ChatReplyQueueItem[] = [];
  const executableActions: AutopilotAction[] = [];

  for (const action of actions) {
    if (action.type !== 'chat_reply' && action.capability !== 'chat.reply') {
      executableActions.push(action);
      continue;
    }

    const item = queueItemFromAction(action, cycle, decision, autonomyLevel);
    queueItems.push(item);

    if (item.status === 'queued') {
      executableActions.push(action);
    }
  }

  return { queueItems, executableActions };
}

export function mergeChatReplyQueue(
  current: ChatReplyQueueItem[],
  incoming: ChatReplyQueueItem[],
): ChatReplyQueueItem[] {
  const next = current.filter((item) => !incoming.some((newItem) => newItem.id === item.id));
  return [...next, ...incoming].slice(-80);
}

export function updateChatReplyQueueFromAction(
  current: ChatReplyQueueItem[],
  action: AutopilotAction,
): ChatReplyQueueItem[] {
  if (action.type !== 'chat_reply' && action.capability !== 'chat.reply') return current;
  const updatedAt = nowIso();
  return current.map((item) => {
    if (item.actionId !== action.id) return item;
    const status: ChatReplyQueueStatus =
      action.status === 'running'
        ? 'sending'
        : action.status === 'done' || action.status === 'simulated'
          ? 'sent'
          : action.status === 'blocked' || action.status === 'approval_required'
            ? action.status
            : action.status === 'error'
              ? 'error'
              : item.status;
    return {
      ...item,
      action,
      status,
      text: chatReplyText(action) || item.text,
      result: action.result || item.result,
      governorBlockedReason:
        typeof action.payload?.governorBlockedReason === 'string'
          ? action.payload.governorBlockedReason
          : item.governorBlockedReason,
      sentAt: status === 'sent' ? updatedAt : item.sentAt,
      updatedAt,
    };
  });
}
