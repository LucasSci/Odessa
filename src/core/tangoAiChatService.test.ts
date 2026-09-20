import { describe, expect, it } from 'vitest';
import {
  checkSafetyRestrictions,
  describeBackendAiFailure,
  sanitizeTangoReply,
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
});
