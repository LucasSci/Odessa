import { describe, expect, it } from 'vitest';
import { ChatDedupeCache } from './chatDedupe';
import { processChatCapture } from './chatCapturePipeline';

describe('chatCapturePipeline', () => {
  it('emits structured LiveEvents for fresh Tango lines', () => {
    const result = processChatCapture({
      lines: ['Lucas: Oi Juju?', 'Ana enviou Rosa x2'],
      zoneName: 'Chat Tango',
      confidence: 0.91,
      captureMode: 'obs',
      backendIngested: true,
      now: new Date('2026-07-03T12:00:00Z'),
      dedupe: new ChatDedupeCache(),
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[0].source).toBe('ocr');
    expect(result.events[0].kind).toBe('chat');
    expect(result.events[0].text).toBe('Lucas: Oi Juju?');
    expect(result.events[0].zoneName).toBe('Chat Tango');
    expect(result.events[0].metadata?.platform).toBe('tango');
    expect(result.events[0].metadata?.user).toBe('Lucas');
    expect(result.events[0].metadata?.message).toBe('Oi Juju?');
    expect(result.events[0].metadata?.confidence).toBe(0.91);
    expect(result.events[0].metadata?.backendIngested).toBe(true);
    expect(result.events[0].metadata?.rowHash).toBeTruthy();
    expect(result.events[0].metadata?.dedupeHash).toBeTruthy();
    expect(result.events[1].kind).toBe('gift');
    expect(result.events[1].metadata?.giftName).toBe('Rosa');
  });

  it('reports discarded duplicate and noise lines', () => {
    const dedupe = new ChatDedupeCache();
    const first = processChatCapture({
      lines: ['Lucas: Oi Juju'],
      confidence: 0.9,
      dedupe,
    });
    const second = processChatCapture({
      lines: ['Lucas: Oi Juju', 'ao vivo'],
      confidence: 0.9,
      dedupe,
    });

    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(0);
    expect(second.discarded.map((item) => item.reason)).toContain('seen_recently');
    expect(second.discarded.map((item) => item.reason)).toContain('ocr_ui_noise');
  });

  it('dedupes repeated OCR reads by normalized user and message within the time window', () => {
    const dedupe = new ChatDedupeCache(30_000);
    const first = processChatCapture({
      lines: ['@Maria_Luz: boa noite Juju!!!'],
      confidence: 0.88,
      now: new Date('2026-07-03T12:00:00Z'),
      dedupe,
    });
    const duplicate = processChatCapture({
      lines: ['Maria_Luz: boa noite juju'],
      confidence: 0.9,
      now: new Date('2026-07-03T12:00:05Z'),
      dedupe,
    });
    const later = processChatCapture({
      lines: ['Maria_Luz: boa noite juju'],
      confidence: 0.9,
      now: new Date('2026-07-03T12:00:35Z'),
      dedupe,
    });

    expect(first.events).toHaveLength(1);
    expect(duplicate.events).toHaveLength(0);
    expect(duplicate.discarded[0]?.reason).toBe('seen_recently');
    expect(later.events).toHaveLength(1);
  });

  it('separates simulated Tango chat, gift, alert, and moderation lines', () => {
    const result = processChatCapture({
      lines: [
        'Bia: amei a live',
        'Nanda enviou Castelo x1',
        'Rafa entrou',
        'Bot: compre seguidores em www.spam.test',
      ],
      zoneName: 'Chat Tango',
      confidence: 0.93,
      dedupe: new ChatDedupeCache(),
    });

    expect(result.events.map((event) => event.kind)).toEqual([
      'chat',
      'gift',
      'alert',
      'moderation',
    ]);
  });
});
