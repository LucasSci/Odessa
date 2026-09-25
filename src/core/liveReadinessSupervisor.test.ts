import { describe, expect, it } from 'vitest';
import { buildLiveSupervisorSnapshot, type LiveSupervisorInput } from './liveReadinessSupervisor';

const now = Date.parse('2026-07-09T12:00:00.000Z');

function baseInput(patch: Partial<LiveSupervisorInput> = {}): LiveSupervisorInput {
  return {
    now,
    capture: { bridgeConnected: true, stream: 'connected', lastMessageAt: now - 5_000 },
    chat: { sendMode: 'real', bridgeConnected: true, inputReady: true, lastSendStatus: 'sent' },
    obs: { connected: true, currentScene: 'Live', scenes: ['Live'], hasStageSource: true },
    video: {
      currentVideoId: 'idle',
      idleVideoId: 'idle',
      queueSize: 0,
      updatedAt: '2026-07-09T11:59:58.000Z',
    },
    autonomyLevel: 'auto',
    autoChatEnabled: true,
    ...patch,
  };
}

function subsystem(input: LiveSupervisorInput, id: string) {
  return buildLiveSupervisorSnapshot(input).checklist.find((item) => item.id === id)!;
}

describe('liveReadinessSupervisor', () => {
  it('marks a fully prepared live as healthy', () => {
    const snapshot = buildLiveSupervisorSnapshot(baseInput());

    expect(snapshot.state).toBe('healthy');
    expect(snapshot.readyToStart).toBe(true);
    expect(snapshot.recoveryActions).toEqual([]);
    expect(snapshot.checklist.map((item) => item.id)).toEqual(['capture', 'chat', 'obs', 'video']);
  });

  it('pauses autonomous chat when the bridge is not reading the chat', () => {
    const snapshot = buildLiveSupervisorSnapshot(
      baseInput({ capture: { bridgeConnected: false, stream: 'stopped' } }),
    );

    expect(snapshot.state).toBe('blocked');
    expect(snapshot.recoveryActions).toContain('pause_auto_chat');
    expect(subsystem(baseInput({ capture: { bridgeConnected: false, stream: 'stopped' } }), 'capture').suggestedAction).toMatch(
      /Inicie a bridge/,
    );
  });

  it('treats a reconnecting stream as a warning and a failed stream as blocked', () => {
    expect(subsystem(baseInput({ capture: { bridgeConnected: true, stream: 'reconnecting' } }), 'capture').state).toBe('warning');
    expect(subsystem(baseInput({ capture: { bridgeConnected: true, stream: 'failed' } }), 'capture').state).toBe('blocked');
  });

  it('a quiet chat is not a failure', () => {
    const capture = subsystem(baseInput({ capture: { bridgeConnected: true, stream: 'connected', lastMessageAt: null } }), 'capture');
    expect(capture.state).toBe('healthy');
    expect(capture.detail).toMatch(/aguardando mensagens/);
  });

  it('dry-run is ready but flagged as simulated', () => {
    const chat = subsystem(baseInput({ chat: { sendMode: 'dry_run', bridgeConnected: false, inputReady: false } }), 'chat');
    expect(chat.state).toBe('healthy');
    expect(chat.simulated).toBe(true);
    expect(chat.detail).toMatch(/nada é enviado/);
  });

  it('real sending needs the bridge, a confirmed input field and no recent failure', () => {
    const offline = subsystem(baseInput({ chat: { sendMode: 'real', bridgeConnected: false, inputReady: true } }), 'chat');
    expect(offline).toMatchObject({ state: 'blocked', recoveryActions: ['pause_auto_chat'] });

    const unconfirmed = subsystem(baseInput({ chat: { sendMode: 'real', bridgeConnected: true, inputReady: false } }), 'chat');
    expect(unconfirmed.state).toBe('warning');

    const failed = subsystem(
      baseInput({ chat: { sendMode: 'real', bridgeConnected: true, inputReady: true, lastSendStatus: 'failed', lastSendError: 'timeout' } }),
      'chat',
    );
    expect(failed).toMatchObject({ state: 'warning', detail: 'timeout', recoveryActions: ['pause_auto_chat'] });

    expect(subsystem(baseInput(), 'chat').detail).toMatch(/Campo do chat validado/);
  });

  it('asks to reconnect OBS and reduce autonomy when OBS is down', () => {
    const snapshot = buildLiveSupervisorSnapshot(baseInput({ obs: { connected: false, scenes: [], error: 'OBS off' } }));
    expect(snapshot.recoveryActions).toEqual(expect.arrayContaining(['reconnect_obs', 'reduce_autonomy']));
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
