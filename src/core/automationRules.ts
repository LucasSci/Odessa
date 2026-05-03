import { capabilityForAction } from './toolRegistry';
import type { AutopilotAction, AutomationRule, LiveEvent, ToolCapability } from '../types';

const STORAGE_KEY = 'odessa:automation-rules:v1';

export interface AutomationRuleMatch {
  rule: AutomationRule;
  actions: AutopilotAction[];
}

export const DEFAULT_AUTOMATION_RULES: AutomationRule[] = [
  {
    id: 'rule-gift-rose',
    label: 'Presente simples: Rosa',
    enabled: true,
    trigger: { kind: 'gift', giftName: 'Rosa', redeemable: false },
    actions: [
      {
        type: 'ack_gift',
        label: 'Reconhecer presente',
        capability: 'gift.acknowledge',
        payload: { message: 'Presente {giftName} x{quantity} de {user} reconhecido.' },
        source: 'rule',
        ruleId: 'rule-gift-rose',
      },
    ],
  },
  {
    id: 'rule-redeem-scene',
    label: 'Resgate: trocar cena',
    enabled: true,
    trigger: { kind: 'gift', redeemable: true, mappedAction: 'obs.switch_scene' },
    actions: [
      {
        type: 'log_event',
        label: 'Registrar resgate de cena',
        capability: 'log.event',
        payload: { message: '{user} resgatou troca de cena para {requestedScene}.' },
        source: 'rule',
        ruleId: 'rule-redeem-scene',
      },
      {
        type: 'switch_scene',
        label: 'Trocar cena OBS',
        capability: 'obs.switch_scene',
        payload: { scene: '{requestedScene}' },
        source: 'rule',
        ruleId: 'rule-redeem-scene',
      },
    ],
  },
  {
    id: 'rule-redeem-music',
    label: 'Resgate: escolher musica',
    enabled: true,
    trigger: { kind: 'gift', redeemable: true, mappedAction: 'media.play_music' },
    actions: [
      {
        type: 'log_event',
        label: 'Registrar pedido de musica',
        capability: 'log.event',
        payload: { message: '{user} pediu musica: {requestedTrack}.' },
        source: 'rule',
        ruleId: 'rule-redeem-music',
      },
      {
        type: 'play_music',
        label: 'Adicionar musica a fila',
        capability: 'media.play_music',
        payload: { track: '{requestedTrack}' },
        source: 'rule',
        ruleId: 'rule-redeem-music',
      },
    ],
  },
  {
    id: 'rule-moderation',
    label: 'Moderacao: spam ou risco',
    enabled: true,
    trigger: { kind: 'moderation', contains: 'spam' },
    actions: [
      {
        type: 'moderate_message',
        label: 'Sinalizar moderacao',
        capability: 'moderation.message',
        payload: { message: '{text}' },
        requiresApproval: true,
        source: 'rule',
        ruleId: 'rule-moderation',
      },
    ],
  },
  {
    id: 'rule-quiet-topic',
    label: 'Sistema: chat quieto',
    enabled: true,
    trigger: { kind: 'system', mappedAction: 'topic.suggest' },
    actions: [
      {
        type: 'suggest_topic',
        label: 'Sugerir novo topico',
        capability: 'topic.suggest',
        payload: { topic: 'Perguntar ao chat o que eles querem ver agora.' },
        source: 'rule',
        ruleId: 'rule-quiet-topic',
      },
    ],
  },
  {
    id: 'rule-follow-overlay',
    label: 'Alerta: novo seguidor',
    enabled: true,
    trigger: { kind: 'alert', contains: 'seguidor' },
    actions: [
      {
        type: 'show_overlay',
        label: 'Mostrar overlay de boas-vindas',
        capability: 'obs.show_overlay',
        payload: { overlay: 'new-follower', user: '{user}' },
        source: 'rule',
        ruleId: 'rule-follow-overlay',
      },
    ],
  },
];

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function valueFromMetadata(event: LiveEvent, key: string) {
  const value = event.metadata?.[key];
  return value === undefined || value === null ? '' : String(value);
}

