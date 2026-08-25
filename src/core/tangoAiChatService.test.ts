import { describe, expect, it } from 'vitest';
import {
  checkSafetyRestrictions,
  sanitizeTangoReply,
} from './tangoAiChatService';

describe('tangoAiChatService', () => {
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
