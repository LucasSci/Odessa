import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TangoProfileCard } from './TangoProfileCard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const inSixDays = new Date(Date.now() + 6 * 86400_000).toISOString();
const STATUS = {
  ok: false,
  obsRunning: true,
  activeProfile: 'Tango Profile',
  profiles: [
    { name: 'Tango Profile', folder: 'TangoProfile (7)', active: true, canvas: '1080×1920', differences: ['Video.BaseCX: 1080 (modelo 720)'], key: { present: true, expiresAt: inSixDays, daysLeft: 6.4, expired: false, expiringSoon: true } },
    { name: 'Tango Profile', folder: 'TangoProfile2', active: false, canvas: '720×1280', differences: [], key: { present: false, expiresAt: null, daysLeft: null, expired: false, expiringSoon: false } },
  ],
  problems: ['2 perfis do Tango (pastas TangoProfile (7), TangoProfile2): o OBS pode usar o errado.'],
};
const CLEAN = {
  ok: true, removed: ['TangoProfile (7)', 'TangoProfile2'], backup: 'C:/obs/backup', keySource: 'colada',
  key: { present: true, expiresAt: inSixDays, daysLeft: 6.4, expired: false, expiringSoon: true },
  obsRestarted: true, obsWasRunning: true, canvas: { width: 720, height: 1280 },
};

afterEach(() => vi.unstubAllGlobals());

function mockApi(cleanResponse: Response = json(CLEAN)) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    String(input).includes('/clean') ? cleanResponse : json(STATUS),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function confirmClean() {
  fireEvent.click(screen.getByRole('button', { name: /Configuração limpa/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Fechar o OBS e configurar\?/ }));
  });
}

describe('TangoProfileCard', () => {
  it('mostra o diagnóstico: duplicados, perfil ativo e quando a chave vence', async () => {
    mockApi();
    render(<TangoProfileCard />);
    expect(await screen.findByText(/2 perfis do Tango/)).toBeTruthy();
    expect(screen.getByText('TangoProfile (7)')).toBeTruthy();
    expect(screen.getByText('ativo')).toBeTruthy();
    expect(screen.getByText(/chave vence .* 6 dias/)).toBeTruthy();
    expect(screen.getByText('sem chave')).toBeTruthy();
  });

  it('chave colada vai no pedido, some do campo e o resultado aparece', async () => {
    const fetchMock = mockApi();
    const onRebuilt = vi.fn();
    render(<TangoProfileCard onRebuilt={onRebuilt} />);
    await screen.findByText(/2 perfis do Tango/);
    const field = screen.getByLabelText(/Chave de transmissão do Tango/) as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.change(field, { target: { value: ' chave-nova ' } });
    await confirmClean();
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/clean'))!;
    expect((call[1]?.body as FormData).get('streamKey')).toBe('chave-nova');
    expect(await screen.findByText(/Perfil do Tango criado do zero \(720×1280\)/)).toBeTruthy();
    expect(screen.getByText(/O OBS foi reaberto/)).toBeTruthy();
    expect(field.value).toBe('');
    expect(onRebuilt).toHaveBeenCalledWith({ width: 720, height: 1280 });
  });

  it('mostra o motivo quando o servidor recusa (live no ar) e não avisa a tela', async () => {
    mockApi(json({ detail: 'A live está no ar (ou a câmera virtual ligada). Pare antes da configuração limpa.' }, 409));
    const onRebuilt = vi.fn();
    render(<TangoProfileCard onRebuilt={onRebuilt} />);
    await screen.findByText(/2 perfis do Tango/);
    await confirmClean();
    expect(onRebuilt).not.toHaveBeenCalled();
    expect(screen.queryByText(/criado do zero/)).toBeNull();
  });
});
