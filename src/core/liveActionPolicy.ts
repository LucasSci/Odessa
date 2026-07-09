import type { AutopilotAction, LiveEvent, PersonaDecision } from '../types';

export type ActionInterruptPolicy = 'interrupt_now' | 'wait_safe_point' | 'never_interrupt';
export type EventPriorityLane =
  | 'moderation'
  | 'gift_redeem'
  | 'alert'
  | 'direct_question'
  | 'casual_chat'
  | 'idle';

export interface LiveActionPolicyContext {
  events: LiveEvent[];
  primaryEvent: LiveEvent;
  decision: PersonaDecision;
  now: number;
  video?: {
    currentVideoId?: string | null;
    idleVideoId?: string | null;
    queueSize?: number;
    updatedAt?: string | null;
  };
}

export interface LiveActionPolicyResult {
  executableActions: AutopilotAction[];
  heldActions: AutopilotAction[];
  logs: string[];
}

export interface DirectorEventBatchResult {
  batch: LiveEvent[];
  remaining: LiveEvent[];
  discarded: Array<{ event: LiveEvent; reason: string }>;
}

const EVENT_MAX_AGE_MS = 2 * 60_000;
const IMPORTANT_EVENT_MAX_AGE_MS = 5 * 60_000;

function textKey(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function eventUser(event: LiveEvent) {
  return textKey(event.metadata?.user || event.metadata?.author || '');
}

function eventMessage(event: LiveEvent) {
  return textKey(event.metadata?.message || event.text);
}

export function classifyEventPriorityLane(event: LiveEvent): EventPriorityLane {
  if (event.kind === 'moderation') return 'moderation';
  if (event.kind === 'gift') return 'gift_redeem';
  if (event.kind === 'alert') return 'alert';
  if (event.kind === 'system') return 'idle';
  if (event.kind === 'chat') {
    const message = eventMessage(event);
    if (message.includes('?') || /\b(juju|odessa|vc|voce|voces|me diz|responde)\b/.test(message)) {
      return 'direct_question';
    }
    return 'casual_chat';
  }
  return 'idle';
}

export function eventPriorityScore(event: LiveEvent) {
  const lane = classifyEventPriorityLane(event);
  if (lane === 'moderation') return 100;
  if (lane === 'gift_redeem') return 90;
  if (lane === 'alert') return 70;
  if (lane === 'direct_question') return 60;
  if (lane === 'casual_chat') return 40;
  return 10;
}

export function selectDirectorEventBatch(
  pendingEvents: LiveEvent[],
  options: { now: number; maxEvents: number },
): DirectorEventBatchResult {
  const seen = new Set<string>();
  const kept: LiveEvent[] = [];
  const discarded: Array<{ event: LiveEvent; reason: string }> = [];

  for (const event of pendingEvents) {
    const age = options.now - Date.parse(event.createdAt);
    const priority = eventPriorityScore(event);
    const maxAge = priority >= 70 ? IMPORTANT_EVENT_MAX_AGE_MS : EVENT_MAX_AGE_MS;
    if (Number.isFinite(age) && age > maxAge) {
      discarded.push({ event, reason: `Evento antigo descartado (${Math.round(age / 1000)}s).` });
      continue;
    }

    const key = `${event.kind}:${eventUser(event)}:${eventMessage(event)}`;
    if (seen.has(key)) {
      discarded.push({ event, reason: 'Evento duplicado descartado na janela da rodada.' });
      continue;
    }
    seen.add(key);
    kept.push(event);
  }

  const batch = [...kept]
    .sort((a, b) => {
      const byPriority = eventPriorityScore(b) - eventPriorityScore(a);
      if (byPriority !== 0) return byPriority;
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    })
    .slice(0, options.maxEvents);
  const batchIds = new Set(batch.map((event) => event.id));
  const remaining = kept.filter((event) => !batchIds.has(event.id));

  return { batch, remaining, discarded };
}

function isOperationalAction(action: AutopilotAction) {
  return (
    action.type === 'play_video' ||
    action.type === 'switch_scene' ||
    action.type === 'moderate_message' ||
    action.capability === 'media.play_video' ||
    action.capability === 'obs.switch_scene' ||
    action.capability === 'moderation.message'
  );
}

function actionPriority(action: AutopilotAction, lane: EventPriorityLane, decision: PersonaDecision) {
  if (action.type === 'moderate_message' || action.capability === 'moderation.message') return 100;
  if (action.type === 'switch_scene' || action.capability === 'obs.switch_scene') return lane === 'gift_redeem' ? 92 : 80;
  if (action.type === 'play_video' || action.capability === 'media.play_video') return lane === 'gift_redeem' ? 88 : 75;
  if (action.type === 'ack_gift' || action.capability === 'gift.acknowledge') return 86;
  if (action.type === 'show_overlay' || action.capability === 'obs.show_overlay') return 70;
  if (action.type === 'chat_reply' || action.capability === 'chat.reply') return lane === 'direct_question' ? 60 : 40;
  if (action.type === 'speak') return decision.priority === 'urgent' ? 95 : eventPriorityFromLane(lane);
  return eventPriorityFromLane(lane);
}

function eventPriorityFromLane(lane: EventPriorityLane) {
  if (lane === 'moderation') return 100;
  if (lane === 'gift_redeem') return 90;
  if (lane === 'alert') return 70;
  if (lane === 'direct_question') return 60;
  if (lane === 'casual_chat') return 40;
  return 10;
}

function interruptionPolicy(priority: number, action: AutopilotAction): ActionInterruptPolicy {
  if (priority >= 90) return 'interrupt_now';
  if (isOperationalAction(action)) return 'wait_safe_point';
  return 'never_interrupt';
}

function videoBusy(context: LiveActionPolicyContext) {
  const current = context.video?.currentVideoId;
  if (!current) return false;
  return current !== context.video?.idleVideoId;
}

function annotateAction(
  action: AutopilotAction,
  priority: number,
  policy: ActionInterruptPolicy,
  result?: string,
): AutopilotAction {
  return {
    ...action,
    payload: {
      ...action.payload,
      actionPriority: priority,
      interruptPolicy: policy,
      cooldownMs: action.payload?.cooldownMs ?? (priority >= 80 ? 12_000 : 25_000),
    },
    result: result || action.result,
  };
}

export function applyLiveActionPolicy(
  actions: AutopilotAction[],
  context: LiveActionPolicyContext,
): LiveActionPolicyResult {
  const lane = classifyEventPriorityLane(context.primaryEvent);
  const operationalUrgent = actions.some((action) => {
    const priority = actionPriority(action, lane, context.decision);
    return isOperationalAction(action) && priority >= 70;
  });
  const executableActions: AutopilotAction[] = [];
  const heldActions: AutopilotAction[] = [];
  const logs: string[] = [];

  for (const action of actions) {
    const priority = actionPriority(action, lane, context.decision);
    const policy = interruptionPolicy(priority, action);

    if ((action.type === 'chat_reply' || action.capability === 'chat.reply') && operationalUrgent) {
      const reason = 'chat_reply bloqueado: acao urgente de video/OBS/moderacao em andamento na rodada.';
      heldActions.push(
        annotateAction(
          {
            ...action,
            status: 'blocked',
            payload: { ...action.payload, governorBlockedReason: reason },
          },
          priority,
          'never_interrupt',
          reason,
        ),
      );
      logs.push(reason);
      continue;
    }

    if (
      videoBusy(context) &&
      (action.type === 'play_video' || action.capability === 'media.play_video') &&
      policy !== 'interrupt_now'
    ) {
      const reason = 'Video aguardando ponto seguro: reacao importante em andamento ate voltar ao idle.';
      heldActions.push(annotateAction({ ...action, status: 'queued' }, priority, policy, reason));
      logs.push(reason);
      continue;
    }

    executableActions.push(annotateAction(action, priority, policy));
  }

  executableActions.sort((a, b) => {
    const priorityA = Number(a.payload?.actionPriority || 0);
    const priorityB = Number(b.payload?.actionPriority || 0);
    if (priorityA !== priorityB) return priorityB - priorityA;
    return Date.parse(a.createdAt || '') - Date.parse(b.createdAt || '');
  });

  return { executableActions, heldActions, logs };
}
