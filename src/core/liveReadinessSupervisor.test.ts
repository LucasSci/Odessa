import { describe, expect, it } from 'vitest';
import { buildLiveSupervisorSnapshot, type LiveSupervisorInput } from './liveReadinessSupervisor';

const now = Date.parse('2026-07-09T12:00:00.000Z');

function baseInput(patch: Partial<LiveSupervisorInput> = {}): LiveSupervisorInput {
  return {
    now,
    capturedEvents: [
      {
        id: 'ocr-1',
        source: 'ocr',
        zoneName: 'Chat Tango',
        text: 'Lucas: oi',
        kind: 'chat',
        createdAt: '2026-07-09T11:59:55.000Z',
        time: '11:59:55',
        metadata: { confidence: 0.9 },
      },
      {
        id: 'ocr-2',
        source: 'ocr',
        zoneName: 'Chat Tango',
        text: 'Ana: boa',
        kind: 'chat',
        createdAt: '2026-07-09T11:59:40.000Z',
        time: '11:59:40',
        metadata: { confidence: 0.88 },
      },
    ],
    obs: {
      connected: true,
      currentScene: 'Live',
      scenes: ['Live'],
      hasOcrSource: true,
      hasStageSource: true,
    },
    video: {
      currentVideoId: 'idle',
      idleVideoId: 'idle',
      queueSize: 0,
      updatedAt: '2026-07-09T11:59:58.000Z',
    },
    chat: {
      visualTargetReady: true,
      allowlistReady: true,
      localAgentReady: true,
    },
    autonomyLevel: 'auto',
    autoChatEnabled: true,
    ...patch,
  };
}

describe('liveReadinessSupervisor', () => {
  it('marks a fully prepared live as healthy', () => {
    const snapshot = buildLiveSupervisorSnapshot(baseInput());

    expect(snapshot.state).toBe('healthy');
    expect(snapshot.readyToStart).toBe(true);
    expect(snapshot.recoveryActions).toEqual([]);
  });

  it('pauses risky chat when OCR is stale or low confidence', () => {
    const snapshot = buildLiveSupervisorSnapshot(
      baseInput({
        capturedEvents: [
          {
            id: 'ocr-low',
            source: 'ocr',
            zoneName: 'Chat Tango',
            text: '???',
            kind: 'chat',
            createdAt: '2026-07-09T11:59:59.000Z',
            time: '11:59:59',
            metadata: { confidence: 0.42 },
          },
        ],
      }),
    );

    expect(snapshot.state).toBe('warning');
    expect(snapshot.recoveryActions).toContain('pause_auto_chat');
  });

  it('blocks chat automation when local agent or visual target is missing', () => {
    const snapshot = buildLiveSupervisorSnapshot(
      baseInput({
        chat: {
          visualTargetReady: false,
          allowlistReady: false,
          localAgentReady: false,
        },
      }),
    );

    expect(snapshot.state).toBe('blocked');
    expect(snapshot.recoveryActions).toContain('pause_auto_chat');
    expect(snapshot.recoveryActions).toContain('reduce_autonomy');
  });

  it('requests return_to_idle when video appears stuck outside idle', () => {
    const snapshot = buildLiveSupervisorSnapshot(
      baseInput({
        video: {
          currentVideoId: 'gift-video',
          idleVideoId: 'idle',
          queueSize: 0,
          updatedAt: '2026-07-09T11:55:00.000Z',
        },
      }),
    );

    expect(snapshot.state).toBe('recovering');
    expect(snapshot.recoveryActions).toContain('return_to_idle');
  });
});
