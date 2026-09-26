import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outranks, useOverlayLeader } from './overlayLeader';

/** BroadcastChannel síncrono em memória: entrega para todas as outras instâncias do mesmo canal. */
class FakeChannel {
  static open = new Set<FakeChannel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    FakeChannel.open.add(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeChannel.open) {
      if (other !== this && other.name === this.name) other.onmessage?.({ data } as MessageEvent);
    }
  }
  close() {
    FakeChannel.open.delete(this);
  }
}

describe('useOverlayLeader (#overlay duplicado no OBS)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeChannel.open.clear();
    vi.stubGlobal('BroadcastChannel', FakeChannel);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('a primeira cópia assume, a segunda fica em espera e assume quando a primeira fecha', () => {
    const first = renderHook(() => useOverlayLeader());
    expect(first.result.current).toBe(false); // escuta antes de assumir
    act(() => vi.advanceTimersByTime(1000));
    expect(first.result.current).toBe(true);

    vi.setSystemTime(Date.now() + 5000);
    const second = renderHook(() => useOverlayLeader());
    act(() => vi.advanceTimersByTime(5000));
    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(false); // cópia extra: sem vídeo

    first.unmount(); // fonte principal fechada no OBS
    act(() => vi.advanceTimersByTime(4000));
    expect(second.result.current).toBe(true);
  });

  it('duas cópias abertas juntas: a mais antiga fica, a outra cede', () => {
    const a = renderHook(() => useOverlayLeader());
    vi.setSystemTime(Date.now() + 10);
    const b = renderHook(() => useOverlayLeader());
    act(() => vi.advanceTimersByTime(3000));
    expect([a.result.current, b.result.current]).toEqual([true, false]);
  });

  it('desempate', () => {
    expect(outranks({ id: 'a', since: 1 }, { id: 'b', since: 2 })).toBe(true);
    expect(outranks({ id: 'b', since: 1 }, { id: 'a', since: 1 })).toBe(false);
  });
});
