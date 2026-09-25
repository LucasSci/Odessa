import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildUserMemoryContext,
  forgetMemoryProfile,
  getUserMemory,
  listMemoryProfiles,
  redactPersonalData,
  rememberBridgeMessage,
  resetChatMemory,
  setMemoryProfileHidden,
} from './chatMemory';
import { getChatInsights } from './chatLearning';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('chatMemory', () => {
  it('mascara e-mail, telefone e números longos', () => {
    expect(redactPersonalData('me chama em ana@mail.com ou (11) 98765-4321')).toBe('me chama em [e-mail] ou [número]');
  });

  it('usuário novo: boas-vindas sem fingir intimidade', () => {
    const { context, used } = buildUserMemoryContext('ana', { found: false, totalMessages: 0, totalGifts: 0 });
    expect(context).toMatch(/novo\(a\).*sem fingir/);
    expect(used).toEqual(['@ana: primeira vez na memória']);
  });

  it('recorrente e presenteador aparecem nas memórias usadas', () => {
    const { context, used } = buildUserMemoryContext('@bia', { found: true, totalMessages: 12, totalGifts: 2 });
    expect(context).toMatch(/recorrente \(12 mensagens/);
    expect(context).toMatch(/sem inventar detalhes nem intimidade/);
    expect(used).toEqual(['@bia: recorrente (12 mensagens)', '@bia: presenteador (2 presentes)']);
  });

  it('sem backend nada entra no prompt', () => {
    expect(buildUserMemoryContext('ana', null)).toEqual({ context: '', used: [] });
  });

  it('lê o perfil do backend e trata 404 como usuário novo', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ profile: { total_messages: 5, total_gifts: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'User profile not found' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getUserMemory('carla')).resolves.toEqual({ found: true, totalMessages: 5, totalGifts: 1 });
    await expect(getUserMemory('davi')).resolves.toEqual({ found: false, totalMessages: 0, totalGifts: 0 });
  });

  it('resposta sem perfil (modo nuvem) conta como memória indisponível, não como usuário novo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ profiles: [], mode: 'cloud' }), { status: 200 })));
    await expect(getUserMemory('eva')).resolves.toBeNull();
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

  it('espectador ocultado pelo operador não entra no prompt (#252)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ profile: { total_messages: 9, total_gifts: 0, hidden: 1 } }), { status: 200 })),
    );
    await expect(getUserMemory('fabio')).resolves.toBeNull();
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

  it('ocultar e esquecer chamam o backend e invalidam o cache do perfil (#252)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ profile: { total_messages: 7, total_gifts: 0 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'hidden' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ profile: { total_messages: 7, total_gifts: 0, hidden: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'cleared' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'User profile not found' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const profile = { id: 'hugo', username: 'Hugo' };

    await expect(getUserMemory('hugo')).resolves.toMatchObject({ found: true, totalMessages: 7 });
    await setMemoryProfileHidden(profile, true);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/memory\/profiles\/hugo\/visibility$/);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ hidden: true }) });
    // Sem cache: a próxima resposta já respeita o "oculto".
    await expect(getUserMemory('hugo')).resolves.toBeNull();

    await forgetMemoryProfile(profile);
    expect(String(fetchMock.mock.calls[3][0])).toMatch(/\/memory\/profiles\/hugo$/);
    expect(fetchMock.mock.calls[3][1].method).toBe('DELETE');
    await expect(getUserMemory('hugo')).resolves.toEqual({ found: false, totalMessages: 0, totalGifts: 0 });
  });
});
