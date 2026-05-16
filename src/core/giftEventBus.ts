/**
 * giftEventBus.ts
 * ---------------
 * A reactive, in-memory event bus that connects:
 *   TestInjector / OCR events
 *   → EventClassifier (deterministic, corrected)
 *   → GiftLedger
 *   → GiftRuleEngine
 *   → VideoPlaybackService (via registered callback)
 *
 * This is the single source of truth for gift-driven video reactions.
 */

import { classifyEventDeterministic } from './eventClassifier';
import type { LiveEvent } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GiftLedgerEntry {
  giftName: string;
  sender: string;
  quantity: number;
  timestamp: string;
}

export interface GiftLedgerState {
  totalGiftEvents: number;
  totalGiftQuantity: number;
  totalByGiftName: Record<string, number>;
  totalBySender: Record<string, { totalGiftEvents: number; totalGiftQuantity: number; gifts: Record<string, number> }>;
  recentGifts: GiftLedgerEntry[];
}

export interface GiftRule {
  id: string;
  enabled: boolean;
  name: string;
  when: {
    giftName?: string | string[];  // '*' = any, or specific name(s)
    minQuantity?: number;
    senderSessionTotalMin?: number;
  };
  action: {
    type: 'flow.play_video';
    videoId: string;  // matches video IDs in persona_config.json
  };
  cooldownMs: number;
}

export interface PipelineStep {
  step: string;
  status: 'ok' | 'blocked' | 'error';
  detail: string;
  timestamp: string;
}

export interface GiftPipelineResult {
  event: LiveEvent;
  classified: boolean;
  ledgerUpdated: boolean;
  ruleMatched: GiftRule | null;
  videoTriggered: string | null;
  blocked: boolean;
  blockedReason: string | null;
  steps: PipelineStep[];
}

export type VideoPlayCallback = (videoId: string, reason: string) => void;
export type PipelineLogCallback = (result: GiftPipelineResult) => void;

// ─── Internal State ────────────────────────────────────────────────────────────

const ledger: GiftLedgerState = {
  totalGiftEvents: 0,
  totalGiftQuantity: 0,
  totalByGiftName: {},
  totalBySender: {},
  recentGifts: [],
};

const lastTriggeredByRule: Record<string, number> = {};

let videoPlayCallback: VideoPlayCallback | null = null;
let pipelineLogCallback: PipelineLogCallback | null = null;

// Default rules — match what the ReactiveFlowBoard creates with triggers
let activeRules: GiftRule[] = [
  {
    id: 'any_gift_thank_you',
    enabled: true,
    name: 'Qualquer presente',
    when: { giftName: '*', minQuantity: 1 },
    action: { type: 'flow.play_video', videoId: 'thank_you_for_the_gift' },
    cooldownMs: 8000,
  },
];

// ─── Registration ──────────────────────────────────────────────────────────────

/** Called by PersonaStudio / VideoPlaybackService to hook the video player */
export function registerVideoPlayCallback(cb: VideoPlayCallback) {
  videoPlayCallback = cb;
}

/** Called by UI diagnostic panels to observe the pipeline */
export function registerPipelineLogCallback(cb: PipelineLogCallback) {
  pipelineLogCallback = cb;
}

