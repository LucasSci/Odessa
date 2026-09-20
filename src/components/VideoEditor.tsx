/**
 * VideoEditor — workspace de edição por clipe (Fase 3 do redesenho).
 *
 * Tela cheia: prévia grande (o clipe é vertical) + inspetor à direita + timeline
 * com miniaturas embaixo. Edição por segmentos (cortes), com:
 *  - dividir no playhead (S), duplicar (Ctrl+D), apagar (Delete),
 *  - ímã (snap) em playhead/bordas/início/fim ao arrastar,
 *  - velocidade por corte (0,25×–4×),
 *  - marcar início/fim (I/O), passos finos e frame a frame (Alt+←/→),
 *  - desfazer/refazer (Ctrl+Z / Ctrl+Shift+Z), aviso de alterações não salvas,
 *  - volume, modo de áudio, trilha/efeito sonoro e transição (crossfade).
 * Salva em videoEdits (localStorage). O player ao vivo honra via applyVideoEdit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Scissors, Plus, Trash2, Play, Pause, Volume2, X, Save, Music, Loader2, Copy, Magnet,
  ZoomIn, ZoomOut, ChevronsLeft, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Undo2, Redo2,
  SplitSquareHorizontal, Keyboard, History, RotateCcw,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui';
import { useToast } from './Toast';
import { Timeline } from './editor/Timeline';
import { useFilmstrip } from './editor/useFilmstrip';
import { apiUrl } from '../lib/api';
import {
  getVideoEdit, defaultVideoEdit, persistVideoEdit, fileToDataUrl,
  saveEditDraft, loadEditDraft, clearEditDraft, fetchVideoEditHistory, editFromVersion, describeEdit,
  type VideoEdit, type VideoSegment, type AudioMode, type VideoEditVersion,
} from '../core/videoEdits';
import {
  MAX_SPEED, MIN_SPEED, clampSpeed, duplicateSegment, playbackSeconds, snapCandidates, snapTime, splitAt,
} from '../core/videoEditOps';
import { segmentSpeed } from '../core/playback/clipTimeline';
import { useModalFocus } from '../core/useModalFocus';

interface VideoEditorProps {
  videoId: string;
  label?: string;
  onClose?: () => void;
}

type DragTarget = { index: number; edge: 'start' | 'end' } | null;

function fmt(t: number): string {
  if (!Number.isFinite(t)) return '0.00s';
  return `${t.toFixed(2)}s`;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Desfazer/Refazer — pilha de snapshots só da sessão do componente.
const HISTORY_LIMIT = 100;
// Só decodifica a forma de onda sozinho em arquivos pequenos (decodeAudioData carrega tudo na memória).
const AUTO_WAVEFORM_MAX_BYTES = 15_000_000;
const SNAP_PX = 8;

const SHORTCUTS: Array<[string, string]> = [
  ['Espaço', 'Reproduzir / pausar'],
  ['← →', 'Passo de 0,1s (Shift = 1s)'],
  ['Alt + ← →', 'Frame a frame'],
  ['I / O', 'Marcar início / fim'],
  ['S', 'Dividir no playhead'],
  ['Delete', 'Apagar corte selecionado'],
  ['Ctrl + D', 'Duplicar corte'],
  ['Ctrl + Z', 'Desfazer (Shift = refazer)'],
  ['F', 'Ajustar zoom à tela'],
  ['?', 'Mostrar / esconder atalhos'],
];

const chip = 'inline-flex items-center gap-1 rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--t2)] transition hover:bg-[var(--bg4)] hover:text-[var(--t1)] disabled:cursor-not-allowed disabled:opacity-40';

export default function VideoEditor({ videoId, label, onClose }: VideoEditorProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // edit + pilha de desfazer/refazer num único state (updater PURO e atômico —
  // setState aninhado duplicaria entradas sob StrictMode).
  const [editState, setEditState] = useState<{ edit: VideoEdit; stack: VideoEdit[]; index: number }>(() => {
    const initial = getVideoEdit(videoId) ?? defaultVideoEdit(videoId);
    return { edit: initial, stack: [initial], index: 0 };
  });
  const edit = editState.edit;
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(editState.edit));
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [drag, setDrag] = useState<DragTarget>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [audioError, setAudioError] = useState('');
  const [selectedSeg, setSelectedSeg] = useState<number | null>(null);
  const [zoom, setZoom] = useState(40); // pixels por segundo
  const [fitZoom, setFitZoom] = useState(40);
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(true);
  const [snapOn, setSnapOn] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  const previewSegRef = useRef(0);
  const durationInitRef = useRef(false);
  const blobSizeRef = useRef(0);
  const src = useMemo(() => apiUrl(`/api/video/play/${videoId}`), [videoId]);
  const segments = edit.segments;
  const frames = useFilmstrip(blobSrc, duration);
  const dirty = JSON.stringify(edit) !== savedJson;

  // ── rascunho (autosave) ──────────────────────────────────────────────────────
  // Só um rascunho local: NÃO vai ao ar. "Salvar" é que publica para Palco/OBS.
  const [pendingDraft, setPendingDraft] = useState<VideoEdit | null>(() => {
    const draft = loadEditDraft(videoId);
    return draft && JSON.stringify(draft) !== JSON.stringify(editState.edit) ? draft : null;
  });
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [versions, setVersions] = useState<VideoEditVersion[] | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);

  useEffect(() => {
    if (pendingDraft) return; // não sobrescreve o rascunho antes de o usuário decidir
    if (!dirty) { clearEditDraft(videoId); setDraftSavedAt(null); return; }
    const timer = window.setTimeout(() => {
      if (saveEditDraft(edit)) setDraftSavedAt(new Date());
    }, 800);
    return () => window.clearTimeout(timer);
  }, [edit, dirty, pendingDraft, videoId]);

  const refreshVersions = useCallback(async () => {
    setLoadingVersions(true);
    setVersions(await fetchVideoEditHistory(videoId));
    setLoadingVersions(false);
  }, [videoId]);

  useEffect(() => { void refreshVersions(); }, [refreshVersions]);

  // Alguns MP4 transmitidos só informam a duração no evento durationchange (às
  // vezes como Infinity até tocar). Trata ambos os eventos e força resolução.
  const applyDuration = useCallback((d: number) => {
    if (!Number.isFinite(d) || d <= 0) return;
    setDuration(d);
    const z = clamp(Math.round(900 / d), 8, 120);
    setFitZoom(z);
    if (!durationInitRef.current) { setZoom(z); durationInitRef.current = true; }
  }, []);

  const nudgeDuration = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!Number.isFinite(v.duration) || v.duration <= 0) {
      try { v.currentTime = 1e6; } catch { /* ignore */ }
    }
  }, []);

  // Baixa o clipe como Blob e toca por blob URL — o stream /api/video/play não
  // expõe duração/range confiável. Com o blob local, a duração resolve e o
  // corte fica frame-a-frame.
  useEffect(() => {
    let url = '';
    let cancelled = false;
    setLoadingVideo(true);
    setBlobSrc(null);
    durationInitRef.current = false;
    fetch(src)
      .then((r) => r.blob())
      .then((b) => { if (cancelled) return; blobSizeRef.current = b.size; url = URL.createObjectURL(b); setBlobSrc(url); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoadingVideo(false); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [src]);

  // Forma de onda a partir do blob já baixado (sem nova requisição).
  useEffect(() => {
    if (!blobSrc || blobSizeRef.current > AUTO_WAVEFORM_MAX_BYTES) return;
    let cancelled = false;
    (async () => {
      try {
        const buf = await (await fetch(blobSrc)).arrayBuffer();
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const audio = await ctx.decodeAudioData(buf);
        const ch = audio.getChannelData(0);
        const N = 600;
        const block = Math.floor(ch.length / N) || 1;
        const out: number[] = [];
        for (let i = 0; i < N; i++) {
          let max = 0;
          for (let j = 0; j < block; j++) { const v = Math.abs(ch[i * block + j] || 0); if (v > max) max = v; }
          out.push(max);
        }
        void ctx.close();
        if (!cancelled) setPeaks(out);
      } catch {
        if (!cancelled) setPeaks(null); // sem faixa de áudio ou formato não decodificável
      }
    })();
    return () => { cancelled = true; };
  }, [blobSrc]);

  // Mudança CONFIRMADA (empilha no histórico). Arrastar usa setEditSilent e
  // só empilha uma vez, no pointerup.
  const applyEdit = useCallback((updater: (e: VideoEdit) => VideoEdit) => {
    setEditState((s) => {
      const next = updater(s.edit);
      const stack = s.stack.slice(0, s.index + 1);
      stack.push(next);
      while (stack.length > HISTORY_LIMIT) stack.shift();
      return { edit: next, stack, index: stack.length - 1 };
    });
  }, []);

  const setEditSilent = useCallback((updater: (e: VideoEdit) => VideoEdit) => {
    setEditState((s) => ({ ...s, edit: updater(s.edit) }));
  }, []);

  const commitSilentEdit = useCallback(() => {
    setEditState((s) => {
      const stack = s.stack.slice(0, s.index + 1);
      stack.push(s.edit);
      while (stack.length > HISTORY_LIMIT) stack.shift();
      return { edit: s.edit, stack, index: stack.length - 1 };
    });
  }, []);

  const undo = useCallback(() => {
    setEditState((s) => {
      if (s.index <= 0) return s;
      const nextIndex = s.index - 1;
      return { edit: s.stack[nextIndex], stack: s.stack, index: nextIndex };
    });
  }, []);

  const redo = useCallback(() => {
    setEditState((s) => {
      if (s.index >= s.stack.length - 1) return s;
      const nextIndex = s.index + 1;
      return { edit: s.stack[nextIndex], stack: s.stack, index: nextIndex };
    });
  }, []);

  const canUndo = editState.index > 0;
  const canRedo = editState.index < editState.stack.length - 1;

  // A ordem do array É a ordem de reprodução (reordenar livremente).
  const updateSegments = useCallback((next: VideoSegment[]) => {
    applyEdit((e) => ({ ...e, segments: [...next] }));
  }, [applyEdit]);

  const moveSegment = useCallback((index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= segments.length) return;
    const next = segments.slice();
    [next[index], next[target]] = [next[target], next[index]];
    updateSegments(next);
    setSelectedSeg(target);
  }, [segments, updateSegments]);

  // silent=true (drag em andamento): atualiza sem empilhar histórico.
  const patchSegment = useCallback((index: number, patch: Partial<VideoSegment>, opts?: { silent?: boolean }) => {
    const updater = (e: VideoEdit): VideoEdit => {
      const segs = e.segments.slice();
      const seg = segs[index];
      if (!seg) return e;
      let startSec = patch.startSec !== undefined ? clamp(round2(patch.startSec), 0, duration || patch.startSec) : seg.startSec;
      let endSec = patch.endSec !== undefined ? clamp(round2(patch.endSec), 0, duration || patch.endSec) : seg.endSec;
      if (endSec <= startSec) {
        if (patch.startSec !== undefined) startSec = Math.max(0, endSec - 0.05);
        else endSec = startSec + 0.05;
      }
      const next: VideoSegment = { ...seg, startSec, endSec };
      if (patch.speed !== undefined) {
        const speed = clampSpeed(patch.speed);
        if (speed === 1) delete next.speed;
        else next.speed = speed;
      }
      segs[index] = next;
      return { ...e, segments: segs };
    };
    if (opts?.silent) setEditSilent(updater);
    else applyEdit(updater);
  }, [duration, applyEdit, setEditSilent]);

  // ── tempo <-> pixel ──────────────────────────────────────────────────────────
  const pxToTime = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || zoom <= 0) return 0;
    const rect = track.getBoundingClientRect();
    return clamp(round2((clientX - rect.left) / zoom), 0, duration || 0);
  }, [zoom, duration]);

  // ── segmentos ────────────────────────────────────────────────────────────────
  const addSegment = useCallback(() => {
    const from = clamp(currentTime, 0, Math.max(0, duration - 0.5));
    const to = clamp(from + Math.min(2, Math.max(1, duration - from)), from + 0.05, duration || from + 2);
    const next = [...segments, { startSec: round2(from), endSec: round2(to) }];
    updateSegments(next);
    setSelectedSeg(next.length - 1);
  }, [currentTime, duration, segments, updateSegments]);

  const removeSegment = useCallback((index: number) => {
    updateSegments(segments.filter((_, i) => i !== index));
    setSelectedSeg(null);
  }, [segments, updateSegments]);

  const splitAtPlayhead = useCallback(() => {
    const result = splitAt(segments, currentTime, duration);
    if (!result) {
      toast.info('Posicione o playhead dentro de um corte (longe das bordas) para dividir.');
      return;
    }
    updateSegments(result.segments);
    setSelectedSeg(result.selectIndex);
  }, [segments, currentTime, duration, updateSegments, toast]);

  const duplicateSelected = useCallback(() => {
    if (selectedSeg == null) return;
    const result = duplicateSegment(segments, selectedSeg);
    if (!result) return;
    updateSegments(result.segments);
    setSelectedSeg(result.selectIndex);
  }, [segments, selectedSeg, updateSegments]);

  const markIn = useCallback(() => {
    const t = round2(currentTime);
    if (selectedSeg != null && segments[selectedSeg]) { patchSegment(selectedSeg, { startSec: t }); return; }
    const next = [...segments, { startSec: t, endSec: clamp(t + 1, t + 0.05, duration || t + 1) }];
    updateSegments(next);
    setSelectedSeg(next.length - 1);
  }, [currentTime, selectedSeg, segments, patchSegment, updateSegments, duration]);

  const markOut = useCallback(() => {
    const t = round2(currentTime);
    if (selectedSeg != null && segments[selectedSeg]) { patchSegment(selectedSeg, { endSec: t }); return; }
    const next = [...segments, { startSec: clamp(t - 1, 0, t - 0.05), endSec: t }];
    updateSegments(next);
    setSelectedSeg(next.length - 1);
  }, [currentTime, selectedSeg, segments, patchSegment, updateSegments]);

  // Arrasto dos handles: silencioso durante o movimento, uma entrada de
  // histórico no pointerup. Com ímã, gruda em playhead/bordas/início/fim.
  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      let t = pxToTime(ev.clientX);
      if (snapOn && !ev.altKey) {
        t = snapTime(t, snapCandidates(segments, { playhead: currentTime, duration, ignoreIndex: drag.index }), SNAP_PX / zoom);
      }
      patchSegment(drag.index, drag.edge === 'start' ? { startSec: t } : { endSec: t }, { silent: true });
    };
    const onUp = () => {
      setDrag(null);
      commitSilentEdit();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [drag, pxToTime, patchSegment, commitSilentEdit, snapOn, segments, currentTime, duration, zoom]);

  // ── transporte / playhead ────────────────────────────────────────────────────
  const seekTo = useCallback((t: number) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = clamp(t, 0, duration || t);
    setPreviewing(false);
  }, [duration]);

  const step = useCallback((delta: number) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = clamp(round2(v.currentTime + delta), 0, duration || v.currentTime + delta);
    setPreviewing(false);
  }, [duration]);

  // fps estimado no CLIENTE via requestVideoFrameCallback (sem depender de
  // ffprobe no backend); sem suporte, degrada pra 30fps.
  const [fps, setFps] = useState(30);
  const fpsSamplesRef = useRef<number[]>([]);
  const lastFrameMediaTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const v = videoRef.current as (HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, metadata: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    }) | null;
    if (!v || !blobSrc || typeof v.requestVideoFrameCallback !== 'function') return;

    let handle: number | null = null;
    let cancelled = false;
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      if (cancelled) return;
      const last = lastFrameMediaTimeRef.current;
      if (last !== null) {
        const delta = metadata.mediaTime - last;
        if (delta > 0.005 && delta < 0.5) {
          const samples = fpsSamplesRef.current;
          samples.push(1 / delta);
          if (samples.length > 30) samples.shift();
          if (samples.length >= 8) {
            const sorted = [...samples].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            setFps((prev) => {
              const rounded = clamp(Math.round(median * 100) / 100, 1, 120);
              return Math.abs(prev - rounded) > 0.4 ? rounded : prev;
            });
          }
        }
      }
      lastFrameMediaTimeRef.current = metadata.mediaTime;
      handle = v.requestVideoFrameCallback!(onFrame);
    };
    handle = v.requestVideoFrameCallback(onFrame);
    return () => {
      cancelled = true;
      if (handle !== null) v.cancelVideoFrameCallback?.(handle);
      lastFrameMediaTimeRef.current = null;
      fpsSamplesRef.current = [];
    };
  }, [blobSrc]);

  const stepFrame = useCallback((dir: 1 | -1) => {
    step(dir * (1 / (fps || 30)));
  }, [step, fps]);

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    setCurrentTime(v.currentTime);
    if (!previewing || segments.length === 0) return;
    let idx = previewSegRef.current;
    if (idx >= segments.length) idx = segments.length - 1;
    const seg = segments[idx];
    if (v.currentTime >= seg.endSec) {
      if (idx + 1 < segments.length) {
        previewSegRef.current = idx + 1;
        v.playbackRate = segmentSpeed(segments[idx + 1]);
        v.currentTime = segments[idx + 1].startSec;
      } else { v.pause(); v.playbackRate = 1; setPreviewing(false); setPlaying(false); }
    }
  }, [previewing, segments]);

  const playPreview = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (segments.length > 0) {
      previewSegRef.current = 0;
      v.currentTime = segments[0].startSec;
      v.playbackRate = segmentSpeed(segments[0]);
      setPreviewing(true);
    }
    v.muted = edit.audioMode !== 'original'; v.volume = edit.volume;
    void v.play().catch(() => undefined); setPlaying(true);
  }, [segments, edit.audioMode, edit.volume]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) { v.playbackRate = 1; setPreviewing(false); v.muted = edit.audioMode !== 'original'; v.volume = edit.volume; void v.play().catch(() => undefined); setPlaying(true); }
    else { v.pause(); setPlaying(false); setPreviewing(false); }
  }, [edit.audioMode, edit.volume]);

  const onPickAudio = useCallback(async (file: File | undefined) => {
    if (!file) return; setAudioError('');
    try { const url = await fileToDataUrl(file); applyEdit((e) => ({ ...e, trackUrl: url, audioMode: 'track' })); }
    catch (err) { setAudioError(err instanceof Error ? err.message : 'Falha ao carregar áudio'); }
  }, [applyEdit]);

  const handleSave = useCallback(async () => {
    const json = JSON.stringify(edit);
    const synced = await persistVideoEdit(edit);
    setSavedJson(json);
    clearEditDraft(videoId);
    setDraftSavedAt(null);
    if (synced) {
      toast.success('Edição salva. Palco e OBS já usam os novos cortes.');
      void refreshVersions();
    } else toast.warning('Salva só neste navegador: o servidor não respondeu, então o OBS não verá a edição. Salve de novo quando o backend voltar.');
  }, [edit, toast, videoId, refreshVersions]);

  const restoreVersion = useCallback((version: VideoEditVersion) => {
    const restored = editFromVersion(videoId, version);
    applyEdit(() => restored);
    setSelectedSeg(null);
    toast.info(version.edit.trackDropped
      ? 'Versão carregada no editor (a trilha embutida não é guardada nas versões). Clique em Salvar para aplicar.'
      : 'Versão carregada no editor. Clique em Salvar para aplicar.');
  }, [videoId, applyEdit, toast]);

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('Há alterações não salvas. Fechar mesmo assim?')) return;
    onClose?.();
  }, [dirty, onClose]);

  // Atalhos (ignorados enquanto se digita num campo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Espaço/Enter num botão focado é o clique nativo: sem isto, o atalho de
      // play disparava junto com o botão (duas ações por tecla).
      if ((tag === 'BUTTON' || tag === 'A') && (e.key === ' ' || e.key === 'Enter')) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && key === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (e.ctrlKey || e.metaKey) return;
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -1 : -0.1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 1 : 0.1); }
      else if (key === 'i') { e.preventDefault(); markIn(); }
      else if (key === 'o') { e.preventDefault(); markOut(); }
      else if (key === 's') { e.preventDefault(); splitAtPlayhead(); }
      else if (key === 'f') { e.preventDefault(); setZoom(fitZoom); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedSeg != null) { e.preventDefault(); removeSegment(selectedSeg); } }
      else if (e.key === '?') { e.preventDefault(); setShowHelp((v) => !v); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (showHelp) setShowHelp(false); else requestClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, stepFrame, markIn, markOut, togglePlay, undo, redo, splitAtPlayhead, duplicateSelected, removeSegment, selectedSeg, fitZoom, showHelp, requestClose]);

  useModalFocus(dialogRef);

  const selected = selectedSeg != null ? segments[selectedSeg] : undefined;
  const totalPlay = segments.length > 0 ? playbackSeconds(segments) : duration;

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] outline-none" role="dialog" aria-modal="true" aria-label="Editor de vídeo">
      {/* Cabeçalho */}
      <header className="flex items-center gap-2 border-b border-[var(--border2)] bg-[var(--bg2)] px-4 py-2.5">
        <Scissors className="h-4 w-4 text-[var(--sky)]" />
        <span className="text-sm font-semibold text-[var(--t1)]">Editor</span>
        <span className="min-w-0 truncate text-xs text-[var(--t3)]">— {label || videoId}</span>
        {dirty && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">não salvo</span>}
        {dirty && draftSavedAt && (
          <span className="hidden text-[10px] text-[var(--t3)] sm:inline" title="Rascunho guardado neste navegador. Só 'Salvar' aplica no Palco e no OBS.">
            rascunho guardado {draftSavedAt.toLocaleTimeString('pt-BR')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><Undo2 className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="secondary" onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer"><Redo2 className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="secondary" onClick={playPreview} disabled={segments.length === 0}><Play className="h-3.5 w-3.5" />Prévia dos cortes</Button>
          <Button size="sm" variant="primary" onClick={() => void handleSave()}><Save className="h-3.5 w-3.5" />Salvar</Button>
          <button type="button" onClick={() => setShowHelp((v) => !v)} className="rounded-lg p-2 text-[var(--t3)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)]" aria-label="Atalhos de teclado" title="Atalhos (?)"><Keyboard className="h-4 w-4" /></button>
          <button type="button" onClick={requestClose} className="rounded-lg p-2 text-[var(--t3)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)]" aria-label="Fechar editor"><X className="h-4 w-4" /></button>
        </div>
      </header>

      {pendingDraft && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs text-amber-200">
          <History className="h-3.5 w-3.5" />
          <span>Há um rascunho não salvo deste clip ({describeEdit(pendingDraft)}).</span>
          <div className="ml-auto flex gap-1.5">
            <button className={chip} onClick={() => { applyEdit(() => pendingDraft); setPendingDraft(null); }}>Restaurar rascunho</button>
            <button className={chip} onClick={() => { clearEditDraft(videoId); setPendingDraft(null); }}>Descartar</button>
          </div>
        </div>
      )}

      {/* Prévia + inspetor */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 flex-col gap-3 p-4">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border2)] bg-black">
            {blobSrc && (
              <video
                ref={videoRef} src={blobSrc} playsInline preload="metadata" className="max-h-full max-w-full object-contain"
                onLoadedMetadata={(e) => { applyDuration(e.currentTarget.duration); if (!Number.isFinite(e.currentTarget.duration) || e.currentTarget.duration <= 0) nudgeDuration(); }}
                onDurationChange={(e) => applyDuration(e.currentTarget.duration)}
                onSeeked={(e) => { if (durationInitRef.current) return; applyDuration(e.currentTarget.duration); try { e.currentTarget.currentTime = 0; } catch { /* ignore */ } }}
                onTimeUpdate={onTimeUpdate} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)}
              />
            )}
            {loadingVideo && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-[var(--t3)]">
                <Loader2 className="h-4 w-4 animate-spin" /> carregando vídeo…
              </div>
            )}
          </div>

          {/* Transporte */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--border2)] bg-[var(--bg2)] p-2">
            <button className={chip} onClick={() => seekTo(0)} title="Início" aria-label="Ir ao início"><ChevronsLeft className="h-3.5 w-3.5" /></button>
            <button className={chip} onClick={() => step(-1)}>−1s</button>
            <button className={chip} onClick={() => step(-0.1)}>−0,1s</button>
            <button className={chip} onClick={() => stepFrame(-1)} title="Frame anterior (Alt+←)" aria-label="Frame anterior"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <button className="rounded-lg bg-[image:var(--accent-grad)] px-3.5 py-1.5 text-[#051018]" onClick={togglePlay} aria-label={playing && !previewing ? 'Pausar' : 'Reproduzir'}>{playing && !previewing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button>
            <button className={chip} onClick={() => stepFrame(1)} title="Próximo frame (Alt+→)" aria-label="Próximo frame"><ChevronRight className="h-3.5 w-3.5" /></button>
            <button className={chip} onClick={() => step(0.1)}>+0,1s</button>
            <button className={chip} onClick={() => step(1)}>+1s</button>
            <span className="ml-2 font-mono text-xs text-[var(--sky)]">{fmt(currentTime)}<span className="text-[var(--t3)]"> / {fmt(duration)} · {Math.round(fps)}fps</span></span>
            <div className="ml-auto flex items-center gap-1.5">
              <button className={cn(chip, 'border-emerald-500/30 text-emerald-300')} onClick={markIn} title="Marcar início (I)">⟦ Início</button>
              <button className={cn(chip, 'border-rose-500/30 text-rose-300')} onClick={markOut} title="Marcar fim (O)">Fim ⟧</button>
            </div>
          </div>
        </div>

        {/* Inspetor */}
        <aside className="min-h-0 space-y-3 overflow-y-auto border-l border-[var(--border2)] bg-[var(--bg2)] p-4">
          <section aria-label="Cortes">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--t3)]">Cortes</h3>
              <span className="font-mono text-[10px] text-[var(--t3)]">{segments.length > 0 ? `${segments.length} · ${fmt(totalPlay)}` : `inteiro · ${fmt(duration)}`}</span>
            </div>
            {segments.length === 0 && <p className="text-xs text-[var(--t3)]">Sem cortes: o vídeo toca inteiro. Use S para dividir ou I/O para marcar um trecho.</p>}
            <ol className="space-y-1.5">
              {segments.map((seg, i) => (
                <li
                  key={i}
                  onClick={() => setSelectedSeg(i)}
                  className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px]', selectedSeg === i ? 'border-[var(--sky)]/60 bg-[var(--sky)]/10' : 'border-[var(--border2)] bg-[var(--bg3)]/50')}
                >
                  <span className="font-mono text-[var(--t3)]">#{i + 1}</span>
                  <span className="flex flex-col">
                    <button onClick={(e) => { e.stopPropagation(); moveSegment(i, -1); }} disabled={i === 0} aria-label="Mover para cima" className="text-[var(--t3)] hover:text-[var(--t1)] disabled:opacity-30"><ChevronUp className="h-3 w-3" /></button>
                    <button onClick={(e) => { e.stopPropagation(); moveSegment(i, 1); }} disabled={i === segments.length - 1} aria-label="Mover para baixo" className="text-[var(--t3)] hover:text-[var(--t1)] disabled:opacity-30"><ChevronDown className="h-3 w-3" /></button>
                  </span>
                  <span className="font-mono text-[var(--t2)]">{fmt(seg.startSec)} → {fmt(seg.endSec)}</span>
                  {seg.speed && seg.speed !== 1 && <span className="rounded bg-[var(--bg4)] px-1 font-mono text-[10px] text-[var(--sky)]">{seg.speed}×</span>}
                  <button onClick={(e) => { e.stopPropagation(); seekTo(seg.startSec); }} className="ml-auto rounded border border-[var(--border2)] px-1.5 py-0.5 text-[10px] text-[var(--t2)] hover:bg-[var(--bg4)]">ir</button>
                  <button onClick={(e) => { e.stopPropagation(); removeSegment(i); }} aria-label="Apagar corte" className="text-[var(--t3)] hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ol>

            {selected && selectedSeg != null && (
              <div className="mt-3 space-y-3 rounded-xl border border-[var(--border2)] bg-[var(--bg)] p-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--t3)]">Corte #{selectedSeg + 1}</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-[var(--t3)]">Início
                    <input type="number" step={0.05} min={0} max={duration || undefined} value={selected.startSec}
                      onChange={(e) => patchSegment(selectedSeg, { startSec: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1 font-mono text-xs text-[var(--t1)] outline-none focus:border-[var(--sky)]" />
                  </label>
                  <label className="text-[10px] text-[var(--t3)]">Fim
                    <input type="number" step={0.05} min={0} max={duration || undefined} value={selected.endSec}
                      onChange={(e) => patchSegment(selectedSeg, { endSec: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1 font-mono text-xs text-[var(--t1)] outline-none focus:border-[var(--sky)]" />
                  </label>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-[var(--t3)]">
                    <span>Velocidade</span>
                    <span className="font-mono text-[var(--sky)]">{(selected.speed ?? 1)}×</span>
                  </div>
                  <input type="range" min={MIN_SPEED} max={MAX_SPEED} step={0.05} value={selected.speed ?? 1}
                    aria-label="Velocidade do corte"
                    onChange={(e) => patchSegment(selectedSeg, { speed: Number(e.target.value) })}
                    className="w-full accent-[var(--sky)]" />
                  <div className="flex gap-1">
                    {[0.5, 1, 1.5, 2].map((v) => (
                      <button key={v} onClick={() => patchSegment(selectedSeg, { speed: v })}
                        className={cn('flex-1 rounded-md border px-1 py-0.5 font-mono text-[10px]', (selected.speed ?? 1) === v ? 'border-[var(--sky)]/60 bg-[var(--sky)]/15 text-[var(--sky)]' : 'border-[var(--border2)] text-[var(--t3)] hover:text-[var(--t1)]')}>{v}×</button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button className={cn(chip, 'flex-1 justify-center')} onClick={duplicateSelected}><Copy className="h-3 w-3" />Duplicar</button>
                  <button className={cn(chip, 'flex-1 justify-center')} onClick={() => removeSegment(selectedSeg)}><Trash2 className="h-3 w-3" />Apagar</button>
                </div>
              </div>
            )}
          </section>

          <section aria-label="Áudio" className="space-y-3 rounded-xl border border-[var(--border2)] bg-[var(--bg)] p-3">
            <div className="flex items-center gap-2"><Volume2 className="h-3.5 w-3.5 text-[var(--sky)]" /><h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--t3)]">Áudio</h3></div>
            <div className="flex flex-wrap gap-1">
              {(['muted', 'original', 'track'] as AudioMode[]).map((m) => (
                <button key={m} onClick={() => applyEdit((e) => ({ ...e, audioMode: m }))}
                  className={cn('rounded-lg border px-2.5 py-1 text-[11px] transition', edit.audioMode === m ? 'border-[var(--sky)]/60 bg-[var(--sky)]/15 text-[var(--sky)]' : 'border-[var(--border2)] text-[var(--t3)] hover:text-[var(--t1)]')}>
                  {m === 'muted' ? 'Mudo' : m === 'original' ? 'Original' : 'Trilha'}
                </button>
              ))}
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between"><span className="text-[10px] text-[var(--t3)]">Volume</span><span className="font-mono text-[10px] text-[var(--sky)]">{Math.round(edit.volume * 100)}%</span></div>
              <input type="range" min={0} max={1} step={0.05} value={edit.volume} aria-label="Volume" onChange={(e) => applyEdit((ed) => ({ ...ed, volume: Number(e.target.value) }))} className="w-full accent-[var(--sky)]" />
            </div>
            {edit.audioMode === 'track' && (
              <div className="space-y-2 rounded-lg border border-[var(--border2)] p-2">
                <div className="flex items-center gap-2 text-[10px] text-[var(--t3)]"><Music className="h-3 w-3" /> Trilha / efeito sonoro</div>
                <input type="file" accept="audio/*" onChange={(e) => void onPickAudio(e.target.files?.[0])} className="block w-full text-[10px] text-[var(--t3)] file:mr-2 file:rounded file:border-0 file:bg-[var(--sky)]/20 file:px-2 file:py-1 file:text-[var(--sky)]" />
                <input type="text" placeholder="ou cole uma URL de áudio (https://…)" value={edit.trackUrl && !edit.trackUrl.startsWith('data:') ? edit.trackUrl : ''} onChange={(e) => applyEdit((ed) => ({ ...ed, trackUrl: e.target.value || undefined }))} className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-2 py-1 text-[11px] text-[var(--t1)] outline-none focus:border-[var(--sky)]" />
                {edit.trackUrl && (<div className="flex items-center justify-between text-[10px] text-emerald-400"><span>{edit.trackUrl.startsWith('data:') ? 'áudio carregado ✓' : 'URL definida ✓'}</span><button onClick={() => applyEdit((ed) => ({ ...ed, trackUrl: undefined }))} className="text-[var(--t3)] hover:text-red-400">remover</button></div>)}
                <label className="flex items-center gap-2 text-[11px] text-[var(--t2)]"><input type="checkbox" checked={Boolean(edit.trackLoop)} onChange={(e) => applyEdit((ed) => ({ ...ed, trackLoop: e.target.checked }))} />repetir (loop)</label>
                {audioError && <p className="text-[10px] text-red-400">{audioError}</p>}
              </div>
            )}
          </section>

          <section aria-label="Transição" className="space-y-2 rounded-xl border border-[var(--border2)] bg-[var(--bg)] p-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--t3)]">Transição (ao entrar)</h3>
            <div className="flex items-center justify-between"><span className="text-[10px] text-[var(--t3)]">Crossfade</span><span className="font-mono text-[10px] text-[var(--sky)]">{edit.transitionMs}ms</span></div>
            <input type="range" min={0} max={2000} step={20} value={edit.transitionMs} aria-label="Duração do crossfade" onChange={(e) => applyEdit((ed) => ({ ...ed, transitionMs: Number(e.target.value) }))} className="w-full accent-[var(--sky)]" />
            <p className="text-[10px] text-[var(--t3)]">Vale no Palco. As edições valem sempre que o vídeo tocar ali.</p>
          </section>

          <section aria-label="Versões" className="space-y-2 rounded-xl border border-[var(--border2)] bg-[var(--bg)] p-3">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--t3)]"><History className="h-3.5 w-3.5" />Versões</h3>
              {loadingVersions && <Loader2 className="h-3 w-3 animate-spin text-[var(--t3)]" />}
            </div>
            {versions === null && !loadingVersions && <p className="text-[10px] text-[var(--t3)]">Histórico indisponível: o servidor não respondeu.</p>}
            {versions !== null && versions.length === 0 && <p className="text-[10px] text-[var(--t3)]">Cada vez que você salva, uma versão fica guardada aqui (as últimas 20).</p>}
            <ol className="space-y-1.5">
              {(versions ?? []).map((version, i) => (
                <li key={`${version.savedAt}-${i}`} className="flex items-center gap-2 rounded-lg border border-[var(--border2)] bg-[var(--bg3)]/50 px-2 py-1.5 text-[11px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[var(--t1)]">
                      {new Date(version.savedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {version.action === 'delete' && <span className="ml-1.5 text-red-300">(removida)</span>}
                      {i === 0 && version.action === 'save' && <span className="ml-1.5 text-[var(--sky)]">(atual)</span>}
                    </div>
                    <div className="truncate text-[10px] text-[var(--t3)]">{describeEdit(version.edit)}</div>
                  </div>
                  <button className={chip} onClick={() => restoreVersion(version)} title="Carregar esta versão no editor"><RotateCcw className="h-3 w-3" />Restaurar</button>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      {/* Timeline */}
      <section aria-label="Linha do tempo" className="space-y-2 border-t border-[var(--border2)] bg-[var(--bg2)] p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button className={chip} onClick={splitAtPlayhead} title="Dividir no playhead (S)"><SplitSquareHorizontal className="h-3.5 w-3.5" />Dividir</button>
          <button className={chip} onClick={addSegment} title="Adicionar corte no playhead"><Plus className="h-3.5 w-3.5" />Corte</button>
          <button className={cn(chip, snapOn && 'border-[var(--sky)]/60 bg-[var(--sky)]/15 text-[var(--sky)]')} onClick={() => setSnapOn((v) => !v)} aria-pressed={snapOn} title="Ímã: gruda em playhead, bordas, início e fim (Alt ao arrastar desliga)"><Magnet className="h-3.5 w-3.5" />Ímã</button>
          <div className="ml-auto flex items-center gap-1.5">
            <button className={chip} onClick={() => setZoom((z) => clamp(round2(z / 1.5), 4, 400))} aria-label="Menos zoom"><ZoomOut className="h-3.5 w-3.5" /></button>
            <button className={chip} onClick={() => setZoom(fitZoom)} title="Ajustar (F)">Ajustar</button>
            <button className={chip} onClick={() => setZoom((z) => clamp(round2(z * 1.5), 4, 400))} aria-label="Mais zoom"><ZoomIn className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <Timeline
          trackRef={trackRef}
          duration={duration}
          zoom={zoom}
          segments={segments}
          selectedSeg={selectedSeg}
          currentTime={currentTime}
          peaks={peaks}
          frames={frames}
          dragging={drag !== null}
          onSeek={(clientX) => seekTo(pxToTime(clientX))}
          onSelect={setSelectedSeg}
          onDragStart={(index, edge) => setDrag({ index, edge })}
        />
      </section>

      {showHelp && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60" onClick={() => setShowHelp(false)}>
          <div className="w-[min(420px,calc(100vw-32px))] rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] p-5 shadow-[var(--shadow-3)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-[var(--t1)]">Atalhos do editor</h3>
            <dl className="space-y-1.5 text-xs">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between gap-3">
                  <dt><kbd className="rounded bg-[var(--bg4)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--t1)]">{keys}</kbd></dt>
                  <dd className="text-[var(--t2)]">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
