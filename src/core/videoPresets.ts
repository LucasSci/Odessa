/**
 * videoPresets.ts — pré-definições de reação por vídeo (Fase 3).
 *
 * Cada vídeo pode ter um "perfil de reação" que diz à Diretora QUANDO usá-lo:
 * a que tipos de evento e intenções ele responde, sua prioridade, um cooldown
 * (descanso mínimo entre reusos) e uma instrução livre ("quando usar").
 *
 * Em vez de a IA escolher vídeo por heurística solta, ela recebe estas regras
 * no contexto (buildVideoPresetsContext) e respeita os cooldowns.
 *
 * Persiste em localStorage, no mesmo padrão do restante da camada de IA.
 */

const PRESETS_KEY = 'odessa:video-presets:v1';
const COOLDOWN_KEY = 'odessa:video-cooldowns:v1';

export interface VideoReactionProfile {
  videoId: string;
  /** Se a Diretora pode escolher este vídeo automaticamente. */
  enabled: boolean;
  /** Tipos de evento que combinam (gift, chat, alert, follow, system). Vazio = qualquer. */
  eventKinds: string[];
  /** Intenções da IA que combinam (gift_reaction, greeting, ...). Vazio = qualquer. */
  intents: string[];
  /** Peso na escolha (1–10). */
  priority: number;
  /** Descanso mínimo entre reusos, em segundos. */
  cooldownSec: number;
  /** Instrução livre em qualquer idioma ("usar quando falarem de amor"). */
  notes: string;
}

export function defaultProfile(videoId: string): VideoReactionProfile {
  return {
    videoId,
    enabled: false,
    eventKinds: [],
    intents: [],
    priority: 5,
    cooldownSec: 8,
    notes: '',
  };
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readMap<T>(key: string): Record<string, T> {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeMap<T>(key: string, map: Record<string, T>): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function normalizeProfile(videoId: string, raw: Partial<VideoReactionProfile>): VideoReactionProfile {
  const base = defaultProfile(videoId);
  return {
    videoId,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    eventKinds: Array.isArray(raw.eventKinds) ? raw.eventKinds.map(String) : base.eventKinds,
    intents: Array.isArray(raw.intents) ? raw.intents.map(String) : base.intents,
    priority:
      typeof raw.priority === 'number' ? Math.max(1, Math.min(10, Math.round(raw.priority))) : base.priority,
    cooldownSec:
      typeof raw.cooldownSec === 'number' ? Math.max(0, Math.min(600, Math.round(raw.cooldownSec))) : base.cooldownSec,
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 240) : base.notes,
  };
}

export function loadVideoPresets(): Record<string, VideoReactionProfile> {
  const raw = readMap<Partial<VideoReactionProfile>>(PRESETS_KEY);
  const out: Record<string, VideoReactionProfile> = {};
  for (const [id, p] of Object.entries(raw)) out[id] = normalizeProfile(id, p || {});
  return out;
}

export function getVideoPreset(videoId: string): VideoReactionProfile | null {
  const all = loadVideoPresets();
  return all[videoId] ?? null;
}

export function saveVideoPreset(profile: VideoReactionProfile): void {
  const all = readMap<Partial<VideoReactionProfile>>(PRESETS_KEY);
  all[profile.videoId] = normalizeProfile(profile.videoId, profile);
  writeMap(PRESETS_KEY, all);
}

export function removeVideoPreset(videoId: string): void {
  const all = readMap<Partial<VideoReactionProfile>>(PRESETS_KEY);
  if (all[videoId]) {
    delete all[videoId];
    writeMap(PRESETS_KEY, all);
  }
}

// ── Cooldown ────────────────────────────────────────────────────────────────

/** Marca que o vídeo acabou de tocar (inicia o cooldown). */
export function markVideoPlayed(videoId: string): void {
  if (!videoId) return;
  const map = readMap<number>(COOLDOWN_KEY);
  map[videoId] = Date.now();
  writeMap(COOLDOWN_KEY, map);
}

/** Segundos restantes de cooldown (0 = pronto para reuso). */
export function videoCooldownRemaining(videoId: string): number {
  const preset = getVideoPreset(videoId);
  if (!preset || preset.cooldownSec <= 0) return 0;
  const last = readMap<number>(COOLDOWN_KEY)[videoId];
  if (!last) return 0;
  const elapsed = (Date.now() - last) / 1000;
  return Math.max(0, Math.ceil(preset.cooldownSec - elapsed));
}

// ── Contexto para a Diretora ──────────────────────────────────────────────────

type CatalogVideo = { id: string; label?: string; name?: string; title?: string };

/**
 * Bloco injetado no prompt da Diretora descrevendo as reações pré-definidas dos
 * vídeos presentes no catálogo. Inclui o estado de cooldown.
 */
export function buildVideoPresetsContext(videos: CatalogVideo[]): string {
  const presets = loadVideoPresets();
  const byId = new Map(videos.map((v) => [v.id, v]));
  const lines: string[] = [];

  for (const p of Object.values(presets)) {
    if (!p.enabled) continue;
    const v = byId.get(p.videoId);
    if (!v) continue; // preset órfão (vídeo removido)
    const label = v.label || v.title || v.name || v.id;

    const parts: string[] = [];
    if (p.eventKinds.length) parts.push(`eventos=[${p.eventKinds.join(',')}]`);
    if (p.intents.length) parts.push(`intenções=[${p.intents.join(',')}]`);
    parts.push(`prioridade=${p.priority}`);
    if (p.notes.trim()) parts.push(`quando="${p.notes.trim()}"`);

    const remaining = videoCooldownRemaining(p.videoId);
    if (remaining > 0) parts.push(`EM DESCANSO(${remaining}s) — NÃO escolher agora`);

    lines.push(`- "${label}" (id:${p.videoId}): ${parts.join(', ')}`);
  }

  if (!lines.length) return '';
  return (
    '\n\n[REAÇÕES PRÉ-DEFINIDAS DOS VÍDEOS]\n' +
    'Escolha o vídeo em play_video conforme estas regras de prioridade; respeite os cooldowns ' +
    '(vídeos "EM DESCANSO" não devem ser escolhidos agora).\n' +
    lines.join('\n') +
    '\n'
  );
}

export function clearVideoPresets(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(PRESETS_KEY);
    window.localStorage.removeItem(COOLDOWN_KEY);
  } catch {
    // ignore
  }
}
