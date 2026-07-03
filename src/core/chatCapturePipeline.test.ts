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
      now: new Date('2026-07-03T12:00:00Z'),
      dedupe: new ChatDedupeCache(),
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[0].source).toBe('ocr');
    expect(result.events[0].kind).toBe('chat');
    expect(result.events[0].metadata?.platform).toBe('tango');
    expect(result.events[0].metadata?.rowHash).toBeTruthy();
    expect(result.events[1].kind).toBe('gift');
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
});
