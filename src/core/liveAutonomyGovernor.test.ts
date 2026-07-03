import { beforeEach, describe, expect, it } from 'vitest';
import { governPersonaDecision, resetLiveAutonomyGovernorHistory } from './liveAutonomyGovernor';
import type { LiveEvent, PersonaDecision } from '../types';

const event: LiveEvent = {
  id: 'e1',
  source: 'ocr',
  kind: 'chat',
  zoneName: 'Chat Tango',
  text: 'Lucas: Oi?',
  createdAt: '2026-07-03T12:00:00Z',
  time: '12:00:00',
  metadata: { confidence: 0.9, message: 'Oi?' },
};

const decision: PersonaDecision = {
  speech: 'Oi, Lucas!',
  intent: 'respond_chat',
  confidence: 0.9,
  reason: 'teste',
  priority: 'normal',
  actions: [
    {
      id: 'a1',
      type: 'chat_reply',
      label: 'Resposta',
      capability: 'chat.reply',
      payload: { message: 'Oi, Lucas!' },
      simulated: true,
      status: 'queued',
    },
    {
      id: 'a2',
      type: 'chat_reply',
      label: 'Resposta extra',
      capability: 'chat.reply',
      payload: { message: 'Extra' },
      simulated: true,
      status: 'queued',
    },
  ],
};

const config = {
  geminiKey: '',
  systemPrompt: '',
  provider: 'auto' as const,
  confidenceThreshold: 0.65,
  autonomyLevel: 'auto' as const,
  geminiProxyUrl: '',
  autoChatReplyEnabled: true,
  autoChatReplyMode: 'dry_run' as const,
  chatReplyCooldownMs: 15_000,
  chatReplyMaxPerMinute: 4,
  chatReplyMinConfidence: 0.65,
};

describe('liveAutonomyGovernor', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetLiveAutonomyGovernorHistory();
  });

  it('allows at most one public reply and marks dry-run', () => {
    const result = governPersonaDecision([event], decision, {
      config,
      hasVisualTarget: true,
      now: 1_000,
    });

    expect(result.decision.actions[0].payload.governorAllowed).toBe(true);
    expect(result.decision.actions[0].payload.dryRun).toBe(true);
    expect(result.decision.actions[1].payload.governorBlockedReason).toBe('max_one_public_reply');
  });

  it('blocks low confidence and missing target', () => {
    const low = governPersonaDecision([{ ...event, metadata: { confidence: 0.4 } }], decision, {
      config,
      hasVisualTarget: true,
    });
    expect(low.decision.actions[0].payload.governorBlockedReason).toBe('low_ocr_confidence');

    const missingTarget = governPersonaDecision([event], decision, {
      config,
      hasVisualTarget: false,
    });
    expect(missingTarget.decision.actions[0].payload.governorBlockedReason).toBe('visual_target_missing');
  });

  it('blocks moderation risk', () => {
    const result = governPersonaDecision([{ ...event, kind: 'moderation' }], decision, {
      config,
      hasVisualTarget: true,
    });
    expect(result.decision.actions[0].payload.governorBlockedReason).toBe('moderation_risk');
  });
});
