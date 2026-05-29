/**
 * videoEdits.ts — edição por vídeo (Fase 4).
 *
 * Guarda, por vídeo, a edição feita no Palco: cortes (múltiplos segmentos),
 * volume, modo de áudio e uma trilha/efeito sonoro opcional, além da transição.
 * Persiste em localStorage (mesmo padrão da camada de IA) — sem backend.
 *
 * applyVideoEdit() mescla a edição num VideoClip. Como os vídeos disparados pela
 * Diretora passam por clipFromVideoId() (clipe "cru"), aplicar a edição ali faz
 * o player ao vivo honrar os cortes/volume/som SEM mudar o servidor.
 */

const STORAGE_KEY = 'odessa:video-edits:v1';

export interface VideoSegment {
  startSec: number;
  endSec: number;
}

export type AudioMode = 'muted' | 'original' | 'track';

export interface VideoEdit {
  videoId: string;
  /** Trechos a tocar, em ordem. Vazio = vídeo inteiro (sem corte). */
  segments: VideoSegment[];
  audioMode: AudioMode;
  /** 0..1 */
  volume: number;
  /** data URL (SFX curto) ou URL pública (música). */
  trackUrl?: string;
  trackLoop?: boolean;
  /** Transição padrão deste vídeo, em ms. */
  transitionMs: number;
}

/** Forma mínima de clipe que applyVideoEdit lê/escreve (compatível com VideoClip). */
export interface EditableClip {
  videoId: string;
  startSec: number;
  endSec: number | null;
  transitionMs: number;
  segments?: VideoSegment[];
  audio?: { mode?: AudioMode; volume?: number; trackUrl?: string; trackLoop?: boolean; trackId?: string };
}

export function defaultVideoEdit(videoId: string): VideoEdit {
  return {
    videoId,
    segments: [],
    audioMode: 'muted',
    volume: 1,
    trackUrl: undefined,
    trackLoop: false,
    transitionMs: 220,
  };
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readAll(): Record<string, Partial<VideoEdit>> {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Partial<VideoEdit>>) : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, Partial<VideoEdit>>): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage cheio (ex.: SFX grande demais) — silencioso; UI deve avisar antes.
  }
}

function sanitizeSegments(raw: unknown): VideoSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is VideoSegment => Boolean(s) && typeof s === 'object')
    .map((s) => ({ startSec: Math.max(0, Number(s.startSec) || 0), endSec: Math.max(0, Number(s.endSec) || 0) }))
    .filter((s) => s.endSec > s.startSec)
    .sort((a, b) => a.startSec - b.startSec);
}

function normalize(videoId: string, raw: Partial<VideoEdit>): VideoEdit {
  const base = defaultVideoEdit(videoId);
  return {
    videoId,
    segments: sanitizeSegments(raw.segments),
    audioMode: (['muted', 'original', 'track'] as AudioMode[]).includes(raw.audioMode as AudioMode)
      ? (raw.audioMode as AudioMode)
      : base.audioMode,
    volume: typeof raw.volume === 'number' ? Math.max(0, Math.min(1, raw.volume)) : base.volume,
    trackUrl: typeof raw.trackUrl === 'string' && raw.trackUrl ? raw.trackUrl : undefined,
    trackLoop: Boolean(raw.trackLoop),
    transitionMs:
      typeof raw.transitionMs === 'number' ? Math.max(0, Math.min(4000, raw.transitionMs)) : base.transitionMs,
  };
}

export function loadVideoEdits(): Record<string, VideoEdit> {
  const raw = readAll();
  const out: Record<string, VideoEdit> = {};
  for (const [id, e] of Object.entries(raw)) out[id] = normalize(id, e || {});
  return out;
}

export function getVideoEdit(videoId: string): VideoEdit | null {
  const raw = readAll()[videoId];
  return raw ? normalize(videoId, raw) : null;
}

export function saveVideoEdit(edit: VideoEdit): void {
  const all = readAll();
  all[edit.videoId] = normalize(edit.videoId, edit);
  writeAll(all);
}

export function removeVideoEdit(videoId: string): void {
  const all = readAll();
  if (all[videoId]) {
    delete all[videoId];
    writeAll(all);
  }
}

/** True se o vídeo tem qualquer edição não-trivial salva (para badge na UI). */
export function hasVideoEdit(videoId: string): boolean {
  const e = getVideoEdit(videoId);
  if (!e) return false;
  return e.segments.length > 0 || e.audioMode !== 'muted' || e.volume !== 1 || Boolean(e.trackUrl);
}

/**
 * Mescla a edição salva (se houver) num clipe. Vídeos sem edição salva passam
 * intactos. Usado em clipFromVideoId e como overlay nos clipes do fluxo.
 */
export function applyVideoEdit<T extends EditableClip>(clip: T): T {
  const edit = getVideoEdit(clip.videoId);
  if (!edit) return clip;

  const next: T = { ...clip };
  if (edit.segments.length > 0) {
    next.segments = edit.segments;
    next.startSec = edit.segments[0].startSec;
    next.endSec = edit.segments[edit.segments.length - 1].endSec;
  }
  if (edit.transitionMs) next.transitionMs = edit.transitionMs;
  next.audio = {
    ...(clip.audio || {}),
    mode: edit.audioMode,
    volume: edit.volume,
    trackUrl: edit.trackUrl,
    trackLoop: edit.trackLoop,
  };
  return next;
}

/** Lê um arquivo de áudio como data URL (para SFX curtos). Rejeita se muito grande. */
export const MAX_SFX_BYTES = 1_200_000; // ~1.2 MB — cabe no localStorage

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_SFX_BYTES) {
      reject(new Error(`Áudio muito grande (${Math.round(file.size / 1024)} KB). Use até ${Math.round(MAX_SFX_BYTES / 1024)} KB ou cole uma URL.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo de áudio.'));
    reader.readAsDataURL(file);
  });
}
