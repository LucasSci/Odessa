/**
 * giftLearning.ts — aprendizado de presentes (Fase 2).
 *
 * A cada rodada da Diretora, registra os presentes recebidos:
 *   - frequência (nº de eventos) e quantidade total,
 *   - qual vídeo reagiu ao presente (aprende a associação presente → reação),
 *   - presentes NÃO catalogados são auto-cadastrados no giftCatalog (aprende
 *     presentes novos), reusando matchGiftByName/upsertGift.
 *
 * Persiste em localStorage. Consumidores:
 *   1. buildGiftInsightsContext() → resumo no prompt da Diretora.
 *   2. AiConfigPanel (aba IA → "Aprendizado") → lista de presentes aprendidos.
 */

import type { LiveEvent, PersonaDecision } from '../types';
import {
  loadGiftCatalog,
  saveGiftCatalog,
  upsertGift,
  matchGiftByName,
} from './giftCatalog';

const STORAGE_KEY = 'odessa:gift-learning:v1';

export interface GiftStat {
  key: string;
  name: string;
  count: number; // nº de eventos de presente
  totalQty: number;
  lastSeen: string;
  learned: boolean; // auto-cadastrado (não estava no catálogo)
  reactionVideoId?: string;
  reactionVideoLabel?: string;
}

export interface GiftLearningState {
  gifts: Record<string, GiftStat>;
  updatedAt: string;
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function empty(): GiftLearningState {
  return { gifts: {}, updatedAt: new Date().toISOString() };
}

function load(): GiftLearningState {
  if (!canUseStorage()) return empty();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<GiftLearningState>;
    return { gifts: parsed.gifts ?? {}, updatedAt: parsed.updatedAt ?? new Date().toISOString() };
  } catch {
    return empty();
  }
}

function save(state: GiftLearningState): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function normalizeKey(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `gift.${slug || 'desconhecido'}`;
}

/** Nome plausível de presente? (evita cadastrar ruído de OCR) */
function isPlausibleGiftName(name: string): boolean {
  const n = name.trim();
  if (n.length < 2 || n.length > 40) return false;
  if (/^\d+$/.test(n)) return false; // só números
  return /[a-zá-úà-ùâ-û]/i.test(n); // tem ao menos uma letra
}

function playVideoFromDecision(decision?: PersonaDecision): { id?: string; label?: string } {
  if (!decision?.actions) return {};
  const play = decision.actions.find((a) => a.type === 'play_video');
  if (!play) return {};
  const payload = (play.payload || {}) as Record<string, unknown>;
  return {
    id: typeof payload.videoId === 'string' ? payload.videoId : undefined,
    label: typeof payload.label === 'string' ? payload.label : undefined,
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

/**
 * Registra os presentes de uma rodada. Auto-cadastra presentes desconhecidos no
 * catálogo e aprende qual vídeo reagiu (a partir da decisão da Diretora).
 */
export function recordGiftLearning(events: LiveEvent[], decision?: PersonaDecision): void {
  const gifts = events.filter((e) => e.kind === 'gift');
  if (!gifts.length) return;

  const state = load();
  let catalog = loadGiftCatalog();
  let catalogChanged = false;
  const reaction = playVideoFromDecision(decision);

  for (const ev of gifts) {
    const meta = (ev.metadata || {}) as Record<string, unknown>;
    const name = String(meta.giftName || meta.giftKey || '').trim();
    if (!name) continue;
    const qty = Math.max(1, Number(meta.quantity ?? 1) || 1);

    const match = matchGiftByName(catalog, name);
    let key: string;
    let learned = false;

    if (match) {
      key = match.key;
    } else {
      key = normalizeKey(name);
      // Auto-cadastra no catálogo (aprende presente novo), se o nome for plausível.
      if (isPlausibleGiftName(name)) {
        catalog = upsertGift(catalog, { key, name, emoji: '🎁' });
        catalogChanged = true;
        learned = true;
      }
    }

    const prev = state.gifts[key];
    state.gifts[key] = {
      key,
      name: prev?.name || name,
      count: (prev?.count ?? 0) + 1,
      totalQty: (prev?.totalQty ?? 0) + qty,
      lastSeen: new Date().toISOString(),
      learned: prev?.learned ?? learned,
      reactionVideoId: reaction.id ?? prev?.reactionVideoId,
      reactionVideoLabel: reaction.label ?? prev?.reactionVideoLabel,
    };
  }

  if (catalogChanged) saveGiftCatalog(catalog);
  state.updatedAt = new Date().toISOString();
  save(state);
}

/** Lista ordenada (mais frequentes primeiro) para a UI. */
export function getGiftLearning(): GiftStat[] {
  return Object.values(load().gifts).sort((a, b) => b.count - a.count);
}

/** Bloco de contexto injetado no prompt da Diretora. */
export function buildGiftInsightsContext(): string {
  const stats = getGiftLearning();
  if (!stats.length) return '';
  const top = stats.slice(0, 8);
  const lines: string[] = ['\n\n[PRESENTES APRENDIDOS]'];
  lines.push(
    `Mais recebidos: ${top.map((g) => `${g.name} (${g.count}x${g.totalQty > g.count ? `, ${g.totalQty} un` : ''})`).join('; ')}`,
  );
  const reactions = top.filter((g) => g.reactionVideoLabel || g.reactionVideoId);
  if (reactions.length) {
    lines.push(
      `Reações que já funcionaram: ${reactions
        .map((g) => `${g.name} → ${g.reactionVideoLabel || g.reactionVideoId}`)
        .join('; ')}`,
    );
  }
  const learned = stats.filter((g) => g.learned).slice(0, 8);
  if (learned.length) lines.push(`Aprendidos automaticamente: ${learned.map((g) => g.name).join(', ')}`);
  return `${lines.join('\n')}\n`;
}

export function clearGiftLearning(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
