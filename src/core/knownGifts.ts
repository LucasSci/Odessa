/**
 * knownGifts.ts
 * -------------
 * Curated list of common live-stream gifts (TikTok-style, PT-BR names).
 * Used to offer a quick picker instead of a free-text field when mapping
 * a gift to a video. The user can always fall back to a custom code.
 *
 * `key` is the normalized gift code stored on the trigger (conditions.giftKey).
 * `label` is the friendly name shown in the UI.
 * `emoji` is purely decorative.
 */

export type KnownGift = {
  key: string;
  label: string;
  emoji: string;
};

export const KNOWN_GIFTS: KnownGift[] = [
  { key: 'gift.rosa', label: 'Rosa', emoji: '🌹' },
  { key: 'gift.tiktok', label: 'TikTok', emoji: '🎵' },
  { key: 'gift.coracao', label: 'Coração', emoji: '❤️' },
  { key: 'gift.eu_te_amo', label: 'Eu te amo', emoji: '💕' },
  { key: 'gift.maozinha_coracao', label: 'Mãozinha de coração', emoji: '🫰' },
  { key: 'gift.gg', label: 'GG', emoji: '🎮' },
  { key: 'gift.sorvete', label: 'Sorvete', emoji: '🍦' },
  { key: 'gift.rosquinha', label: 'Rosquinha', emoji: '🍩' },
  { key: 'gift.perfume', label: 'Perfume', emoji: '🧴' },
  { key: 'gift.pirulito', label: 'Pirulito', emoji: '🍭' },
  { key: 'gift.beijo', label: 'Beijo', emoji: '💋' },
  { key: 'gift.estrela', label: 'Estrela', emoji: '⭐' },
  { key: 'gift.urso', label: 'Ursinho', emoji: '🧸' },
  { key: 'gift.coroa', label: 'Coroa', emoji: '👑' },
  { key: 'gift.foguete', label: 'Foguete', emoji: '🚀' },
  { key: 'gift.leao', label: 'Leão', emoji: '🦁' },
  { key: 'gift.universo', label: 'Universo', emoji: '🌌' },
];

/** Wildcard option — fires for any gift. */
export const ANY_GIFT_KEY = '*';

/** Returns the friendly label for a stored giftKey, or the raw key if unknown. */
export function giftLabel(key: string | undefined | null): string {
  if (!key) return '';
  if (key === ANY_GIFT_KEY) return 'Qualquer presente';
  const known = KNOWN_GIFTS.find((g) => g.key === key);
  return known ? `${known.emoji} ${known.label}` : key;
}

/** True when the giftKey is not in the curated list (i.e. a custom code). */
export function isCustomGift(key: string | undefined | null): boolean {
  if (!key || key === ANY_GIFT_KEY) return false;
  return !KNOWN_GIFTS.some((g) => g.key === key);
}
