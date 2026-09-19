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

import { apiUrl } from '../lib/api';
import { clampSpeed } from './videoEditOps';

const STORAGE_KEY = 'odessa:video-edits:v1';

export interface VideoSegment {
  startSec: number;
  endSec: number;
  /** Velocidade de reprodução deste trecho (0.25–4). Ausente = 1×. */
  speed?: number;
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

// Sem sort por startSec: a ordem do array É a ordem de reprodução (Fase 5c —
// reordenar segmentos livremente). Um sort aqui desfaria silenciosamente
// qualquer reordenação do usuário no próximo save/load.
function sanitizeSegments(raw: unknown): VideoSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is VideoSegment => Boolean(s) && typeof s === 'object')
    .map((s) => {
      const seg: VideoSegment = { startSec: Math.max(0, Number(s.startSec) || 0), endSec: Math.max(0, Number(s.endSec) || 0) };
      const speed = clampSpeed(s.speed);
      if (speed !== 1) seg.speed = speed;
      return seg;
    })
    .filter((s) => s.endSec > s.startSec);
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

// ── Sincronização com o servidor ─────────────────────────────────────────────
// O localStorage é só um cache síncrono (a UI lê de forma síncrona em vários
// lugares). A fonte da verdade é o servidor: é dele que o overlay do OBS —
// outro navegador — recebe cortes/velocidade/áudio dentro do clip.

async function putRemote(edit: VideoEdit): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(`/api/video/${encodeURIComponent(edit.videoId)}/edit`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Salva local e no servidor. Devolve false se o servidor não confirmou (o local fica salvo). */
export async function persistVideoEdit(edit: VideoEdit): Promise<boolean> {
  saveVideoEdit(edit);
  return putRemote(edit);
}

const pendingPushes = new Map<string, ReturnType<typeof setTimeout>>();

/** Igual a persistVideoEdit, mas agrupa rajadas (ex.: arrastar um slider) numa única requisição. */
export function persistVideoEditDebounced(edit: VideoEdit, delayMs = 400): void {
  saveVideoEdit(edit);
  const pending = pendingPushes.get(edit.videoId);
  if (pending) clearTimeout(pending);
  pendingPushes.set(
    edit.videoId,
    setTimeout(() => {
      pendingPushes.delete(edit.videoId);
      void putRemote(edit);
    }, delayMs),
  );
}

/**
 * Puxa as edições do servidor para o cache local (servidor vence em conflito)
 * e envia ao servidor as que só existiam neste navegador (migração única).
 * Devolve quantas edições vieram do servidor, ou null se ele estava fora do ar.
 */
export async function syncVideoEditsFromServer(): Promise<number | null> {
  let remote: Record<string, Partial<VideoEdit>>;
  try {
    const res = await fetch(apiUrl('/api/video/edits'));
    if (!res.ok) return null;
    const body = (await res.json()) as { edits?: Record<string, Partial<VideoEdit>> };
    remote = body.edits && typeof body.edits === 'object' ? body.edits : {};
  } catch {
    return null;
  }

  const local = readAll();
  const merged: Record<string, Partial<VideoEdit>> = { ...local };
  for (const [id, edit] of Object.entries(remote)) merged[id] = normalize(id, edit || {});
  writeAll(merged);

  for (const [id, edit] of Object.entries(local)) {
    if (!(id in remote)) void putRemote(normalize(id, edit || {}));
  }
  return Object.keys(remote).length;
}

// ── Rascunho (autosave do editor) ────────────────────────────────────────────
// O autosave NÃO aplica a edição ao ar: só guarda um rascunho neste navegador,
// para o trabalho não se perder se a aba fechar. "Salvar" continua sendo o que
// publica para o Palco e o OBS.

const DRAFT_PREFIX = 'odessa:video-edit-draft:v1:';

export function saveEditDraft(edit: VideoEdit): boolean {
  if (!canUseStorage()) return false;
  try {
    window.localStorage.setItem(DRAFT_PREFIX + edit.videoId, JSON.stringify(edit));
    return true;
  } catch {
    return false; // cheio (ex.: trilha embutida grande) — o autosave só perde o rascunho
  }
}

export function loadEditDraft(videoId: string): VideoEdit | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + videoId);
    return raw ? normalize(videoId, JSON.parse(raw) as Partial<VideoEdit>) : null;
  } catch {
    return null;
  }
}

export function clearEditDraft(videoId: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(DRAFT_PREFIX + videoId);
  } catch {
    /* ignore */
  }
}

// ── Histórico de versões (servidor) ──────────────────────────────────────────

export interface VideoEditVersion {
  savedAt: string;
  action: 'save' | 'delete';
  edit: Partial<Omit<VideoEdit, 'trackUrl'>> & { trackUrl?: string | null; trackDropped?: boolean };
}

/** Versões salvas do clip (mais nova primeiro), ou null se o servidor não respondeu. */
export async function fetchVideoEditHistory(videoId: string): Promise<VideoEditVersion[] | null> {
  try {
    const res = await fetch(apiUrl(`/api/video/${encodeURIComponent(videoId)}/edit/history`));
    if (!res.ok) return null;
    const body = (await res.json()) as { versions?: VideoEditVersion[] };
    return Array.isArray(body.versions) ? body.versions : [];
  } catch {
    return null;
  }
}

/** Converte uma versão do histórico numa edição normalizada, pronta para carregar no editor. */
export function editFromVersion(videoId: string, version: VideoEditVersion): VideoEdit {
  const { trackUrl, trackDropped: _dropped, ...rest } = version.edit;
  return normalize(videoId, { ...rest, trackUrl: trackUrl ?? undefined });
}

/** Resumo curto de uma edição, para listas (ex.: "2 cortes · 1 acelerado · áudio original 50%"). */
export function describeEdit(edit: Pick<Partial<VideoEdit>, 'segments' | 'audioMode' | 'volume'>): string {
  const segs = Array.isArray(edit.segments) ? edit.segments : [];
  const parts: string[] = [segs.length > 0 ? `${segs.length} ${segs.length === 1 ? 'corte' : 'cortes'}` : 'vídeo inteiro'];
  const changedSpeed = segs.filter((s) => s.speed && s.speed !== 1).length;
  if (changedSpeed > 0) parts.push(`${changedSpeed} com velocidade`);
  if (edit.audioMode === 'original') parts.push(`áudio original ${Math.round((edit.volume ?? 1) * 100)}%`);
  else if (edit.audioMode === 'track') parts.push('trilha');
  return parts.join(' · ');
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
    // Com reordenação livre (Fase 5c), segments[0]/[last] não são mais
    // necessariamente o início/fim cronológico do clipe — precisa do min/max
    // real sobre todos os segmentos (usado por clipKey/identidade de clipe).
    next.startSec = Math.min(...edit.segments.map((s) => s.startSec));
    next.endSec = Math.max(...edit.segments.map((s) => s.endSec));
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
