import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PageActivity } from './pageActivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextPollDelay, usePolling } from './usePolling';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('nextPollDelay', () => {
  it('volta ao intervalo normal sem falhas e dobra a cada falha até o teto', () => {
    expect(nextPollDelay(1000, 0, 8000)).toBe(1000);
    expect(nextPollDelay(1000, 1, 8000)).toBe(2000);
    expect(nextPollDelay(1000, 2, 8000)).toBe(4000);
    expect(nextPollDelay(1000, 5, 8000)).toBe(8000);
  });
});

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('consulta na hora e depois a cada intervalo', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling(fn, 1000));
    await advance(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await advance(2000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('immediate:false espera o primeiro intervalo', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling(fn, 1000, { immediate: false }));
    await advance(500);
    expect(fn).not.toHaveBeenCalled();
    await advance(600);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('não empilha pedidos quando a consulta demora mais que o intervalo', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      inFlight -= 1;
    });
    renderHook(() => usePolling(slow, 1000));
    await advance(10_000);
    expect(maxInFlight).toBe(1);
    expect(slow.mock.calls.length).toBeLessThan(5);
  });

  it('espaça as tentativas depois de falhas e volta ao normal ao dar certo', async () => {
    let fail = true;
    const fn = vi.fn(async () => {
      if (fail) throw new Error('backend fora');
    });
    renderHook(() => usePolling(fn, 1000));
    await advance(0); // 1ª (falha) -> próxima em 2s
    expect(fn).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    await advance(1000); // 2ª (falha) -> próxima em 4s
    expect(fn).toHaveBeenCalledTimes(2);
    await advance(3000);
    expect(fn).toHaveBeenCalledTimes(2);
    fail = false;
    await advance(1000); // 3ª (sucesso) -> volta a 1s
    expect(fn).toHaveBeenCalledTimes(3);
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('pausa com a aba oculta e retoma na hora ao voltar', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling(fn, 1000));
    await advance(0);
    setVisibility('hidden');
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await advance(0);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('pauseWhenHidden:false segue consultando com a aba oculta', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling(fn, 1000, { pauseWhenHidden: false }));
    setVisibility('hidden');
    await advance(3000);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('enabled:false não consulta e desligar cancela o pedido em andamento', async () => {
    const signals: AbortSignal[] = [];
    const fn = vi.fn(async (signal: AbortSignal) => {
      signals.push(signal);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    });
    const { rerender } = renderHook(({ enabled }) => usePolling(fn, 1000, { enabled }), {
      initialProps: { enabled: false },
    });
    await advance(3000);
    expect(fn).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await advance(0);
    expect(signals).toHaveLength(1);
    rerender({ enabled: false });
    expect(signals[0].aborted).toBe(true);
    await advance(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('usa sempre a versão mais recente do callback sem reiniciar o timer', async () => {
    const calls: string[] = [];
    const { rerender } = renderHook(({ tag }) => usePolling(() => { calls.push(tag); }, 1000), {
      initialProps: { tag: 'a' },
    });
    await advance(0);
    rerender({ tag: 'b' });
    await advance(1000);
    expect(calls).toEqual(['a', 'b']);
  });

  it('para de consultar ao desmontar', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => usePolling(fn, 1000));
    await advance(0);
    unmount();
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('pausa com a página escondida pelo shell e consulta na hora ao voltar', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    let active = true;
    const wrapper = ({ children }: { children: ReactNode }) => <PageActivity active={active}>{children}</PageActivity>;
    const { rerender } = renderHook(() => usePolling(fn, 1000, { immediate: false }), { wrapper });
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    active = false;
    rerender();
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(1);

    // Volta à página: não espera o intervalo, mesmo com immediate:false.
    active = true;
    rerender();
    await advance(0);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
