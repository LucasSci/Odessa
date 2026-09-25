import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_MS, usePresence } from './usePresence';

describe('usePresence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fechado desde o início não monta', () => {
    const { result } = renderHook(() => usePresence(false));
    expect(result.current).toEqual({ mounted: false, state: 'closed' });
  });

  it('abre na hora e mantém montado durante a saída', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: false } });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, state: 'open' });

    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, state: 'closed' });

    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(result.current.mounted).toBe(false);
  });

  it('reabrir durante a saída cancela a desmontagem', () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(EXIT_MS / 2));
    rerender({ open: true });
    act(() => vi.advanceTimersByTime(EXIT_MS * 2));
    expect(result.current).toEqual({ mounted: true, state: 'open' });
  });
});
