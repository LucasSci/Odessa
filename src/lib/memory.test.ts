import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRoundUserMemorySummary,
  clearUserProfiles,
  loadUserProfiles,
  trackLiveEventInteraction,
} from './memory';
import type { LiveEvent } from '../types';

function event(patch: Partial<LiveEvent>): LiveEvent {
  return {
    id: patch.id || 'event-1',
    source: patch.source || 'ocr',
    zoneName: patch.zoneName || 'Chat Tango',
    text: patch.text || 'Ana: toca pop',
    kind: patch.kind || 'chat',
    createdAt: patch.createdAt || '2026-07-09T12:00:00.000Z',
    time: patch.time || '12:00:00',
    metadata: patch.metadata,
  };
}

describe('user memory', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('crypto', { randomUUID: () => `id-${Math.random()}` });
  });

  it('tracks safe per-user chat patterns without raw sensitive data', () => {
    let profiles = loadUserProfiles();
    profiles = trackLiveEventInteraction(
      profiles,
      event({
        text: 'Ana: toca pop hoje? meu email ana@example.com',
        metadata: { user: 'Ana', message: 'toca pop hoje? meu email ana@example.com' },
      }),
    );
    profiles = trackLiveEventInteraction(
      profiles,
      event({
        text: 'Ana: boa live linda',
        metadata: { user: 'Ana', message: 'boa live linda' },
      }),
    );

    const ana = profiles.ana;
    expect(ana.messageCount).toBe(2);
    expect(ana.lastMessage).not.toContain('ana@example.com');
    expect(ana.preferredTone).toBe('warm');
    expect(Object.keys(ana.recurringTopics || {})).toContain('toca');

    const summary = buildRoundUserMemorySummary(
      [event({ metadata: { user: 'Ana', message: 'oi' } })],
      profiles,
    );
    expect(summary[0]).toContain('recorrente');
    expect(summary[0]).toContain('tom warm');
  });

  it('marks gift senders as gift givers in round memory', () => {
    const profiles = trackLiveEventInteraction(
      loadUserProfiles(),
      event({
        kind: 'gift',
        text: 'Bia enviou Rosa',
        metadata: { user: 'Bia', giftName: 'Rosa', quantity: 1 },
      }),
    );

    const summary = buildRoundUserMemorySummary(
      [event({ kind: 'gift', metadata: { user: 'Bia', giftName: 'Rosa' } })],
      profiles,
    );

    expect(profiles.bia.giftCount).toBe(1);
    expect(summary[0]).toContain('presenteador');
  });

  it('can clear learned user profiles', () => {
    trackLiveEventInteraction(loadUserProfiles(), event({ metadata: { user: 'Ana', message: 'oi' } }));
    expect(Object.keys(loadUserProfiles())).toHaveLength(1);
    clearUserProfiles();
    expect(Object.keys(loadUserProfiles())).toHaveLength(0);
  });
});
