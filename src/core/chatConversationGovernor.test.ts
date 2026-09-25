import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyIncomingMessage,
  describeReplyBlock,
  recordChatReplySent,
  recordIncomingMessage,
  resetChatConversationGovernor,
  shouldReplyToMessage,
} from './chatConversationGovernor';

const OPTS = { cooldownMs: 15_000, maxPerMinute: 4 };
const msg = (username: string, text: string) => ({ username, text, timestamp: new Date().toISOString() });

describe('chatConversationGovernor (respostas pela bridge)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
    resetChatConversationGovernor();
  });
  afterEach(() => vi.useRealTimers());

  it('responde uma mensagem comum e classifica como conversa', () => {
    expect(shouldReplyToMessage(msg('ana', 'oi Odessa, tudo bem?'), OPTS)).toEqual({ allowed: true, kind: 'chat' });
  });

  it('não responde a mesma mensagem duplicada do mesmo usuário', () => {
    expect(shouldReplyToMessage(msg('ana', 'oi Odessa!'), OPTS).allowed).toBe(true);
    const again = shouldReplyToMessage(msg('ana', 'Oi odessa'), OPTS);
    expect(again).toMatchObject({ allowed: false, reason: 'duplicate_message' });
  });

  it('emoji puro não conta como duplicada', () => {
    expect(shouldReplyToMessage(msg('ana', '❤️❤️'), OPTS).reason).not.toBe('duplicate_message');
    expect(shouldReplyToMessage(msg('ana', '❤️❤️'), OPTS).reason).not.toBe('duplicate_message');
  });

  it.each([
    'segue meu insta https://x.com/perfil',
    'chama no whatsapp',
    'manda um pix agora pra mim',
    'você é uma idiota',
    'manda presente agora pra eu bater a meta',
  ])('moderação nunca recebe resposta pública: "%s"', (text) => {
    expect(shouldReplyToMessage(msg('troll', text), OPTS)).toMatchObject({
      allowed: false,
      reason: 'moderation_risk',
      kind: 'moderation',
    });
  });

  it('presente passa na frente da conversa casual durante o cooldown', () => {
    recordChatReplySent('outra');
    const casual = shouldReplyToMessage(msg('ana', 'que live boa'), OPTS);
    expect(casual.reason).toMatch(/^global_cooldown_/);
    const gift = shouldReplyToMessage(msg('bia', 'enviou Rosa x3'), OPTS);
    expect(gift).toEqual({ allowed: true, kind: 'gift' });
  });

  it('limite por minuto vale até para presentes', () => {
    for (let i = 0; i < 4; i += 1) recordChatReplySent(`u${i}`);
    expect(shouldReplyToMessage(msg('bia', 'enviou Rosa x1'), OPTS)).toMatchObject({ allowed: false, reason: 'max_per_minute' });
  });

  it('cooldown por usuário e anti-flood continuam valendo', () => {
    recordChatReplySent('ana');
    vi.advanceTimersByTime(16_000);
    expect(shouldReplyToMessage(msg('ana', 'e aí, qual a boa?'), OPTS).reason).toMatch(/^user_cooldown_/);
    for (let i = 0; i < 3; i += 1) recordIncomingMessage('kkkkkk');
    expect(shouldReplyToMessage(msg('carla', 'kkkkkk'), OPTS).reason).toBe('repeated_message');
  });

  it('classifica presente, moderação e conversa', () => {
    expect(classifyIncomingMessage({ username: 'bia', text: 'enviou Diamante' })).toBe('gift');
    expect(classifyIncomingMessage({ username: 'x', text: 'golpe do pix' })).toBe('moderation');
    expect(classifyIncomingMessage({ username: 'ana', text: 'bom dia!' })).toBe('chat');
  });

  it('explica cada motivo em linguagem do operador', () => {
    expect(describeReplyBlock('moderation_risk')).toMatch(/moderação/);
    expect(describeReplyBlock('duplicate_message')).toMatch(/duplicada/);
    expect(describeReplyBlock('bridge_not_ready')).toMatch(/bridge/);
    expect(describeReplyBlock('user_cooldown_12s')).toBe('cooldown do usuário (12s restantes)');
  });
});
