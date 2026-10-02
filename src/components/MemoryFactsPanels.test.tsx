import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonaSelfFacts, ViewerMemoryDetails } from './MemoryFactsPanels';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('MemoryFactsPanels', () => {
  it('mostra o que a IA sabe da pessoa e deixa apagar um fato', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return json({ ok: true });
      return json({
        facts: [
          { id: 'vf-1', fact: 'é de Campinas', category: 'cidade', created_at: '2026-10-01' },
          { id: 'vf-2', fact: 'trabalha com TI', category: 'trabalho', created_at: '2026-10-01' },
        ],
        summaries: [{ summary: 'Carlos contou do trabalho em TI.' }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ViewerMemoryDetails profileId="carlos_sp" username="carlos_sp" />);
    expect(await screen.findByText('é de Campinas')).toBeTruthy();
    expect(screen.getByText('Carlos contou do trabalho em TI.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apagar: é de Campinas' }));
    await waitFor(() => expect(screen.queryByText('é de Campinas')).toBeNull());
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/memory\/facts\/vf-1$/);
    expect(screen.getByText('trabalha com TI')).toBeTruthy();
  });

  it('lista o que a persona ativa já contou de si', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/personas/active')) return json({ persona: { id: 'viktoria', name: 'Viktoria' }, config: {} });
        return json({ facts: [{ id: 'pf-1', fact: 'disse que o vinho favorito é Malbec', created_at: '2026-10-01' }] });
      }),
    );
    render(<PersonaSelfFacts />);
    expect(await screen.findByText('disse que o vinho favorito é Malbec')).toBeTruthy();
    expect(screen.getByText(/O que Viktoria já contou de si/)).toBeTruthy();
  });
});
