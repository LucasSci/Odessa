/**
 * Respostas em inglês (o padrão): o pacote do prompt em inglês, com a persona em
 * inglês, e os filtros que valem para qualquer IA. Calibrado em 6 rodadas de 15
 * conversas de live com a IA local (ver docs/PLANO-OTIMIZACAO.md).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt, CONVERSATION_STYLE_EN, buildConversationTurns, generateTangoChatReply } from './tangoAiChatService';
import { cleanReply, limitQuestions, paceEmojis, soundsLikeAssistant } from './humanizeReply';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('pacote do prompt em inglês', () => {
  it('instruções, hora e últimas falas em inglês (sem misturar com português)', () => {
    const prompt = buildSystemPrompt({
      identity: 'You are Viktoria.',
      recentOwn: ['Malbec, my usual.'],
      now: new Date(2026, 9, 2, 22, 5),
      language: 'en',
    });
    expect(prompt).toContain(CONVERSATION_STYLE_EN);
    expect(prompt).toContain('[NOW] Friday, 22:05 (evening)');
    expect(prompt).toContain("[YOUR LAST LINES ON THIS LIVE] Don't repeat");
    expect(prompt).not.toMatch(/COMO VOCÊ CONVERSA|\[AGORA\]|SUAS ÚLTIMAS FALAS/);
  });

  it('o estilo cobre o que a avaliação pegou', () => {
    for (const rule of ['Never describe what you', 'No metaphors', 'Follow the thread', 'one reply in five', 'Always reply in English', 'hints you aren']) {
      expect(CONVERSATION_STYLE_EN).toContain(rule);
    }
    // Vale para qualquer persona: nada específico da Viktoria.
    expect(CONVERSATION_STYLE_EN).not.toMatch(/Noir|Malbec|Viktoria/);
  });

  it('nome que não é de gente vira "someone" na conversa', () => {
    const turns = buildConversationTurns([], { username: '$100,Give-l00K,Coin', text: 'hi' }, undefined, 'en');
    expect(turns).toEqual([{ role: 'user', content: 'someone: hi' }]);
  });
});

describe('quem responde: persona em inglês por padrão, a original no "mesmo da mensagem"', () => {
  function mockServer() {
    const prompts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/memory/context')) return new Response(JSON.stringify({ context: '', used: [] }), { status: 200 });
      prompts.push(JSON.parse(String(init?.body)).persona_prompt);
      return new Response(JSON.stringify({ response: 'Hey, good timing.', provider: 'ollama' }), { status: 200 });
    }));
    return prompts;
  }

  it('padrão: usa a persona em inglês e o estilo em inglês, mesmo com mensagem em português', async () => {
    const prompts = mockServer();
    const result = await generateTangoChatReply({ username: 'joana', text: 'oi linda, de onde você é?' }, [], 'Você é a Viktoria.', {
      identityEn: 'You are Viktoria, 29, from São Paulo.',
    });
    expect(result.ok).toBe(true);
    expect(prompts[0]).toContain('You are Viktoria, 29, from São Paulo.');
    expect(prompts[0]).not.toContain('Você é a Viktoria.');
    expect(prompts[0]).toContain('HOW YOU TALK IN CHAT');
  });

  it('"o mesmo da mensagem": persona original e estilo em português', async () => {
    window.localStorage.setItem('odessa:ai:config:v2', JSON.stringify({ replyLanguage: 'auto' }));
    const prompts = mockServer();
    await generateTangoChatReply({ username: 'joana', text: 'oi linda, de onde você é?' }, [], 'Você é a Viktoria.', {
      identityEn: 'You are Viktoria.',
    });
    expect(prompts[0]).toContain('Você é a Viktoria.');
    expect(prompts[0]).toContain('COMO VOCÊ CONVERSA');
  });
});

describe('filtros que valem para qualquer IA', () => {
  it('emoji: no máximo 1, e nenhum se usou nas últimas 4 falas', () => {
    expect(paceEmojis('Malbec, my usual. 🍷😏', [])).toBe('Malbec, my usual. 🍷');
    expect(paceEmojis('Malbec, my usual. 🍷', ['Hey 🖤', 'ok'])).toBe('Malbec, my usual.');
  });

  it('pergunta no fim: corta quando duas das últimas três já terminaram em pergunta', () => {
    const recent = ['Long day?', 'Nice.', 'What happened?'];
    expect(limitQuestions("That's brutal. How'd you get home?", recent)).toBe("That's brutal.");
    expect(limitQuestions("That's brutal. How'd you get home?", ['Nice.', 'Okay.'])).toBe("That's brutal. How'd you get home?");
    expect(limitQuestions('You?', recent)).toBe('You?'); // sem o que sobrar, fica
  });

  it('travessão vira vírgula e "someone" não vira vocativo', () => {
    expect(cleanReply('Lasagna—crispy and cheesy', [])).toBe('Lasagna, crispy and cheesy');
    expect(cleanReply('Hey someone, welcome', [])).toBe('Hey someone, welcome');
    expect(cleanReply('Welcome, someone.', [])).toBe('Welcome.');
  });

  it('tom de assistente em inglês é barrado', () => {
    for (const line of ['Feel free to ask me anything!', 'Great question!', 'As an AI, I...', 'Better ask a real person.', 'Let me know if you need anything']) {
      expect(soundsLikeAssistant(line)).toBe(true);
    }
    expect(soundsLikeAssistant('Nope. Love life stays private.')).toBe(false);
  });
});
