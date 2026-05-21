/**
 * giftCatalog.ts
 * --------------
 * The user-managed catalog of live-stream gifts. Each entry describes a
 * present with its image, friendly name, price (in coins) and the normalized
 * code (`key`) used to match incoming gift events.
 *
 * Persisted in localStorage (per-device), consistent with workflow/OBS
 * profiles — the cloud backend's serverless routing is unreliable for new
 * endpoints, so client-side storage keeps this feature dependable.
 */

import { KNOWN_GIFTS } from './knownGifts';

export type GiftCatalogEntry = {
  id: string;
  key: string; // normalized gift code stored on triggers (conditions.giftKey)
  name: string; // friendly display name
  imageUrl?: string; // data URL (uploaded) or remote URL
  emoji?: string; // decorative fallback when there is no image
  price?: number; // price in coins
  updatedAt?: string;
};

const STORAGE_KEY = 'odessa:gift-catalog:v1';

function makeId() {
  return `gift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Seed the catalog the first time, from the curated common-gifts list. */
function seedCatalog(): GiftCatalogEntry[] {
  return KNOWN_GIFTS.map((gift) => ({
    id: makeId(),
    key: gift.key,
    name: gift.label,
    emoji: gift.emoji,
    price: undefined,
    updatedAt: new Date().toISOString(),
  }));
}

export function loadGiftCatalog(): GiftCatalogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      // First run — seed and persist so the user has a starting point.
      const seeded = seedCatalog();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveGiftCatalog(entries: GiftCatalogEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* localStorage full or unavailable — ignore */
  }
}

export function upsertGift(
  entries: GiftCatalogEntry[],
  entry: Omit<GiftCatalogEntry, 'id' | 'updatedAt'> & { id?: string },
): GiftCatalogEntry[] {
  const now = new Date().toISOString();
  if (entry.id) {
    const idx = entries.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      const next = entries.slice();
      next[idx] = { ...next[idx], ...entry, id: next[idx].id, updatedAt: now };
      return next;
    }
  }
  return [...entries, { ...entry, id: makeId(), updatedAt: now }];
}

export function removeGift(entries: GiftCatalogEntry[], id: string): GiftCatalogEntry[] {
  return entries.filter((e) => e.id !== id);
}

/** Find a catalog entry by its normalized key. */
export function findGiftByKey(entries: GiftCatalogEntry[], key: string | undefined | null) {
  if (!key) return undefined;
  return entries.find((e) => e.key === key);
}

/**
 * Match a raw gift name coming from OCR/text to a catalog entry.
 * Comparison is loose: case-insensitive, accent- and separator-insensitive.
 */
export function matchGiftByName(entries: GiftCatalogEntry[], rawName: string | undefined | null) {
  if (!rawName) return undefined;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const target = norm(rawName);
  if (!target) return undefined;
  return entries.find((entry) => {
    if (norm(entry.name) === target) return true;
    const keyName = entry.key.replace(/^gift\./, '');
    return norm(keyName) === target;
  });
}
