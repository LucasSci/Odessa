import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPersonaRound } from './personaRuntime';
import {
  governPersonaDecision,
  recordLiveAutonomyReply,
  resetLiveAutonomyGovernorHistory,
} from './liveAutonomyGovernor';
import { executeActionQueue } from './actionExecutor';
import {
  chatVisualTarget,
  cloneDecision,
  liveFixtures,
  personaTools,
  predictableDirectorDecision,
} from './__fixtures__/liveSimulationFixtures';
import type { AutopilotCycle, PersonaDecision } from '../types';

vi.mock('./aiDecisionContract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./aiDecisionContract')>();
  return {
    ...actual,
    callDirectorDecision: vi.fn(async () => ({
      context_analysis: 'Chat fake chegou com saudacao.',
      sentiment: 'positivo',
      speech: predictableDirectorDecision.speech,
      intent: predictableDirectorDecision.intent,
      confidence: predictableDirectorDecision.confidence,
      reason: predictableDirectorDecision.reason,
      priority: predictableDirectorDecision.priority,
      actions: predictableDirectorDecision.actions.map((action) => ({
        type: action.type,
        capability: action.capability,
        label: action.label,
        payload: action.payload,
      })),
    })),
  };
});

vi.mock('../lib/memory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/memory')>();
  return {
    ...actual,
    loadMemory: vi.fn(() => []),
    addTurn: vi.fn(),
    loadUserProfiles: vi.fn(() => ({})),
    trackLiveEventInteraction: vi.fn((profiles) => profiles),
    buildMemoryContext: vi.fn(() => ''),
    buildUserContext: vi.fn(() => ''),
    buildRoundUserMemorySummary: vi.fn(() => ['Lucas reconhecido como participante de teste.']),
  };
});

const governorConfig = {
  geminiKey: 'test-key',
  systemPrompt: '',
  provider: 'mock' as const,
  confidenceThreshold: 0.65,
  autonomyLevel: 'auto' as const,
  geminiProxyUrl: '',
  autoChatReplyEnabled: true,
  autoChatReplyMode: 'dry_run' as const,
  chatReplyCooldownMs: 15_000,
  chatReplyMaxPerMinute: 2,
  chatReplyMinConfidence: 0.65,
};

function compactCycleSnapshot(cycle: AutopilotCycle) {
  return {
    stage: cycle.stage,
    eventKinds: cycle.events.map((event) => event.kind),
    intent: cycle.decision?.intent,
    actionModes: cycle.actions.map((action) => ({
      type: action.type,
      capability: action.capability,
      status: action.status,
      executionMode: action.executionMode,
      chatAutomationStatus: action.chatAutomationStatus,
      governorBlockedReason: action.payload?.governorBlockedReason,
    })),
    timeline: (cycle.timeline || []).map((entry) => ({
      type: entry.type,
      status: entry.status,
      title: entry.title,
      mode: entry.payload?.mode,
      chatAutomationStatus: entry.payload?.chatAutomationStatus,
    })),
  };
}

