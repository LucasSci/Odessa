import { describe, expect, it } from 'vitest';
import type { LiveEvent } from '../types';
import { normalizeDirectorEvent, parseVideoState, partitionDirectorEvents } from './useAutopilotRuntime';

function event(patch: Partial<LiveEvent>): LiveEvent {
  return {
    id: patch.id || 'event-1',
    source: patch.source || 'ocr',
    zoneName: patch.zoneName || 'Chat Tango',
    text: patch.text || '',
    kind: patch.kind || 'chat',
    createdAt: patch.createdAt || '2026-07-03T12:00:00.000Z',
    time: patch.time || '12:00:00',
    metadata: patch.metadata,
  };
}

describe('useAutopilotRuntime event preparation', () => {
  it('normalizes OCR chat events before the Director round', () => {
    const normalized = normalizeDirectorEvent(event({
      text: 'Lucas: Oi Juju?',
      metadata: { confidence: 0.92 },
    }));

    expect(normalized.source).toBe('ocr');
    expect(normalized.kind).toBe('chat');
    expect(normalized.zoneName).toBe('Chat Tango');
    expect(normalized.text).toBe('Lucas: Oi Juju?');
    expect(normalized.metadata?.user).toBe('');
    expect(normalized.metadata?.message).toBe('Oi Juju?');
    expect(normalized.metadata?.confidence).toBe(0.92);
    expect(normalized.metadata?.platform).toBe('tango');
  });

  it('keeps gifts prioritized as gift while separating event classes', () => {
    const batch = partitionDirectorEvents([
      event({ id: 'chat', kind: 'chat', text: 'Bia: oi' }),
      event({ id: 'gift', kind: 'gift', text: 'Nanda: enviou Rosa' }),
      event({ id: 'alert', kind: 'alert', text: 'Rafa: entrou' }),
      event({ id: 'moderation', kind: 'moderation', text: 'Bot: spam' }),
    ]);

    expect(batch.map((item) => item.id)).toEqual(['moderation', 'gift', 'alert', 'chat']);
    expect(batch[1].kind).toBe('gift');
  });
});

describe('parseVideoState', () => {
  it('lê o formato real do backend (snake_case e state IDLE)', () => {
    const parsed = parseVideoState({
      current_video_id: '01_FLUXO_idle',
      state: 'IDLE',
      queue_len: 2,
      start_ts: 1790359473.69,
    });
    expect(parsed).toEqual({
      currentVideoId: '01_FLUXO_idle',
      idleVideoId: '01_FLUXO_idle',
      queueSize: 2,
      updatedAt: new Date(1790359473.69 * 1000).toISOString(),
    });
  });

  it('reação tocando não é confundida com idle', () => {
    const parsed = parseVideoState({ current_video_id: 'gift-rosa', state: 'ACTION', queue_len: 0, start_ts: 1 });
    expect(parsed.idleVideoId).toBeNull();
    expect(parsed.currentVideoId).toBe('gift-rosa');
  });
});
