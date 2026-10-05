import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShutdownButton } from './ShutdownButton';

function mockFetch(onAir: boolean) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const body = url.includes('/obs/live-health')
        ? { transmission: { streamActive: onAir, virtualCameraActive: false } }
        : { ok: true, shuttingDown: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.odessaDesktop;
});

describe('ShutdownButton', () => {
  it('avisa quando a live está no ar antes de desligar', async () => {
    mockFetch(true);
    render(<ShutdownButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Desligar Odessa' }));
    expect(await screen.findByText(/A live está no ar/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Desligar mesmo assim' })).toBeTruthy();
  });

  it('no navegador desliga pelo servidor e mostra que pode fechar a aba', async () => {
    const calls = mockFetch(false);
    render(<ShutdownButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Desligar Odessa' }));
    await waitFor(() => expect(calls.some((c) => c.includes('/obs/live-health'))).toBe(true));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Desligar' }));
    });
    expect(await screen.findByText('Odessa desligado')).toBeTruthy();
    expect(calls.some((c) => c.includes('/system/shutdown'))).toBe(true);
  });

  it('no programa desktop quem desliga é o Electron', async () => {
    mockFetch(false);
    const shutdown = vi.fn(async () => undefined);
    window.odessaDesktop = { isDesktop: true, shutdown, hideToTray: vi.fn() };
    render(<ShutdownButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Desligar Odessa' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Desligar' }));
    });
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Odessa desligado')).toBeNull();
  });
});