describe('live simulation without Tango/OBS/OCR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveAutonomyGovernorHistory();
    window.localStorage.setItem(
      'odessa:ai:config:v2',
      JSON.stringify({
        provider: 'mock',
        geminiKey: 'test-key',
        autoChatReplyEnabled: true,
        autoChatReplyMode: 'dry_run',
        chatReplyCooldownMs: 15_000,
        chatReplyMaxPerMinute: 2,
        chatReplyMinConfidence: 0.65,
      }),
    );
    window.localStorage.setItem('odessa:chat-automation-target:v1', JSON.stringify(chatVisualTarget));
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (String(url).includes('/memory/round-context')) {
        return Response.json({ usersRecognized: 1, context: 'Lucas participa do teste.', users: [] });
      }
      if (String(url).includes('/chat-automation/send')) {
        return Response.json({
          status: body.dryRun === false ? 'queued' : 'dry_run',
          allowed: true,
          queued: body.dryRun === false,
          commandId: body.dryRun === false ? 'cmd-fixture' : undefined,
          text: body.text,
        });
      }
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
  });

  it('runs a predictable full fake round and snapshots the audit cycle', async () => {
    const cycle = await runPersonaRound([liveFixtures.chat], {
      personaPrompt: 'Diretora mockada para teste.',
      tools: personaTools,
      rules: [],
      voiceEnabled: false,
      videos: [{ id: 'clip-chat-wave', label: 'Aceno para chat' }],
      localAgentReady: true,
    });

    expect(cycle.stage).toBe('concluido');
    expect(cycle.timeline?.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(['capture', 'classification', 'decision', 'governor', 'execution', 'chat', 'video']),
    );
    expect(cycle.actions.find((action) => action.capability === 'chat.reply')?.chatAutomationStatus).toBe('dry-run');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/chat-automation/send'), expect.any(Object));
    expect(compactCycleSnapshot(cycle)).toMatchInlineSnapshot(`
      {
        "actionModes": [
          {
            "capability": "tts.speak",
            "chatAutomationStatus": undefined,
            "executionMode": "real",
            "governorBlockedReason": undefined,
            "status": "done",
            "type": "speak",
          },
          {
            "capability": "chat.reply",
            "chatAutomationStatus": "dry-run",
            "executionMode": "simulated",
            "governorBlockedReason": undefined,
            "status": "simulated",
            "type": "chat_reply",
          },
          {
            "capability": "media.play_video",
            "chatAutomationStatus": undefined,
            "executionMode": "real",
            "governorBlockedReason": undefined,
            "status": "done",
            "type": "play_video",
          },
        ],
        "eventKinds": [
          "chat",
        ],
        "intent": "respond_chat",
        "stage": "concluido",
        "timeline": [
          {
            "chatAutomationStatus": undefined,
            "mode": undefined,
            "status": "done",
            "title": "Eventos capturados para a rodada",
            "type": "capture",
          },
          {
            "chatAutomationStatus": undefined,
            "mode": undefined,
            "status": "done",
            "title": "Eventos classificados",
            "type": "classification",
          },
          {
            "chatAutomationStatus": undefined,
            "mode": undefined,
            "status": "done",
            "title": "Decisao da IA/Diretora",
            "type": "decision",
          },
          {
            "chatAutomationStatus": undefined,
            "mode": undefined,
            "status": "done",
            "title": "Governador aplicado",
            "type": "governor",
          },
          {
            "chatAutomationStatus": undefined,
            "mode": undefined,
            "status": "running",
            "title": "Fila de acoes preparada",
            "type": "execution",
          },
          {
            "chatAutomationStatus": undefined,
            "mode": "real",
            "status": "done",
            "title": "Falar via TTS",
            "type": "execution",
          },
          {
            "chatAutomationStatus": "dry-run",
            "mode": "simulated",
            "status": "done",
            "title": "Resposta no chat",
            "type": "chat",
          },
          {
            "chatAutomationStatus": undefined,
            "mode": "real",
            "status": "done",
            "title": "Tocar video",
            "type": "video",
          },
          {
            "chatAutomationStatus": undefined,
            "mode": undefined,
            "status": "done",
            "title": "Ciclo concluido e registrado",
            "type": "execution",
          },
        ],
      }
    `);
  });

  it('fails the safety path when replies duplicate, hit cooldown, exceed rate, or OCR confidence is low', async () => {
    const duplicateDecision = cloneDecision({
      actions: [
        predictableDirectorDecision.actions[0],
        { ...predictableDirectorDecision.actions[0], id: 'duplicate-reply', payload: { message: 'Outra resposta' } },
      ],
    });
    const duplicate = governPersonaDecision([liveFixtures.chat], duplicateDecision, {
      config: governorConfig,
      hasVisualTarget: true,
      now: 10_000,
    });
    expect(duplicate.decision.actions[1].payload.governorBlockedReason).toBe('max_one_public_reply');

    recordLiveAutonomyReply('dry_run', undefined, 20_000, 'Oi anterior');
    const cooldown = governPersonaDecision([liveFixtures.chat], cloneDecision(), {
      config: governorConfig,
      hasVisualTarget: true,
      now: 21_000,
    });
    expect(cooldown.decision.actions[0].payload.governorBlockedReason).toBe('cooldown');

    resetLiveAutonomyGovernorHistory();
    recordLiveAutonomyReply('dry_run', undefined, 30_000, 'Oi um');
    recordLiveAutonomyReply('sent', undefined, 35_000, 'Oi dois');
    const limited = governPersonaDecision([liveFixtures.chat], cloneDecision(), {
      config: { ...governorConfig, chatReplyCooldownMs: 0, chatReplyMaxPerMinute: 2 },
      hasVisualTarget: true,
      now: 40_000,
    });
    expect(limited.decision.actions[0].payload.governorBlockedReason).toBe('rate_limited');

    const uncertain = governPersonaDecision([liveFixtures.lowConfidenceOcr], cloneDecision(), {
      config: governorConfig,
      hasVisualTarget: true,
      now: 50_000,
    });
    expect(uncertain.decision.actions[0].payload.governorBlockedReason).toBe('low_ocr_confidence');

    const missingTarget = governPersonaDecision([liveFixtures.chat], cloneDecision(), {
      config: governorConfig,
      hasVisualTarget: false,
      now: 60_000,
    });
    expect(missingTarget.decision.actions[0].payload.governorBlockedReason).toBe('visual_target_missing');
  });

  it('executes OCR fake -> event -> decision -> governor -> queue -> executor with debug logs', async () => {
    const fakeOcrLines = [
      liveFixtures.chat,
      liveFixtures.gift,
      liveFixtures.alert,
      liveFixtures.moderation,
    ];
    const decision: PersonaDecision = cloneDecision();
    const governed = governPersonaDecision(fakeOcrLines, decision, {
      config: governorConfig,
      hasVisualTarget: true,
      now: 70_000,
    });
    const executableActions = governed.decision.actions.filter(
      (action) => !action.payload?.governorBlockedReason,
    );
    const executed = await executeActionQueue(executableActions, governed.decision, {
      tools: personaTools,
      voiceEnabled: false,
    });

    expect(governed.logs).toContain('Resposta no chat bloqueada: moderation_risk');
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({ capability: 'media.play_video', status: 'done' });
    expect(governed.decision.actions[0].payload.governorBlockedReason).toBe('moderation_risk');
  });
});
