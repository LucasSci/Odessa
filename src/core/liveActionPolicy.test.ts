import { describe, expect, it } from 'vitest';
import type { AutopilotAction, LiveEvent, PersonaDecision } from '../types';
import {
  applyLiveActionPolicy,
  classifyEventPriorityLane,
  selectDirectorEventBatch,
} from './liveActionPolicy';

const now = Date.parse('2026-07-09T12:00:00.000Z');

function event(patch: Partial<LiveEvent>): LiveEvent {
  return {
    id: patch.id || 'event-1',
    source: patch.source || 'ocr',
    zoneName: patch.zoneName || 'Chat Tango',
    text: patch.text || 'Oi',
    kind: patch.kind || 'chat',
    createdAt: patch.createdAt || '2026-07-09T11:59:58.000Z',
    time: patch.time || '11:59:58',
    metadata: patch.metadata,
  };
}

function action(patch: Partial<AutopilotAction>): AutopilotAction {
  return {
    id: patch.id || 'action-1',
    type: patch.type || 'chat_reply',
    label: patch.label || 'Resposta no chat',
    capability: patch.capability || 'chat.reply',
    payload: patch.payload || { message: 'oi' },
    simulated: patch.simulated ?? true,
    status: patch.status || 'queued',
    createdAt: patch.createdAt || '2026-07-09T11:59:59.000Z',
    ...patch,
  };
}

function decision(patch: Partial<PersonaDecision> = {}): PersonaDecision {
  return {
    speech: 'ok',
    intent: 'test',
    confidence: 0.9,
    reason: 'teste',
    priority: 'normal',
    actions: [],
    ...patch,
  };
}

describe('liveActionPolicy', () => {
  it('orders moderation, gifts and alerts ahead of casual chat', () => {
    const result = selectDirectorEventBatch(
      [
        event({ id: 'casual', kind: 'chat', text: 'Bia: oi' }),
        event({ id: 'gift', kind: 'gift', text: 'Nanda enviou Rosa' }),
        event({ id: 'alert', kind: 'alert', text: 'Rafa entrou' }),
        event({ id: 'mod', kind: 'moderation', text: 'spam' }),
      ],
      { now, maxEvents: 8 },
    );

    expect(result.batch.map((item) => item.id)).toEqual(['mod', 'gift', 'alert', 'casual']);
  });

  it('classifies direct questions above casual chat', () => {
    expect(classifyEventPriorityLane(event({ text: 'Juju, qual jogo agora?' }))).toBe(
      'direct_question',
    );
    expect(classifyEventPriorityLane(event({ text: 'boa live' }))).toBe('casual_chat');
  });

  it('discards old and duplicate events before the Director round', () => {
    const result = selectDirectorEventBatch(
      [
        event({ id: 'old', text: 'muito antigo', createdAt: '2026-07-09T11:55:00.000Z' }),
        event({ id: 'one', text: 'Ana: oi', metadata: { user: 'Ana', message: 'oi' } }),
        event({ id: 'dupe', text: 'Ana: oi', metadata: { user: 'Ana', message: 'oi' } }),
      ],
      { now, maxEvents: 8 },
    );

    expect(result.batch.map((item) => item.id)).toEqual(['one']);
    expect(result.discarded.map((item) => item.event.id)).toEqual(['old', 'dupe']);
    expect(result.discarded[1].reason).toContain('duplicado');
  });

  it('blocks chat_reply when an urgent video or OBS action is planned', () => {
    const primary = event({ kind: 'gift', text: 'Nanda enviou Rosa' });
    const result = applyLiveActionPolicy(
      [
        action({ id: 'chat', type: 'chat_reply', capability: 'chat.reply' }),
        action({
          id: 'video',
          type: 'play_video',
          capability: 'media.play_video',
          payload: { videoId: 'gift-rosa' },
        }),
      ],
      {
        events: [primary],
        primaryEvent: primary,
        decision: decision({ priority: 'high' }),
        now,
        video: { currentVideoId: 'idle', idleVideoId: 'idle' },
      },
    );

    expect(result.executableActions.map((item) => item.id)).toEqual(['video']);
    expect(result.heldActions[0].status).toBe('blocked');
    expect(result.heldActions[0].payload.governorBlockedReason).toContain('chat_reply bloqueado');
  });

  it('waits for idle before replacing a non-urgent video', () => {
    const primary = event({ kind: 'chat', text: 'Bia: mostra outro video' });
    const result = applyLiveActionPolicy(
      [
        action({
          id: 'video',
          type: 'play_video',
          capability: 'media.play_video',
          payload: { videoId: 'casual-video' },
        }),
      ],
      {
        events: [primary],
        primaryEvent: primary,
        decision: decision(),
        now,
        video: { currentVideoId: 'gift-rosa', idleVideoId: 'idle' },
      },
    );

    expect(result.executableActions).toEqual([]);
    expect(result.heldActions[0].result).toContain('ponto seguro');
    expect(result.heldActions[0].payload.interruptPolicy).toBe('wait_safe_point');
  });
});
