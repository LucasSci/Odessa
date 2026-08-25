import { describe, expect, it } from 'vitest';
import { parseTangoChatLine } from './tangoChatParser';

describe('tangoChatParser', () => {
  it('parses normal chat messages', () => {
    const parsed = parseTangoChatLine('@Lucas: Oi Juju!');
    expect(parsed.discarded).toBe(false);
    if (!parsed.discarded) {
      expect(parsed.kind).toBe('chat');
      expect(parsed.user).toBe('Lucas');
      expect(parsed.message).toBe('Oi Juju!');
    }
  });

  it('parses gifts', () => {
    const parsed = parseTangoChatLine('Ana enviou Rosa x3');
    expect(parsed.discarded).toBe(false);
    if (!parsed.discarded) {
      expect(parsed.kind).toBe('gift');
      expect(parsed.metadata?.giftName).toBe('Rosa');
      expect(parsed.metadata?.quantity).toBe(3);
    }
  });

  it('parses follows and joins as alerts', () => {
    const parsed = parseTangoChatLine('Bruno começou a seguir');
    expect(parsed.discarded).toBe(false);
    if (!parsed.discarded) expect(parsed.kind).toBe('alert');
  });

  it('flags suspicious messages as moderation', () => {
    const parsed = parseTangoChatLine('Bot: compre seguidores em www.spam.test');
    expect(parsed.discarded).toBe(false);
    if (!parsed.discarded) expect(parsed.kind).toBe('moderation');
  });

  it('discards OCR noise and own messages', () => {
    expect(parseTangoChatLine('ao vivo').discarded).toBe(true);
    const own = parseTangoChatLine('Odessa: obrigada!', { ownNames: ['odessa', 'juju'] });
    expect(own.discarded).toBe(true);
    if (own.discarded) expect(own.reason).toBe('own_message');
  });
});
