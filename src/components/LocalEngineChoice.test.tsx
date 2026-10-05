import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalEngineChoice } from './LocalEngineChoice';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('LocalEngineChoice', () => {
  it('mostra o motor ativo e troca para o Ollama', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? json({ mode: 'ollama', available: true, running: false, model: null, device: null })
        : json({ mode: 'gpu', available: true, running: true, model: 'qwen3:4b-instruct', device: 'gpu' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<LocalEngineChoice />);
    expect(await screen.findByText(/Carregado: qwen3:4b-instruct na GPU integrada/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'GPU integrada (rápido)' }).getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Ollama' }));
    });
    expect(JSON.parse(String(fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')?.[1]?.body))).toEqual({ mode: 'ollama' });
    expect(await screen.findByText(/Usa o Ollama instalado/)).toBeTruthy();
  });

  it('sem o motor no computador, a opção da GPU fica desligada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'ollama', available: false, running: false, model: null, device: null })));
    render(<LocalEngineChoice />);
    const gpu = await screen.findByRole('radio', { name: 'GPU integrada (rápido)' });
    expect((gpu as HTMLButtonElement).disabled).toBe(true);
  });
});
