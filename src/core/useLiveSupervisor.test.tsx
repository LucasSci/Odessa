import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotRuntimeState } from './useAutopilotRuntime';

const session = {
  processStatus: { bridgeStatus: { status: 'disconnected' } },
  sseState: 'stopped',
  messages: [] as Array<{ timestamp?: string }>,
  executionMode: 'real',
  replyQueue: [] as Array<{ status: string }>,
  autonomyMode: 'auto',
  setAutonomyMode: vi.fn(),
};

vi.mock('./tangoChatSession', () => ({ useTangoChatSession: () => session }));

const { useLiveSupervisor } = await import('./useLiveSupervisor');

function runtime(patch: Partial<AutopilotRuntimeState> = {}) {
  return {
    autopilotEnabled: false,
    obsError: null,
    obsScenes: ['Live'],
    currentObsScene: 'Live',
    videoMonitor: { currentVideoId: 'idle', idleVideoId: 'idle', queueSize: 0, updatedAt: new Date().toISOString(), error: null },
    autonomyLevel: 'auto',
    runRecoveryAction: vi.fn(async () => undefined),
    ...patch,
  } as unknown as AutopilotRuntimeState;
}

describe('useLiveSupervisor', () => {
  beforeEach(() => {
    session.setAutonomyMode.mockClear();
    session.autonomyMode = 'auto';
  });

  it('fora da live só informa: não mexe na autonomia', () => {
    const rt = runtime();
    const { result } = renderHook(() => useLiveSupervisor(rt));
    expect(result.current.state).toBe('blocked');
    expect(session.setAutonomyMode).not.toHaveBeenCalled();
    expect(rt.runRecoveryAction).not.toHaveBeenCalled();
  });

  it('com a live no ar e a bridge caída, pausa o chat autônomo uma vez e avisa', () => {
    const rt = runtime({ autopilotEnabled: true });
    const onPaused = vi.fn();
    const { rerender } = renderHook(() => useLiveSupervisor(rt, onPaused));
    rerender();
    expect(session.setAutonomyMode).toHaveBeenCalledTimes(1);
    expect(session.setAutonomyMode).toHaveBeenCalledWith('assistido');
    expect(onPaused).toHaveBeenCalledWith(expect.stringMatching(/Bridge do Tango desconectada/));
    expect(rt.runRecoveryAction).toHaveBeenCalledWith('pause_auto_chat');
  });
});
