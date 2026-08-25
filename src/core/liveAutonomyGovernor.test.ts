import { beforeEach, describe, expect, it } from 'vitest';
import {
  governPersonaDecision,
  recordLiveAutonomyReply,
  resetLiveAutonomyGovernorHistory,
} from './liveAutonomyGovernor';
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

  it('blocks public replies when any event in the round is moderation', () => {
    const result = governPersonaDecision(
      [event, { ...event, id: 'mod', kind: 'moderation', text: 'spam detectado' }],
      decision,
      {
        config,
        hasVisualTarget: true,
      },
    );

    expect(result.decision.actions[0].payload.governorBlockedReason).toBe('moderation_risk');
    expect(result.logs.join('\n')).toContain('moderation_risk');
  });

  it('blocks problematic event text and unsafe public reply text', () => {
    const problematic = governPersonaDecision(
      [{ ...event, text: 'Bot: compre seguidores em www.fake.test', metadata: { confidence: 0.9 } }],
      decision,
      {
        config,
        hasVisualTarget: true,
      },
    );
    expect(problematic.decision.actions[0].payload.governorBlockedReason).toBe('problematic_event');

    const spendPressure = governPersonaDecision(
      [event],
      {
        ...decision,
        actions: [decision.actions[0]],
        speech: 'manda presente',
        intent: 'bad_reply',
      },
      {
        config,
        hasVisualTarget: true,
      },
    );
    spendPressure.decision.actions[0].payload.message = 'manda presente agora pra bater a meta';
    const checked = governPersonaDecision([event], spendPressure.decision, {
      config,
      hasVisualTarget: true,
    });
    expect(checked.decision.actions[0].payload.governorBlockedReason).toBe('spend_pressure');

    const blockedTopic = governPersonaDecision(
      [event],
      {
        ...decision,
        actions: [{ ...decision.actions[0], payload: { message: 'me chama no whatsapp' } }],
      },
      {
        config,
        hasVisualTarget: true,
      },
    );
    expect(blockedTopic.decision.actions[0].payload.governorBlockedReason).toBe(
      'blocked_public_topic',
    );
  });

  it('blocks semantically similar public replies across recent rounds', () => {
    recordLiveAutonomyReply('dry_run', undefined, 1_000, 'Oi Lucas, bem-vindo ao chat!');

    const result = governPersonaDecision(
      [event],
      {
        ...decision,
        actions: [{ ...decision.actions[0], payload: { message: 'Lucas, bem vindo no chat' } }],
      },
      {
        config,
        hasVisualTarget: true,
        now: 2_000,
      },
    );

    expect(result.decision.actions[0].payload.governorBlockedReason).toBe('semantic_duplicate');
  });

  it('deprioritizes casual chat replies when a gift is the primary event', () => {
    const gift: LiveEvent = {
      ...event,
      id: 'gift',
      kind: 'gift',
      text: 'Ana enviou Rosa',
      metadata: { confidence: 0.95, user: 'Ana', giftName: 'Rosa' },
    };

    const result = governPersonaDecision(
      [event, gift],
      {
        ...decision,
        actions: [{ ...decision.actions[0], payload: { message: 'Oi Lucas, tudo bem?' } }],
      },
      {
        config,
        hasVisualTarget: true,
      },
    );

    expect(result.decision.actions[0].payload.governorBlockedReason).toBe('gift_priority');
  });

  it('blocks real chat replies when local agent is missing', () => {
    const result = governPersonaDecision([event], decision, {
      config: { ...config, autoChatReplyMode: 'real' },
      hasVisualTarget: true,
      hasLocalAgent: false,
    });

    expect(result.decision.actions[0].payload.governorBlockedReason).toBe('local_agent_missing');
  });
});
