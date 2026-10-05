import { describe, expect, it } from 'vitest';
import {
  checkSafetyRestrictions,
  describeBackendAiFailure,
  sanitizeTangoReply,
  limitEmojis,
  personaNameFromIdentity,
  isContactRequest,
  contactDeflection,
  buildConversationTurns,
  scrubEchoedChat,
  buildSystemPrompt,
  CONVERSATION_STYLE,
} from './tangoAiChatService';

describe('tangoAiChatService', () => {
  it('explica o 503 ai_unavailable com o motivo de cada provedor', () => {
    const body = JSON.stringify({ detail: { code: 'ai_unavailable', errors: ['Ollama: connection refused', 'Gemini: chave inválida'] } });
    expect(describeBackendAiFailure(503, body)).toBe('IA indisponível — Ollama: connection refused | Gemini: chave inválida');
  });

  it('mantém texto genérico para outros erros do backend', () => {
    expect(describeBackendAiFailure(502, 'boom')).toBe('Backend retornou HTTP 502: boom');
    expect(describeBackendAiFailure(503, 'não é json')).toBe('Backend retornou HTTP 503: não é json');
  });

  it('sanitizes quotes and trims excessive whitespace', () => {
    const raw = '  "Oi @Lucas! Tudo bem com você? ✨"  ';
    const clean = sanitizeTangoReply(raw);
    expect(clean).toBe('Oi @Lucas! Tudo bem com você? ✨');
  });

  it('truncates messages exceeding maxLength (140 chars)', () => {
    const longText = 'A'.repeat(160);
    const clean = sanitizeTangoReply(longText, 140);
    expect(clean.length).toBeLessThanOrEqual(140);
    expect(clean.endsWith('…')).toBe(true);
  });

  it('detects blocked terms according to safety rules', () => {
    expect(checkSafetyRestrictions('Oi amor, tudo bem?').safe).toBe(true);
    expect(checkSafetyRestrictions('Me manda um pix de 10 reais').safe).toBe(false);
    expect(checkSafetyRestrictions('Acesse o link na bio').safe).toBe(false);
    expect(checkSafetyRestrictions('Me chama no whatsapp 99999').safe).toBe(false);
  });

  it('tira o rótulo "Nome:" que o modelo copia do histórico', () => {
    expect(sanitizeTangoReply('Odessa: tudo sim, e você?')).toBe('tudo sim, e você?');
    expect(sanitizeTangoReply('"Viktoria: Boa noite."')).toBe('Boa noite.');
    expect(sanitizeTangoReply('Oii carlos_sp! tudo certo')).toBe('Oii carlos_sp! tudo certo');
    expect(sanitizeTangoReply('são 10:30 aqui')).toBe('são 10:30 aqui');
  });
});

describe('proteções que não dependem do modelo', () => {
  const VIKTORIA = 'Você é a Viktoria, 29 anos.\nMensagem "me passa seu whatsapp" → "Meu mistério mora aqui, na live. Fique por perto."';

  it('pedido de contato vira a recusa do próprio prompt da persona', () => {
    for (const msg of ['passa teu zap aí', 'me passa seu whats', 'tem insta?', 'qual seu número?', 'me chama no pv']) {
      expect(isContactRequest(msg)).toBe(true);
    }
    expect(contactDeflection(VIKTORIA)).toBe('Meu mistério mora aqui, na live. Fique por perto.');
    expect(contactDeflection('Você é a Nova.')).toBeTruthy(); // sem exemplo no prompt: recusa padrão
  });

  it('conversa normal não é confundida com pedido de contato', () => {
    for (const msg of ['vc joga no celular?', 'qual seu número da sorte? kkk', 'num instante eu volto', 'que zapeada no canal kkk']) {
      expect(isContactRequest(msg)).toBe(false);
    }
  });

  it('no máximo 1 emoji e sem o nome da persona no começo', () => {
    expect(limitEmojis('Oii 🙌💖 tudo bem? 😊✨')).toBe('Oii 🙌 tudo bem?');
    expect(personaNameFromIdentity(VIKTORIA)).toBe('Viktoria');
    expect(sanitizeTangoReply('Viktoria 🖤👀 Sou de São Paulo. E você? 💕', 140, 'Viktoria')).toBe('Sou de São Paulo. E você? 💕');
    expect(sanitizeTangoReply('Oii 🙅‍♂️ kkk', 140)).toBe('Oii 🙅‍♂️ kkk');
  });
});

