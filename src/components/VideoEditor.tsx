/**
 * VideoEditor — editor de vídeo por clipe (Fase 4, v2 — corte preciso).
 *
 * Edição de verdade: múltiplos segmentos (cortar trechos do meio), com
 *  - marcar início/fim no playhead (frame onde o vídeo está parado),
 *  - campos numéricos por segmento (tempo exato, passo 0,05s),
 *  - timeline com ZOOM + rolagem (precisão em vídeos longos),
 *  - passos finos no playhead (−1s / −0,1s / +0,1s / +1s) e clique p/ posicionar,
 *  - volume, modo de áudio, trilha/efeito sonoro e transição.
 * Salva em videoEdits (localStorage). O player ao vivo honra via applyVideoEdit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Scissors, Plus, Trash2, Play, Pause, Volume2, X, Save, Activity, Music, Loader2,
  ZoomIn, ZoomOut, ChevronsLeft,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui';
import { apiUrl } from '../lib/api';
import {
  getVideoEdit, defaultVideoEdit, saveVideoEdit, fileToDataUrl,
  type VideoEdit, type VideoSegment, type AudioMode,
} from '../core/videoEdits';

interface VideoEditorProps {
  videoId: string;
  label?: string;
  onClose?: () => void;
  /** Embutido na página (Palco) em vez de modal sobreposto. */
  embedded?: boolean;
}

type DragTarget = { index: number; edge: 'start' | 'end' } | null;

