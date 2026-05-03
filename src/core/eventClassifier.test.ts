import { describe, it, expect } from 'vitest';
import { classifyEvent } from './eventClassifier';
import type { LiveEvent } from '../types';

describe('eventClassifier', () => {
  it('should classify a simple chat message', () => {
    const event: LiveEvent = {
      id: '1',
      source: 'ocr',
      zoneName: 'Chat',
      text: 'Olá Juju!',
      kind: 'chat',
      time: '12:00:00',
    };
    const classified = classifyEvent(event);
    expect(classified.kind).toBe('chat');
    expect(classified.text).toBe('Olá Juju!');
  });

  it('should extract user from at-mention', () => {
    const event: LiveEvent = {
      id: '2',
      source: 'ocr',
      zoneName: 'Chat',
      text: '@lucas: Oi Juju',
      kind: 'chat',
      time: '12:00:01',
    };
    const classified = classifyEvent(event);
    expect(classified.metadata?.user).toBe('lucas');
  });

  it('should classify a gift and extract gift name', () => {
    const event: LiveEvent = {
      id: '3',
      source: 'ocr',
      zoneName: 'Gifts',
      text: 'Lucas enviou Rosa x10',
      kind: 'chat',
      time: '12:00:02',
    };
    const classified = classifyEvent(event);
    expect(classified.kind).toBe('gift');
    expect(classified.metadata?.giftName).toBe('Rosa');
    expect(classified.metadata?.quantity).toBe(10);
    expect(classified.metadata?.user).toBe('Lucas');
  });

  it('should detect a scene change request in a gift', () => {
    const event: LiveEvent = {
      id: '4',
      source: 'ocr',
      zoneName: 'Gifts',
      text: 'Lucas resgatou: trocar cena Gameplay Focus',
      kind: 'chat',
      time: '12:00:03',
    };
    const classified = classifyEvent(event);
    expect(classified.kind).toBe('gift');
    expect(classified.metadata?.mappedAction).toBe('obs.switch_scene');
    expect(classified.metadata?.requestedScene).toBe('Gameplay Focus');
    expect(classified.metadata?.redeemable).toBe(true);
  });

  it('should detect a music request', () => {
    const event: LiveEvent = {
      id: '5',
      source: 'ocr',
      zoneName: 'Chat',
      text: 'tocar: Sweet Child O Mine',
      kind: 'chat',
      time: '12:00:04',
    };
    const classified = classifyEvent(event);
    expect(classified.metadata?.mappedAction).toBe('media.play_music');
    expect(classified.metadata?.requestedTrack).toBe('Sweet Child O Mine');
  });

  it('should classify moderation keywords', () => {
    const event: LiveEvent = {
      id: '6',
      source: 'ocr',
      zoneName: 'Chat',
      text: 'Para de fazer spam!',
      kind: 'chat',
      time: '12:00:05',
    };
    const classified = classifyEvent(event);
    expect(classified.kind).toBe('moderation');
  });

  it('should clean prefix from OCR text', () => {
    const event: LiveEvent = {
      id: '7',
      source: 'ocr',
      zoneName: 'Chat',
      text: 'OCR: @lucas: Mensagem limpa',
      kind: 'chat',
      time: '12:00:06',
    };
    const classified = classifyEvent(event);
    expect(classified.text).toBe('@lucas: Mensagem limpa');
  });
});
