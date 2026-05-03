import { classifyEvent } from './eventClassifier';
import type { LiveEvent } from '../types';

const STORAGE_KEY = 'odessa:event-bus:v1';
const MAX_EVENTS = 200;

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function safeParseEvents(raw: string | null): LiveEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(events: LiveEvent[]) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // Ignore storage failures in local runtime.
  }
}

export function getRecentEvents(limit = MAX_EVENTS): LiveEvent[] {
  if (!canUseStorage()) return [];
  const events = safeParseEvents(window.localStorage.getItem(STORAGE_KEY));
  return events.slice(-limit);
}

export function replaceEvents(events: LiveEvent[]): LiveEvent[] {
  const deduped = new Map<string, LiveEvent>();
  for (const event of events) deduped.set(event.id, classifyEvent(event));
  const next = Array.from(deduped.values()).slice(-MAX_EVENTS);
  save(next);
  return next;
}

export function emitEvent(event: LiveEvent): LiveEvent {
  const classified = classifyEvent(event);
  const events = getRecentEvents();
  const next = [...events.filter((item) => item.id !== classified.id), classified].slice(
    -MAX_EVENTS,
  );
  save(next);
  return classified;
}

export function clearEvents(): void {
  save([]);
}

export function markEventProcessed(
  eventId: string,
  processedAt = new Date().toISOString(),
): LiveEvent[] {
  const next = getRecentEvents().map((event) =>
    event.id === eventId ? { ...event, processedAt } : event,
  );
  save(next);
  return next;
}
