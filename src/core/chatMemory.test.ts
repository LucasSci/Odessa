import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetMemoryProfile,
  getMemoryContext,
  listMemoryProfiles,
  redactPersonalData,
  rememberBridgeMessage,
  rememberPersonaReply,
  requestMemoryLearning,
  resetChatMemory,
  setMemoryProfileHidden,
} from './chatMemory';
import { getChatInsights } from './chatLearning';
import { globalRAGMemory } from './longTermMemory';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('chatMemory', () => {
  it('mascara e-mail, telefone e números longos', () => {
    expect(redactPersonalData('me chama em ana@mail.com ou (11) 98765-4321')).toBe('me chama em [e-mail] ou [número]');
  });

  it('busca o contexto pronto do servidor (o mesmo para qualquer IA) e guarda em cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ context: 'ana já conversa com Viktoria. O que você já sabe: é de Campinas.', used: ['1 fato(s) de @ana'] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ctx = await getMemoryContext('@ana', { id: 'viktoria', name: 'Viktoria' });
    expect(ctx.context).toContain('Campinas');
    expect(ctx.used).toEqual(['1 fato(s) de @ana']);
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://x');
    expect(url.pathname).toMatch(/\/memory\/context$/);
    expect(url.searchParams.get('username')).toBe('ana');
    expect(url.searchParams.get('persona')).toBe('viktoria');
    await getMemoryContext('ana', { id: 'viktoria', name: 'Viktoria' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sem backend nada entra no prompt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(getMemoryContext('bia-offline')).resolves.toEqual({ context: '', used: [] });
  });

  it('grava a fala da persona ligada a quem ela respondeu', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    rememberPersonaReply('@carlos', 'Campinas à noite é linda. Meu fone é 11987654321', 'viktoria');
    await vi.advanceTimersByTimeAsync(3_100);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { events: Array<Record<string, unknown>> };
    expect(body.events[0]).toMatchObject({ kind: 'reply', text: 'Campinas à noite é linda. Meu fone é [número]', metadata: { user: 'carlos', persona: 'viktoria' } });
  });

  it('pede o aprendizado com a IA ativa, sem rodar dois ao mesmo tempo', async () => {
    let release: (v: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((r) => { release = r; }));
    vi.stubGlobal('fetch', fetchMock);
    const first = requestMemoryLearning({ personaId: 'viktoria', personaName: 'Viktoria', provider: 'gemini', providerKey: 'AIza-x' });
    await requestMemoryLearning({ provider: 'ollama' });
    release(new Response('{"status":"done"}', { status: 200 }));
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ persona_id: 'viktoria', provider: 'gemini', provider_key: 'AIza-x' });
  });

  it('não guarda mensagens de moderação e envia o resto em lote', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    rememberBridgeMessage({ username: 'ana', text: 'amei a música' }, 'chat');
    rememberBridgeMessage({ username: 'bot', text: 'compre seguidores' }, 'moderation');
    rememberBridgeMessage({ username: 'bia', text: 'meu zap 11987654321' }, 'chat');
    await vi.advanceTimersByTimeAsync(3_100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { events: Array<{ text: string; source: string }> };
    expect(body.events.map((e) => e.text)).toEqual(['ana: amei a música', 'bia: meu zap [número]']);
    expect(body.events.every((e) => e.source === 'bridge')).toBe(true);
  });

  it('resetar aprendizado limpa tendências e memória do backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ usersCleared: 3 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(resetChatMemory()).resolves.toEqual({ usersCleared: 3 });
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(getChatInsights().totalMessages).toBe(0);
  });

  it('lista espectadores, inclusive ocultos, já no formato da tela (#252)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          profiles: [{ id: 'gabi', username: 'Gabi', last_seen: '2026-09-25T10:00:00Z', total_messages: 4, total_gifts: 2, hidden: 1 }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(listMemoryProfiles(' ga ')).resolves.toEqual([
      { id: 'gabi', username: 'Gabi', lastSeen: '2026-09-25T10:00:00Z', totalMessages: 4, totalGifts: 2, hidden: true },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://x');
    expect(url.pathname).toMatch(/\/memory\/profiles$/);
    expect(url.searchParams.get('q')).toBe('ga');
    expect(url.searchParams.get('includeHidden')).toBe('true');
  });

  it('ocultar e esquecer chamam o backend e invalidam o cache do contexto (#252)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ context: 'hugo é de Natal', used: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'hidden' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ context: '', used: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'cleared' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const profile = { id: 'hugo', username: 'Hugo' };

    await expect(getMemoryContext('hugo')).resolves.toMatchObject({ context: 'hugo é de Natal' });
    await setMemoryProfileHidden(profile, true);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/memory\/profiles\/hugo\/visibility$/);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ hidden: true }) });
    // Sem cache: a próxima resposta já respeita o "oculto".
    await expect(getMemoryContext('hugo')).resolves.toMatchObject({ context: '' });

    await forgetMemoryProfile(profile);
    expect(String(fetchMock.mock.calls[3][0])).toMatch(/\/memory\/profiles\/hugo$/);
    expect(fetchMock.mock.calls[3][1].method).toBe('DELETE');
  });

  it('resetar, esquecer e ocultar valem também para os fatos que a Diretora lê (#254)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{}', { status: 200 })));
    globalRAGMemory.storeFact('Iara', 'gosta', 'gosta de forró');
    globalRAGMemory.storeFact('joao', 'pedido', 'toca samba');
    globalRAGMemory.storeFact('kika', 'gosta', 'gosta de rock');

    await setMemoryProfileHidden({ id: 'iara', username: 'Iara' }, true);
    expect(globalRAGMemory.retrieveContext(['Iara'])).toBe('');
    await setMemoryProfileHidden({ id: 'iara', username: 'Iara' }, false);
    expect(globalRAGMemory.retrieveContext(['Iara'])).toContain('forró');

    await forgetMemoryProfile({ id: 'joao', username: 'joao' });
    expect(globalRAGMemory.retrieveContext(['joao'])).toBe('');
    expect(globalRAGMemory.retrieveContext(['kika'])).toContain('rock');

    await resetChatMemory();
    expect(globalRAGMemory.retrieveContext(['Iara', 'kika'])).toBe('');
  });

  it('ocultar vale no navegador mesmo se o backend falhar; mostrar não', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"detail":"erro"}', { status: 500 })));
    globalRAGMemory.storeFact('lia', 'gosta', 'gosta de jazz');
    await expect(setMemoryProfileHidden({ id: 'lia', username: 'lia' }, true)).rejects.toThrow();
    expect(globalRAGMemory.retrieveContext(['lia'])).toBe('');
    await expect(setMemoryProfileHidden({ id: 'lia', username: 'lia' }, false)).rejects.toThrow();
    expect(globalRAGMemory.retrieveContext(['lia'])).toBe('');
    globalRAGMemory.clear();
  });
});