function fillTemplate(value: unknown, event: LiveEvent): unknown {
  if (typeof value !== 'string') return value;
  return value
    .replaceAll('{text}', event.text)
    .replaceAll('{user}', valueFromMetadata(event, 'user') || 'viewer')
    .replaceAll('{giftName}', valueFromMetadata(event, 'giftName') || 'presente')
    .replaceAll('{quantity}', valueFromMetadata(event, 'quantity') || '1')
    .replaceAll('{requestedScene}', valueFromMetadata(event, 'requestedScene') || 'Gameplay Focus')
    .replaceAll('{requestedTrack}', valueFromMetadata(event, 'requestedTrack') || 'pedido do chat');
}

function ruleMatches(rule: AutomationRule, event: LiveEvent) {
  if (!rule.enabled) return false;
  if (rule.trigger.kind !== event.kind) return false;
  if (
    rule.trigger.contains &&
    !event.text.toLowerCase().includes(rule.trigger.contains.toLowerCase())
  ) {
    return false;
  }
  if (rule.trigger.giftName) {
    const giftName = valueFromMetadata(event, 'giftName');
    if (!giftName.toLowerCase().includes(rule.trigger.giftName.toLowerCase())) return false;
  }
  if (typeof rule.trigger.redeemable === 'boolean') {
    if (Boolean(event.metadata?.redeemable) !== rule.trigger.redeemable) return false;
  }
  if (rule.trigger.mappedAction) {
    if (event.metadata?.mappedAction !== rule.trigger.mappedAction) return false;
  }
  return true;
}

function materializeAction(
  action: AutomationRule['actions'][number],
  event: LiveEvent,
  index: number,
): AutopilotAction {
  const payload = Object.fromEntries(
    Object.entries(action.payload || {}).map(([key, value]) => [key, fillTemplate(value, event)]),
  );
  const base = {
    id: action.id || `${action.ruleId || 'rule'}-${event.id}-${index}`,
    type: action.type,
    label: action.label,
    capability: action.capability || capabilityForAction(action),
    payload,
    simulated: action.simulated ?? action.type !== 'speak',
    requiresApproval: action.requiresApproval,
    status: 'queued' as const,
    source: 'rule' as const,
    ruleId: action.ruleId,
    createdAt: new Date().toISOString(),
  };
  return base;
}

export function loadAutomationRules(): AutomationRule[] {
  if (!canUseStorage()) return DEFAULT_AUTOMATION_RULES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AUTOMATION_RULES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_AUTOMATION_RULES;
    const byId = new Map(parsed.filter((rule) => rule?.id).map((rule) => [rule.id, rule]));
    return DEFAULT_AUTOMATION_RULES.map((rule) => ({ ...rule, ...byId.get(rule.id) }));
  } catch {
    return DEFAULT_AUTOMATION_RULES;
  }
}

export function saveAutomationRules(rules: AutomationRule[]): AutomationRule[] {
  if (!canUseStorage()) return rules;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // Ignore storage failures.
  }
  return rules;
}

export function updateAutomationRule(
  rules: AutomationRule[],
  ruleId: string,
  patch: Partial<Pick<AutomationRule, 'enabled'>>,
): AutomationRule[] {
  const next = rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule));
  return saveAutomationRules(next);
}

export function applyAutomationRules(
  event: LiveEvent,
  rules: AutomationRule[],
): AutomationRuleMatch[] {
  return rules
    .filter((rule) => ruleMatches(rule, event))
    .map((rule) => ({
      rule,
      actions: rule.actions.map((action, index) => materializeAction(action, event, index)),
    }));
}

export function matchedCapabilities(matches: AutomationRuleMatch[]): ToolCapability[] {
  return matches
    .flatMap((match) => match.actions.map((action) => action.capability))
    .filter(Boolean) as ToolCapability[];
}