/** Load rules compiled from the visual flow canvas (persona_config triggers) */
export function loadRulesFromFlowTriggers(
  triggers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    eventType: string;
    conditions?: { giftKey?: string; keyword?: string };
    actions?: Array<{ type: string; videoId?: string; payload?: { videoId?: string } }>;
    cooldown_ms?: number;
  }>,
) {
  const compiled: GiftRule[] = [];

  for (const trigger of triggers) {
    if (!trigger.enabled) continue;
    if (trigger.eventType !== 'gift') continue;

    const playAction = trigger.actions?.find((a) => a.type === 'play_video');
    const videoId = playAction?.videoId || playAction?.payload?.videoId;
    if (!videoId) continue;

    // Convert giftKey (e.g. 'gift.rosa') → giftName (e.g. 'Rosa')
    const giftKey = trigger.conditions?.giftKey;
    const giftName = giftKey
      ? giftKey.replace(/^gift\./, '').replace(/(^|\.)(.)/g, (_, p1, p2) => p1 + p2.toUpperCase())
      : '*';

    compiled.push({
      id: trigger.id,
      enabled: true,
      name: trigger.name || `Rule ${trigger.id}`,
      when: { giftName, minQuantity: 1 },
      action: { type: 'flow.play_video', videoId },
      cooldownMs: trigger.cooldown_ms ?? 8000,
    });
  }

  // Always keep the fallback "any gift" rule at the end
  const hasFallback = compiled.some((r) => r.when.giftName === '*');
  if (!hasFallback) {
    compiled.push({
      id: 'any_gift_fallback',
      enabled: true,
      name: 'Qualquer presente (fallback)',
      when: { giftName: '*', minQuantity: 1 },
      action: { type: 'flow.play_video', videoId: 'thank_you_for_the_gift' },
      cooldownMs: 8000,
    });
  }

  activeRules = compiled;
  console.log(`[GiftEventBus] Loaded ${compiled.length} rules from flow.`);
}

// ─── Ledger ────────────────────────────────────────────────────────────────────

function updateLedger(giftName: string, sender: string, quantity: number): GiftLedgerState {
  ledger.totalGiftEvents += 1;
  ledger.totalGiftQuantity += quantity;

  ledger.totalByGiftName[giftName] = (ledger.totalByGiftName[giftName] ?? 0) + quantity;

  if (!ledger.totalBySender[sender]) {
    ledger.totalBySender[sender] = { totalGiftEvents: 0, totalGiftQuantity: 0, gifts: {} };
  }
  ledger.totalBySender[sender].totalGiftEvents += 1;
  ledger.totalBySender[sender].totalGiftQuantity += quantity;
  ledger.totalBySender[sender].gifts[giftName] =
    (ledger.totalBySender[sender].gifts[giftName] ?? 0) + quantity;

  ledger.recentGifts.unshift({ giftName, sender, quantity, timestamp: new Date().toISOString() });
  if (ledger.recentGifts.length > 50) ledger.recentGifts.pop();

  return ledger;
}

export function getGiftLedger(): GiftLedgerState {
  return { ...ledger };
}

export function resetGiftLedger() {
  ledger.totalGiftEvents = 0;
  ledger.totalGiftQuantity = 0;
  ledger.totalByGiftName = {};
  ledger.totalBySender = {};
  ledger.recentGifts = [];
}

export function resetCooldowns() {
  for (const key of Object.keys(lastTriggeredByRule)) {
    delete lastTriggeredByRule[key];
  }
}

// ─── Rule Engine ───────────────────────────────────────────────────────────────

function ruleMatchesGift(rule: GiftRule, giftName: string, quantity: number, senderTotal: number): boolean {
  if (!rule.enabled) return false;

  const { when } = rule;

  // Gift name check
  if (when.giftName && when.giftName !== '*') {
    const names = Array.isArray(when.giftName) ? when.giftName : [when.giftName];
    if (!names.some((n) => n.toLowerCase() === giftName.toLowerCase())) return false;
  }

  // Quantity check
  if (when.minQuantity && quantity < when.minQuantity) return false;

  // Sender session total check
  if (when.senderSessionTotalMin && senderTotal < when.senderSessionTotalMin) return false;

  return true;
}

function evaluateRules(
  giftName: string,
  quantity: number,
  senderTotal: number,
): { rule: GiftRule | null; blocked: boolean; blockedReason: string | null } {
  const now = Date.now();

  for (const rule of activeRules) {
    if (!ruleMatchesGift(rule, giftName, quantity, senderTotal)) continue;

    // Cooldown check
    const lastTriggered = lastTriggeredByRule[rule.id] ?? 0;
    if (now - lastTriggered < rule.cooldownMs) {
      return {
        rule: null,
        blocked: true,
        blockedReason: `cooldown_active (rule=${rule.id}, remaining=${Math.ceil((rule.cooldownMs - (now - lastTriggered)) / 1000)}s)`,
      };
    }

    // Rule matched — record trigger time
    lastTriggeredByRule[rule.id] = now;
    return { rule, blocked: false, blockedReason: null };
  }

  return { rule: null, blocked: false, blockedReason: 'no_rule_matched' };
}