describe('conversa em turnos (igual para toda IA)', () => {
  it('persona = assistant, espectadores = user com nome, termina na mensagem atual', () => {
    const history = [
      { username: 'Odessa', text: 'oi gente!', own: true }, // começo da própria persona: descartado
      { username: 'carlos_sp', text: 'boa noite' },
      { username: 'marina22', text: 'oii' },
      { username: 'Odessa', text: 'oi Carlos, oi Marina 😊', own: true },
    ];
    const incoming = { username: 'carlos_sp', text: 'tudo certo?' };
    expect(buildConversationTurns(history, incoming)).toEqual([
      { role: 'user', content: 'carlos_sp: boa noite\nmarina22: oii' },
      { role: 'assistant', content: 'oi Carlos, oi Marina 😊' },
      { role: 'user', content: 'carlos_sp: tudo certo?' },
    ]);
  });

  it('não duplica a mensagem atual quando ela já está no histórico', () => {
    const incoming = { username: 'ana', text: 'oi' };
    expect(buildConversationTurns([incoming], incoming)).toEqual([{ role: 'user', content: 'ana: oi' }]);
  });

  it('linhas da plataforma ficam de fora e nome que não é de gente vira "alguém"', () => {
    const history = [
      { username: 'Battle Results:', text: 'Winner: Viktoriiaa' },
      { username: 'Chill Wolf', text: 'Novo seguidor!' },
      { username: '$100,Give-l00K,Coin', text: 'oi linda' },
    ];
    expect(buildConversationTurns(history, { username: '$100,Give-l00K,Coin', text: 'como foi seu dia?' })).toEqual([
      { role: 'user', content: 'alguém: oi linda\nalguém: como foi seu dia?' },
    ]);
  });
});

describe('o mesmo pacote de prompt para qualquer IA', () => {
  it('identidade, jeito de conversar, hora, memória e últimas falas, nesta ordem', () => {
    const prompt = buildSystemPrompt({
      identity: 'Você é a Viktoria.',
      memory: '[SOBRE QUEM ESTÁ FALANDO] carlos é de Campinas.',
      recentOwn: ['Boa noite.', 'Malbec, sempre.'],
      now: new Date(2026, 9, 2, 22, 0),
    });
    const order = ['Você é a Viktoria.', 'COMO VOCÊ CONVERSA', '[AGORA] sexta-feira, 22h00', 'carlos é de Campinas', '- Malbec, sempre.'];
    const positions = order.map((part) => prompt.indexOf(part));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('a regra de conversa cobre o que soava artificial', () => {
    for (const rule of ['feminino', 'nunca copie', 'IA, robô ou bot', 'não acompanha', 'quer saber mais', 'e você?']) {
      expect(CONVERSATION_STYLE).toContain(rule);
    }
  });
});

describe('resposta que copia o chat não é enviada', () => {
  const history = [
    { username: 'Kungfu Panda', text: 'Boa noite minha deusa deslumbrante' },
    { username: 'Kungfu Panda', text: 'Como você está esta noite' },
    { username: 'Odessa', text: 'Boa noite! Tá ótimo!', own: true },
  ];
  const incoming = { username: 'Kungfu Panda', text: 'Como você está esta noite' };

  it('corta onde a IA começa a escrever a fala de um espectador (caso real da live)', () => {
    const real = 'Tá ótimo! Obrigada por lembrar do amor né? 💖 Como foi seu dia hoje? Kungfu Panda: Boa noite minha deusa deslumbrante Como você está esta n…';
    expect(scrubEchoedChat(real, history, incoming)).toBe('Tá ótimo! Obrigada por lembrar do amor né? 💖 Como foi seu dia hoje?');
  });

  it('descarta resposta que só devolve a mensagem do espectador', () => {
    expect(scrubEchoedChat('Como você está esta noite?', history, incoming)).toBe('');
    expect(scrubEchoedChat('Kungfu Panda: Boa noite minha deusa deslumbrante', history, incoming)).toBe('');
  });

  it('resposta normal passa intacta', () => {
    expect(scrubEchoedChat('Tô bem, e você? Obrigada pelo carinho!', history, incoming)).toBe('Tô bem, e você? Obrigada pelo carinho!');
  });
});
