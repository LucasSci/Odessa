import { describe, it, expect } from 'vitest';
import { classifyEvent, classifyEventDeterministic } from './eventClassifier';
import type { LiveEvent } from '../types';

function makeEvent(text: string, kind: LiveEvent['kind'] = 'chat'): LiveEvent {
  return {
    id: String(Math.random()),
    source: 'test',
    zoneName: 'Chat',
    text,
    kind,
    time: new Date().toLocaleTimeString(),
    createdAt: new Date().toISOString(),
  };
}

/**
 * LEGADO — antigo classificador de eventos.
 * Substituído por src/core/ocrPipeline.ts.
 */
describe.skip('eventClassifier — deterministic rules [LEGADO]', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // CHAT — @user: message (MUST NOT be classified as gift)
  // ──────────────────────────────────────────────────────────────────────────

  it('@user: message is always chat, never gift', () => {
    const ev = classifyEventDeterministic(
      makeEvent('@AnaStarlight: Boa! Mandou muito bem nessa partida'),
    );
    expect(ev.kind).toBe('chat');
    expect(ev.metadata?.user).toBe('AnaStarlight');
    expect(ev.metadata?.message).toBe('Boa! Mandou muito bem nessa partida');
  });

  it('@BrunoTech: comment with gift-like verbs is still chat', () => {
    const ev = classifyEventDeterministic(makeEvent('@BrunoTech: Mandou muito bem hoje!'));
    expect(ev.kind).toBe('chat');
    expect(ev.metadata?.user).toBe('BrunoTech');
  });

  it('@user: format extracts user correctly', () => {
    const ev = classifyEvent(makeEvent('@lucas: Oi Juju'));
    expect(ev.kind).toBe('chat');
    expect(ev.metadata?.user).toBe('lucas');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GIFT — "User enviou GiftName"
  // ──────────────────────────────────────────────────────────────────────────

  it('classifies "Lucas enviou Rosa" as gift', () => {
    const ev = classifyEventDeterministic(makeEvent('Lucas enviou Rosa'));
    expect(ev.kind).toBe('gift');
    expect(ev.metadata?.user).toBe('Lucas');
    expect(ev.metadata?.giftName).toBe('Rosa');
    expect(ev.metadata?.quantity).toBe(1);
    expect(ev.metadata?.redeemable).toBe(false);
  });

  it('classifies "Ana enviou Rosa x5" as gift with quantity', () => {
    const ev = classifyEventDeterministic(makeEvent('Ana enviou Rosa x5'));
    expect(ev.kind).toBe('gift');
    expect(ev.metadata?.giftName).toBe('Rosa');
    expect(ev.metadata?.quantity).toBe(5);
  });

  it('classifies "BrunoTech enviou Coroa x1" as gift', () => {
    const ev = classifyEventDeterministic(makeEvent('BrunoTech enviou Coroa x1'));
    expect(ev.kind).toBe('gift');
    expect(ev.metadata?.giftName).toBe('Coroa');
    expect(ev.metadata?.quantity).toBe(1);
  });

  it('classifies "Lucas mandou Rosa" as gift', () => {
    const ev = classifyEventDeterministic(makeEvent('Lucas mandou Rosa'));
    expect(ev.kind).toBe('gift');
    expect(ev.metadata?.giftName).toBe('Rosa');
  });

  it('classifies "Lucas enviou Rosa x10" from legacy test', () => {
    const ev = classifyEvent(makeEvent('Lucas enviou Rosa x10', 'chat'));
    expect(ev.kind).toBe('gift');
    expect(ev.metadata?.giftName).toBe('Rosa');
    expect(ev.metadata?.quantity).toBe(10);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REDEEM
  // ──────────────────────────────────────────────────────────────────────────

  it('classifies "CamilaBR resgatou Trocar Cena: Gameplay Focus" as gift+redeem', () => {
    const ev = classifyEventDeterministic(
      makeEvent('CamilaBR resgatou Trocar Cena: Gameplay Focus'),
    );
    expect(ev.kind).toBe('gift');
    expect(ev.metadata?.redeemable).toBe(true);
    expect(ev.metadata?.mappedAction).toBe('obs.switch_scene');
    expect(ev.metadata?.requestedScene).toBe('Gameplay Focus');
  });

  it('detects legacy redeem format', () => {
    const ev = classifyEvent(makeEvent('Lucas resgatou: trocar cena Gameplay Focus', 'chat'));
    expect(ev.kind).toBe('gift');
    expect(ev.metadata?.mappedAction).toBe('obs.switch_scene');
  });

  it('detects music redeem', () => {
    const ev = classifyEventDeterministic(
      makeEvent('MariLive resgatou Escolher musica: synthwave neon'),
    );
    expect(ev.kind).toBe('gift');
    expect(ev.metadata?.redeemable).toBe(true);
    expect(ev.metadata?.mappedAction).toBe('media.play_music');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // MODERATION
  // ──────────────────────────────────────────────────────────────────────────

  it('classifies spam as moderation', () => {
    const ev = classifyEventDeterministic(
      makeEvent('xXSpamXx: COMPRE SEGUIDORES BARATO www.fake.com spam repetido'),
    );
    expect(ev.kind).toBe('moderation');
  });

  it('classifies "Para de fazer spam!" as moderation (legacy)', () => {
    const ev = classifyEvent(makeEvent('Para de fazer spam!'));
    expect(ev.kind).toBe('moderation');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ALERT
  // ──────────────────────────────────────────────────────────────────────────

  it('classifies new follower alert', () => {
    const ev = classifyEventDeterministic(makeEvent('GuiNinja começou a seguir'));
    expect(ev.kind).toBe('alert');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SYSTEM
  // ──────────────────────────────────────────────────────────────────────────

  it('classifies quiet live event as system', () => {
    const ev = classifyEventDeterministic(makeEvent('A live está quieta...'));
    expect(ev.kind).toBe('system');
    expect(ev.metadata?.mappedAction).toBe('topic.suggest');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // MISC
  // ──────────────────────────────────────────────────────────────────────────

  it('cleans OCR prefix from text', () => {
    const ev = classifyEvent(makeEvent('OCR: @lucas: Mensagem limpa'));
    expect(ev.text).toBe('@lucas: Mensagem limpa');
    expect(ev.kind).toBe('chat');
  });

  it('detects music request from legacy text', () => {
    const ev = classifyEvent(makeEvent('tocar: Sweet Child O Mine'));
    expect(ev.metadata?.mappedAction).toBe('media.play_music');
    expect(ev.metadata?.requestedTrack).toBe('Sweet Child O Mine');
  });
});
