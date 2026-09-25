import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMemoryProfiles } from './ChatMemoryProfiles';
import { ToastProvider } from './Toast';

const profiles = [
  { id: 'ana', username: 'ana', last_seen: '2026-09-25T10:00:00Z', total_messages: 12, total_gifts: 2, hidden: 0 },
  { id: 'bia', username: 'bia', last_seen: '2026-09-25T09:00:00Z', total_messages: 3, total_gifts: 0, hidden: 1 },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function renderLoaded(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  render(
    <ToastProvider>
      <ChatMemoryProfiles />
    </ToastProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

function row(username: string) {
  return screen.getByText(`@${username}`).closest('li') as HTMLElement;
}

describe('ChatMemoryProfiles (#252)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('lista espectadores e marca quem está oculto', async () => {
    await renderLoaded(vi.fn().mockImplementation(async () => json({ profiles })));
    expect(within(row('ana')).getByText('12 mensagens')).toBeTruthy();
    expect(within(row('ana')).getByText('2 presentes')).toBeTruthy();
    expect(within(row('bia')).getByText('oculto')).toBeTruthy();
    expect(within(row('bia')).getByRole('button', { name: /Mostrar/ })).toBeTruthy();
  });

  it('ocultar muda a linha sem recarregar a lista', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ profiles }))
      .mockResolvedValueOnce(json({ status: 'hidden' }));
    await renderLoaded(fetchMock);
    await act(async () => {
      fireEvent.click(within(row('ana')).getByRole('button', { name: /Ocultar/ }));
    });
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/memory\/profiles\/ana\/visibility$/);
    expect(within(row('ana')).getByText('oculto')).toBeTruthy();
    expect(screen.getByText('@ana não entra mais nas respostas.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('esquecer pede confirmação e tira o espectador da lista', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ profiles }))
      .mockResolvedValueOnce(json({ status: 'cleared' }));
    await renderLoaded(fetchMock);
    fireEvent.click(within(row('ana')).getByRole('button', { name: /Esquecer/ }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(within(row('ana')).getByRole('button', { name: 'Apagar mesmo?' }));
    });
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
    expect(screen.queryByText('@ana')).toBeNull();
    expect(screen.getByText('@bia')).toBeTruthy();
  });

  it('busca só depois que a digitação para', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ profiles: [] }));
    await renderLoaded(fetchMock);
    expect(screen.getByText('Ninguém na memória ainda')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar espectador'), { target: { value: 'c' } });
    fireEvent.change(screen.getByLabelText('Buscar espectador'), { target: { value: 'ca' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1][0]), 'http://x').searchParams.get('q')).toBe('ca');
    expect(screen.getByText('Ninguém com esse nome')).toBeTruthy();
  });

  it('mostra erro com "Tentar de novo" quando a memória não responde', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ detail: 'boom' }, 500))
      .mockResolvedValueOnce(json({ profiles }));
    await renderLoaded(fetchMock);
    expect(screen.getByText('Memória indisponível')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('@ana')).toBeTruthy();
  });
});
