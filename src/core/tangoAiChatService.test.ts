import { describe, expect, it } from 'vitest';
import {
  checkSafetyRestrictions,
  describeBackendAiFailure,
  sanitizeTangoReply,
  limitEmojis,
  personaNameFromIdentity,
  isContactRequest,
  contactDeflection,
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