function fmt(t: number): string {
  if (!Number.isFinite(t)) return '0.00s';
  return `${t.toFixed(2)}s`;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export default function VideoEditor({ videoId, label, onClose, embedded = false }: VideoEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const [edit, setEdit] = useState<VideoEdit>(() => getVideoEdit(videoId) ?? defaultVideoEdit(videoId));
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [drag, setDrag] = useState<DragTarget>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [loadingWave, setLoadingWave] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [saved, setSaved] = useState(false);
  const [selectedSeg, setSelectedSeg] = useState<number | null>(null);
  const [zoom, setZoom] = useState(40); // pixels por segundo
  const [fitZoom, setFitZoom] = useState(40);
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(true);

  const previewSegRef = useRef(0);
  const durationInitRef = useRef(false);
  const src = useMemo(() => apiUrl(`/api/video/play/${videoId}`), [videoId]);
  const segments = edit.segments;
  const trackWidth = Math.max(640, duration * zoom);

  // Alguns MP4 transmitidos só informam a duração no evento durationchange (e às
  // vezes como Infinity até tocar). Trata ambos os eventos e força resolução.
  const applyDuration = useCallback((d: number) => {
    if (!Number.isFinite(d) || d <= 0) return;
    setDuration(d);
    const z = clamp(Math.round(760 / d), 8, 120);
    setFitZoom(z);
    if (!durationInitRef.current) { setZoom(z); durationInitRef.current = true; }
  }, []);

  // Se a duração não resolver (mp4 streamed), "cutuca" buscando p/ o fim.
  const nudgeDuration = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!Number.isFinite(v.duration) || v.duration <= 0) {
      try { v.currentTime = 1e6; } catch { /* ignore */ }
    }
  }, []);

  // Baixa o clipe como Blob e toca por blob URL — o stream /api/video/play não
  // expõe duração/range confiável, então o <video> ficava em 0.00s e sem seek
  // preciso. Com o blob local, a duração resolve e o corte fica frame-a-frame.
  useEffect(() => {
    let url = '';
    let cancelled = false;
    setLoadingVideo(true);
    setBlobSrc(null);
    durationInitRef.current = false;
    fetch(src)
      .then((r) => r.blob())
      .then((b) => { if (cancelled) return; url = URL.createObjectURL(b); setBlobSrc(url); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoadingVideo(false); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [src]);

  const updateSegments = useCallback((next: VideoSegment[]) => {
    setEdit((e) => ({ ...e, segments: [...next].sort((a, b) => a.startSec - b.startSec) }));
  }, []);

  const patchSegment = useCallback((index: number, patch: Partial<VideoSegment>) => {
    setEdit((e) => {
      const segs = e.segments.slice();
      const seg = segs[index];
      if (!seg) return e;
      let startSec = patch.startSec !== undefined ? clamp(round2(patch.startSec), 0, duration || patch.startSec) : seg.startSec;
      let endSec = patch.endSec !== undefined ? clamp(round2(patch.endSec), 0, duration || patch.endSec) : seg.endSec;
      if (endSec <= startSec) {
        if (patch.startSec !== undefined) startSec = Math.max(0, endSec - 0.05);
        else endSec = startSec + 0.05;
      }
      segs[index] = { startSec, endSec };
      return { ...e, segments: segs };
    });
  }, [duration]);

  // ── tempo <-> pixel (na faixa interna, considerando scroll) ──────────────────
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

  // Marcar in/out no playhead atual.
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

  // Arrasto dos handles (espaço em px com zoom/scroll).
  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      const t = pxToTime(ev.clientX);
      patchSegment(drag.index, drag.edge === 'start' ? { startSec: t } : { endSec: t });
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [drag, pxToTime, patchSegment]);

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

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    setCurrentTime(v.currentTime);
    if (!previewing || segments.length === 0) return;
    let idx = previewSegRef.current;
    if (idx >= segments.length) idx = segments.length - 1;
    const seg = segments[idx];
    if (v.currentTime >= seg.endSec) {
      if (idx + 1 < segments.length) { previewSegRef.current = idx + 1; v.currentTime = segments[idx + 1].startSec; }
      else { v.pause(); setPreviewing(false); setPlaying(false); }
    }
  }, [previewing, segments]);

  const playPreview = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (segments.length > 0) { previewSegRef.current = 0; v.currentTime = segments[0].startSec; setPreviewing(true); }
    v.muted = edit.audioMode !== 'original'; v.volume = edit.volume;
    void v.play().catch(() => undefined); setPlaying(true);
  }, [segments, edit.audioMode, edit.volume]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) { setPreviewing(false); v.muted = edit.audioMode !== 'original'; v.volume = edit.volume; void v.play().catch(() => undefined); setPlaying(true); }
    else { v.pause(); setPlaying(false); setPreviewing(false); }
  }, [edit.audioMode, edit.volume]);

  // ── waveform (sob demanda) ───────────────────────────────────────────────────
  const loadWaveform = useCallback(async () => {
    setLoadingWave(true);
    try {
      const res = await fetch(src); const buf = await res.arrayBuffer();
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx(); const audio = await ctx.decodeAudioData(buf);
      const ch = audio.getChannelData(0); const N = 600; const block = Math.floor(ch.length / N) || 1; const out: number[] = [];
      for (let i = 0; i < N; i++) { let max = 0; for (let j = 0; j < block; j++) { const v = Math.abs(ch[i * block + j] || 0); if (v > max) max = v; } out.push(max); }
      void ctx.close(); setPeaks(out);
    } catch { setPeaks(null); } finally { setLoadingWave(false); }
  }, [src]);

  const onPickAudio = useCallback(async (file: File | undefined) => {
    if (!file) return; setAudioError('');
    try { const url = await fileToDataUrl(file); setEdit((e) => ({ ...e, trackUrl: url, audioMode: 'track' })); }
    catch (err) { setAudioError(err instanceof Error ? err.message : 'Falha ao carregar áudio'); }
  }, []);

  const handleSave = useCallback(() => { saveVideoEdit(edit); setSaved(true); setTimeout(() => setSaved(false), 1800); }, [edit]);

  // Atalhos de teclado (setas = passo, i/o = marcar, espaço = play).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -1 : -0.1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 1 : 0.1); }
      else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); markIn(); }
      else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); markOut(); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, markIn, markOut, togglePlay]);

  return (
    <div
      className={embedded ? 'flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0d10]' : 'fixed inset-0 z-50 flex flex-col bg-[#050608]/95 p-3 lg:p-5'}
      style={embedded ? undefined : { backdropFilter: 'blur(4px)' }}
    >
      <div className={embedded ? 'contents' : 'mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0d10]'}>
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3">
          <Scissors className="h-4 w-4 text-[var(--violet,#8b7cf6)]" />
          <span className="text-sm font-semibold text-white">Editar vídeo</span>
          <span className="truncate text-xs text-slate-500">— {label || videoId}</span>
          {!embedded && (
            <button onClick={() => onClose?.()} className="ml-auto text-slate-400 hover:text-white" aria-label="Fechar"><X className="h-5 w-5" /></button>
          )}
        </div>

        <div className={embedded ? 'p-5 space-y-4' : 'min-h-0 flex-1 overflow-y-auto p-5 space-y-4'}>
          {/* Preview */}
          <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-black" style={{ aspectRatio: '16 / 9' }}>
            {blobSrc && (
              <video
                ref={videoRef} src={blobSrc} playsInline preload="metadata" className="h-full w-full object-contain"
                onLoadedMetadata={(e) => { applyDuration(e.currentTarget.duration); if (!Number.isFinite(e.currentTarget.duration) || e.currentTarget.duration <= 0) nudgeDuration(); }}
                onDurationChange={(e) => applyDuration(e.currentTarget.duration)}
                onSeeked={(e) => { if (durationInitRef.current) return; applyDuration(e.currentTarget.duration); try { e.currentTarget.currentTime = 0; } catch { /* ignore */ } }}
                onTimeUpdate={onTimeUpdate} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)}
              />
            )}
            {loadingVideo && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-[11px] text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> carregando vídeo…
              </div>
            )}
          </div>

          {/* Transport preciso */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-[#07080a] p-2.5">
            <button className="rounded-lg border border-white/8 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-white/5" onClick={() => seekTo(0)} title="Início"><ChevronsLeft className="h-3.5 w-3.5" /></button>
            <button className="rounded-lg border border-white/8 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/5" onClick={() => step(-1)}>−1s</button>
            <button className="rounded-lg border border-white/8 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/5" onClick={() => step(-0.1)}>−0,1s</button>
            <button className="rounded-lg bg-[var(--violet,#8b7cf6)] px-3 py-1.5 text-white" onClick={togglePlay}>{playing && !previewing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button>
            <button className="rounded-lg border border-white/8 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/5" onClick={() => step(0.1)}>+0,1s</button>
            <button className="rounded-lg border border-white/8 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/5" onClick={() => step(1)}>+1s</button>
            <span className="ml-1 font-mono text-[12px] text-violet-300">{fmt(currentTime)}<span className="text-slate-600"> / {fmt(duration)}</span></span>
            <div className="ml-auto flex items-center gap-2">
              <button className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20" onClick={markIn} title="Marcar início no tempo atual (tecla I)">⟦ Marcar início</button>
              <button className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20" onClick={markOut} title="Marcar fim no tempo atual (tecla O)">Marcar fim ⟧</button>
            </div>
          </div>

          {/* Timeline com zoom + rolagem */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Cortes (arraste as bordas, ou use os campos)</span>
              <div className="flex items-center gap-2">
                {!peaks && (
                  <button onClick={() => void loadWaveform()} disabled={loadingWave} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300">
                    {loadingWave ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}forma de onda
                  </button>
                )}
                <button onClick={() => setZoom((z) => clamp(round2(z / 1.5), 4, 400))} className="text-slate-500 hover:text-slate-300" title="Menos zoom"><ZoomOut className="h-3.5 w-3.5" /></button>
                <button onClick={() => setZoom(fitZoom)} className="text-[10px] text-slate-500 hover:text-slate-300" title="Ajustar">fit</button>
                <button onClick={() => setZoom((z) => clamp(round2(z * 1.5), 4, 400))} className="text-slate-500 hover:text-slate-300" title="Mais zoom"><ZoomIn className="h-3.5 w-3.5" /></button>
                <button onClick={addSegment} className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300"><Plus className="h-3 w-3" />segmento</button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#07080a]">
              <div
                ref={trackRef}
                onClick={(e) => { if (!drag) seekTo(pxToTime(e.clientX)); }}
                className="relative h-20 cursor-text"
                style={{ width: trackWidth }}
              >
                {/* waveform */}
                {peaks && (
                  <div className="pointer-events-none absolute inset-0 flex items-center gap-px px-px opacity-35">
                    {peaks.map((p, i) => (<div key={i} className="flex-1 bg-slate-500" style={{ height: `${Math.max(3, p * 100)}%` }} />))}
                  </div>
                )}
                {/* régua de segundos */}
                {duration > 0 && zoom >= 12 && Array.from({ length: Math.floor(duration) + 1 }).map((_, s) => (
                  <div key={s} className="pointer-events-none absolute top-0 bottom-0 border-l border-white/5" style={{ left: s * zoom }}>
                    <span className="absolute top-0.5 left-1 text-[8px] text-slate-600">{s}s</span>
                  </div>
                ))}
                {/* segmentos */}
                {segments.map((seg, i) => (
                  <div
                    key={i}
                    onClick={(e) => { e.stopPropagation(); setSelectedSeg(i); }}
                    className={cn('absolute top-0 h-full', selectedSeg === i ? 'bg-[rgba(232,193,120,0.22)]' : 'bg-[rgba(125,211,252,0.14)]')}
                    style={{ left: seg.startSec * zoom, width: Math.max(2, (seg.endSec - seg.startSec) * zoom), boxShadow: selectedSeg === i ? 'inset 0 0 0 1px var(--gold,#7dd3fc)' : undefined }}
                  >
                    <span
                      onPointerDown={(e) => { e.stopPropagation(); setSelectedSeg(i); setDrag({ index: i, edge: 'start' }); }}
                      className="absolute left-0 top-0 h-full w-2 -translate-x-1 cursor-ew-resize bg-[var(--gold,#7dd3fc)]" title="Arrastar início"
                    />
                    <span
                      onPointerDown={(e) => { e.stopPropagation(); setSelectedSeg(i); setDrag({ index: i, edge: 'end' }); }}
                      className="absolute right-0 top-0 h-full w-2 translate-x-1 cursor-ew-resize bg-[var(--gold,#7dd3fc)]" title="Arrastar fim"
                    />
                    <span className="absolute left-1 top-1 rounded bg-black/50 px-1 text-[8px] font-mono text-white/70">#{i + 1}</span>
                  </div>
                ))}
                {/* playhead */}
                <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-orange-500" style={{ left: currentTime * zoom }}>
                  <span className="absolute -top-0 -left-[3px] h-2 w-2 rounded-full bg-orange-500" />
                </div>
                {segments.length === 0 && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-slate-600">Vídeo inteiro · posicione o playhead e clique “Marcar início / fim”, ou “+ segmento”.</div>
                )}
              </div>
            </div>

            {/* lista de segmentos com campos numéricos exatos */}
            {segments.length > 0 && (
              <div className="space-y-1 pt-1">
                {segments.map((seg, i) => (
                  <div
                    key={i}
                    onClick={() => setSelectedSeg(i)}
                    className={cn('flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px]', selectedSeg === i ? 'border-[var(--gold,#7dd3fc)]/40 bg-white/[0.03]' : 'border-white/8')}
                  >
                    <span className="font-mono text-slate-400">#{i + 1}</span>
                    <label className="flex items-center gap-1 text-slate-500">início
                      <input type="number" step={0.05} min={0} max={duration || undefined} value={seg.startSec}
                        onChange={(e) => patchSegment(i, { startSec: Number(e.target.value) })}
                        className="w-20 rounded border border-white/10 bg-[#0b0d10] px-1.5 py-1 font-mono text-slate-200 focus:border-violet-500/40 focus:outline-none" />
                    </label>
                    <label className="flex items-center gap-1 text-slate-500">fim
                      <input type="number" step={0.05} min={0} max={duration || undefined} value={seg.endSec}
                        onChange={(e) => patchSegment(i, { endSec: Number(e.target.value) })}
                        className="w-20 rounded border border-white/10 bg-[#0b0d10] px-1.5 py-1 font-mono text-slate-200 focus:border-violet-500/40 focus:outline-none" />
                    </label>
                    <span className="text-slate-600">({fmt(seg.endSec - seg.startSec)})</span>
                    <button onClick={(e) => { e.stopPropagation(); seekTo(seg.startSec); }} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/5">ir</button>
                    <button onClick={(e) => { e.stopPropagation(); removeSegment(i); }} className="ml-auto text-slate-600 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Áudio + transição */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-[#07080a] p-3 space-y-3">
              <div className="flex items-center gap-2"><Volume2 className="h-3.5 w-3.5 text-sky-400" /><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Áudio</span></div>
              <div className="flex flex-wrap gap-1">
                {(['muted', 'original', 'track'] as AudioMode[]).map((m) => (
                  <button key={m} onClick={() => setEdit((e) => ({ ...e, audioMode: m }))}
                    className={cn('rounded-lg border px-2.5 py-1 text-[11px] transition', edit.audioMode === m ? 'border-violet-500/50 bg-violet-500/15 text-violet-300' : 'border-white/8 text-slate-500 hover:text-slate-300')}>
                    {m === 'muted' ? 'Mudo' : m === 'original' ? 'Original' : 'Trilha'}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between"><span className="text-[10px] text-slate-500">Volume</span><span className="font-mono text-[10px] text-violet-300">{Math.round(edit.volume * 100)}%</span></div>
                <input type="range" min={0} max={1} step={0.05} value={edit.volume} onChange={(e) => setEdit((ed) => ({ ...ed, volume: Number(e.target.value) }))} className="w-full accent-violet-500" />
              </div>
              {edit.audioMode === 'track' && (
                <div className="space-y-2 rounded-lg border border-white/8 p-2">
                  <div className="flex items-center gap-2 text-[10px] text-slate-500"><Music className="h-3 w-3" /> Trilha / efeito sonoro</div>
                  <input type="file" accept="audio/*" onChange={(e) => void onPickAudio(e.target.files?.[0])} className="block w-full text-[10px] text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-violet-500/20 file:px-2 file:py-1 file:text-violet-300" />
                  <input type="text" placeholder="ou cole uma URL de áudio (https://…)" value={edit.trackUrl && !edit.trackUrl.startsWith('data:') ? edit.trackUrl : ''} onChange={(e) => setEdit((ed) => ({ ...ed, trackUrl: e.target.value || undefined }))} className="w-full rounded-lg border border-white/8 bg-[#0b0d10] px-2 py-1 text-[11px] text-slate-300 focus:border-violet-500/40 focus:outline-none" />
                  {edit.trackUrl && (<div className="flex items-center justify-between text-[10px] text-emerald-400"><span>{edit.trackUrl.startsWith('data:') ? 'áudio carregado ✓' : 'URL definida ✓'}</span><button onClick={() => setEdit((ed) => ({ ...ed, trackUrl: undefined }))} className="text-slate-600 hover:text-red-400">remover</button></div>)}
                  <label className="flex items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={Boolean(edit.trackLoop)} onChange={(e) => setEdit((ed) => ({ ...ed, trackLoop: e.target.checked }))} />repetir (loop)</label>
                  {audioError && <p className="text-[10px] text-red-400">{audioError}</p>}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-[#07080a] p-3 space-y-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Transição (ao entrar)</span>
              <div className="space-y-1">
                <div className="flex items-center justify-between"><span className="text-[10px] text-slate-500">Duração</span><span className="font-mono text-[10px] text-violet-300">{edit.transitionMs}ms</span></div>
                <input type="range" min={0} max={2000} step={20} value={edit.transitionMs} onChange={(e) => setEdit((ed) => ({ ...ed, transitionMs: Number(e.target.value) }))} className="w-full accent-violet-500" />
              </div>
              <p className="text-[10px] text-slate-600">Atalhos: ← → (passo), Shift+← → (1s), I (início), O (fim), espaço (play). As edições valem sempre que o vídeo tocar.</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-white/10 px-5 py-3">
          <Button variant="primary" size="sm" onClick={handleSave}><Save className="h-3.5 w-3.5 mr-1" />{saved ? 'Salvo!' : 'Salvar edição'}</Button>
          <Button variant="secondary" size="sm" onClick={playPreview} disabled={segments.length === 0}><Play className="h-3.5 w-3.5 mr-1" />Prévia dos cortes</Button>
          {!embedded && (
            <button onClick={() => onClose?.()} className="ml-auto text-[11px] text-slate-500 hover:text-slate-300">Fechar</button>
          )}
        </div>
      </div>
    </div>
  );
}
