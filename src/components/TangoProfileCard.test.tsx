import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TangoProfileCard } from './TangoProfileCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

async function confirmRebuild() {
  fireEvent.click(screen.getByRole('button', { name: /Recriar perfil do Tango/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Recriar agora\?/ }));
  });
}

describe('TangoProfileCard', () => {
  it('sem chave colada, pede para reaproveitar a do OBS e avisa a tela nova', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ ok: true, keyReused: true, encoderApplied: true, canvas: { width: 720, height: 1280 } }));
    vi.stubGlobal('fetch', fetchMock);
    const onRebuilt = vi.fn();
    render(<TangoProfileCard onRebuilt={onRebuilt} />);
    await confirmRebuild();
    expect(await screen.findByText(/com a chave que já estava no OBS, tela 720×1280/)).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({});
    expect(onRebuilt).toHaveBeenCalledWith({ width: 720, height: 1280 });
  });

  it('chave colada vai no pedido e some do campo depois', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ ok: true, keyReused: false, encoderApplied: true, canvas: { width: 720, height: 1280 } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<TangoProfileCard />);
    const field = screen.getByLabelText(/Chave de transmissão do Tango/) as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.change(field, { target: { value: ' live_123 ' } });
    await confirmRebuild();
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ streamKey: 'live_123' });
    expect(field.value).toBe('');
  });

  it('mostra o motivo quando o OBS recusa (live no ar)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ detail: 'O OBS está transmitindo. Pare antes de recriar o perfil.' }, 409)));
    const onRebuilt = vi.fn();
    render(<TangoProfileCard onRebuilt={onRebuilt} />);
    await confirmRebuild();
    expect(onRebuilt).not.toHaveBeenCalled();
  });
});
