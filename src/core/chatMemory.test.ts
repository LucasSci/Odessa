import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUserMemoryContext, getUserMemory, redactPersonalData, rememberBridgeMessage, resetChatMemory } from './chatMemory';
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
});