// ─── Main Pipeline ─────────────────────────────────────────────────────────────

function makeStep(step: string, status: PipelineStep['status'], detail: string): PipelineStep {
  return { step, status, detail, timestamp: new Date().toISOString() };
}

/**
 * The main pipeline entry point.
 * Call this whenever a raw text event is received (OCR, test injector, etc.).
 */
export function processRawEvent(rawText: string, source: LiveEvent['source'] = 'test'): GiftPipelineResult {
  const tempEvent: LiveEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source,
    zoneName: 'auto',
    text: rawText,
    kind: 'chat',
    time: new Date().toLocaleTimeString(),
    createdAt: new Date().toISOString(),
  };

  const steps: PipelineStep[] = [];
  steps.push(makeStep('raw_received', 'ok', `Texto bruto: "${rawText}"`));

  // 1. Deterministic classification
  const classified = classifyEventDeterministic(tempEvent);
  steps.push(makeStep(
    'classified',
    classified.kind === 'gift' ? 'ok' : 'blocked',
    `kind=${classified.kind}, giftName=${classified.metadata?.giftName ?? 'n/a'}, qty=${classified.metadata?.quantity ?? 'n/a'}`,
  ));

  if (classified.kind !== 'gift') {
    const result: GiftPipelineResult = {
      event: classified,
      classified: false,
      ledgerUpdated: false,
      ruleMatched: null,
      videoTriggered: null,
      blocked: true,
      blockedReason: `not_a_gift (kind=${classified.kind})`,
      steps,
    };
    pipelineLogCallback?.(result);
    return result;
  }

  // 2. Update ledger
  const giftName = String(classified.metadata?.giftName ?? 'Unknown');
  const sender = String(classified.metadata?.user ?? 'Unknown');
  const quantity = Number(classified.metadata?.quantity ?? 1);

  updateLedger(giftName, sender, quantity);
  const senderTotal = ledger.totalBySender[sender]?.totalGiftQuantity ?? quantity;

  steps.push(makeStep(
    'ledger_updated',
    'ok',
    `sender=${sender}, giftName=${giftName}, qty=${quantity}, senderTotal=${senderTotal}, sessionTotal=${ledger.totalGiftQuantity}`,
  ));

  // 3. Evaluate rules
  const { rule, blocked, blockedReason } = evaluateRules(giftName, quantity, senderTotal);

  if (blocked) {
    steps.push(makeStep('rule_cooldown', 'blocked', blockedReason ?? 'cooldown'));
    const result: GiftPipelineResult = {
      event: classified,
      classified: true,
      ledgerUpdated: true,
      ruleMatched: null,
      videoTriggered: null,
      blocked: true,
      blockedReason,
      steps,
    };
    pipelineLogCallback?.(result);
    return result;
  }

  if (!rule) {
    steps.push(makeStep('rule_engine', 'blocked', blockedReason ?? 'no_rule_matched'));
    const result: GiftPipelineResult = {
      event: classified,
      classified: true,
      ledgerUpdated: true,
      ruleMatched: null,
      videoTriggered: null,
      blocked: true,
      blockedReason: blockedReason,
      steps,
    };
    pipelineLogCallback?.(result);
    return result;
  }

  steps.push(makeStep('rule_matched', 'ok', `rule=${rule.id} → videoId=${rule.action.videoId}`));

  // 4. Trigger video
  const videoId = rule.action.videoId;
  steps.push(makeStep('video_trigger', 'ok', `Playing videoId=${videoId}`));

  if (videoPlayCallback) {
    videoPlayCallback(videoId, `Gift: ${giftName} x${quantity} from ${sender} (rule: ${rule.id})`);
    steps.push(makeStep('video_playing', 'ok', `VideoPlaybackService called with ${videoId}`));
  } else {
    steps.push(makeStep('video_playing', 'error', 'No VideoPlayCallback registered!'));
  }

  const result: GiftPipelineResult = {
    event: classified,
    classified: true,
    ledgerUpdated: true,
    ruleMatched: rule,
    videoTriggered: videoId,
    blocked: false,
    blockedReason: null,
    steps,
  };

  pipelineLogCallback?.(result);
  return result;
}
