import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  FakeEventSource.instances = [];
});

describe('videoStateEvents', () => {
  it('uma conexão para todos, avisa cada um e fecha só sem ninguém ouvindo', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const { subscribeVideoState, isVideoStateStreaming } = await import('./videoStateEvents');
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeVideoState(a);
    const offB = subscribeVideoState(b);
    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0];
    expect(es.url).toMatch(/\/video\/events$/);

    es.onopen?.();
    expect(isVideoStateStreaming()).toBe(true);
    es.onmessage?.();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    offB();
    // Reassinar logo em seguida reaproveita a conexão.
    const offC = subscribeVideoState(vi.fn());
    vi.advanceTimersByTime(2500);
    expect(es.closed).toBe(false);
    offC();
    vi.advanceTimersByTime(2500);
    expect(es.closed).toBe(true);
    expect(isVideoStateStreaming()).toBe(false);
  });

  it('sem EventSource (navegador antigo, jsdom) não quebra', async () => {
    vi.stubGlobal('EventSource', undefined);
    const { subscribeVideoState, isVideoStateStreaming } = await import('./videoStateEvents');
    const off = subscribeVideoState(vi.fn());
    expect(isVideoStateStreaming()).toBe(false);
    off();
  });
});
