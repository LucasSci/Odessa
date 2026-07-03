import { describe, expect, it } from 'vitest';
import { ChatDedupeCache } from './chatDedupe';

const base = {
  kind: 'chat',
  user: 'Lucas',
  message: 'Oi Juju!',
  rawText: 'Lucas: Oi Juju!',
  rowHash: 'row-a',
  confidence: 0.9,
};

describe('ChatDedupeCache', () => {
  it('dedupes normalized messages inside TTL', () => {
    const cache = new ChatDedupeCache(30_000);
    expect(cache.check(base, { now: 1_000 }).duplicate).toBe(false);
    expect(cache.check({ ...base, rowHash: 'row-b', message: 'oi juju' }, { now: 2_000 }).duplicate).toBe(true);
  });

  it('allows the same message outside TTL', () => {
    const cache = new ChatDedupeCache(30_000);
    expect(cache.check(base, { now: 1_000 }).duplicate).toBe(false);
    expect(cache.check({ ...base, rowHash: 'row-b' }, { now: 40_000 }).duplicate).toBe(false);
  });

  it('blocks low confidence and empty messages', () => {
    const cache = new ChatDedupeCache();
    expect(cache.check({ ...base, confidence: 0.2 }).reason).toBe('low_confidence');
    expect(cache.check({ ...base, message: '', rawText: '', rowHash: 'row-c' }).reason).toBe('empty_message');
  });
});
