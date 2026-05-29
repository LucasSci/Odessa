/**
 * VideoEditor — editor de vídeo por clipe (Fase 4).
 *
 * Edita, por vídeo: cortes (múltiplos segmentos, inclusive remover o meio),
 * volume, modo de áudio, trilha/efeito sonoro e transição. Salva em videoEdits
 * (localStorage). O player ao vivo honra essas edições via applyVideoEdit.
 *
 * Modal full-screen, carregado sob demanda (lazy) a partir da Biblioteca.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, Plus, Trash2, Play, Pause, Volume2, X, Save, Activity, Music, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui';
import { apiUrl } from '../lib/api';
import {
  getVideoEdit,
  defaultVideoEdit,
  saveVideoEdit,
  fileToDataUrl,
  type VideoEdit,
  type VideoSegment,
  type AudioMode,
} from '../core/videoEdits';

interface VideoEditorProps {
  videoId: string;
  label?: string;
  onClose: () => void;
}

type DragTarget = { index: number; edge: 'start' | 'end' } | null;

function fmt(t: number): string {
  if (!Number.isFinite(t)) return '0.0s';
  return `${t.toFixed(1)}s`;
}

export default function VideoEditor({ videoId, label, onClose }: VideoEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

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

  const previewSegRef = useRef(0);
  const src = useMemo(() => apiUrl(`/api/video/play/${videoId}`), [videoId]);

  const segments = edit.segments;

  // ── tempo <-> pixel ──────────────────────────────────────────────────────────
  const timeToPct = useCallback((t: number) => (duration > 0 ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0), [duration]);

  const xToTime = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar || duration <= 0) return 0;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(ratio * duration * 10) / 10;
    },
    [duration],
  );

  // ── edição dos segmentos ───────────────────────────────────────────────────
  const updateSegments = useCallback((next: VideoSegment[]) => {
    setEdit((e) => ({ ...e, segments: next }));
  }, []);

  const addSegment = useCallback(() => {
    const from = Math.min(currentTime, Math.max(0, duration - 1));
    const to = Math.min(duration || from + 2, from + 2);
    if (to <= from) return;
    updateSegments([...segments, { startSec: Math.round(from * 10) / 10, endSec: Math.round(to * 10) / 10 }].sort((a, b) => a.startSec - b.startSec));
  }, [currentTime, duration, segments, updateSegments]);

  const removeSegment = useCallback((index: number) => {
    updateSegments(segments.filter((_, i) => i !== index));
  }, [segments, updateSegments]);

  // Arrasto dos handles
  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      const t = xToTime(ev.clientX);
      setEdit((e) => {
        const segs = e.segments.slice();
        const seg = { ...segs[drag.index] };
        if (!seg) return e;
        if (drag.edge === 'start') seg.startSec = Math.max(0, Math.min(t, seg.endSec - 0.1));
        else seg.endSec = Math.min(duration || t, Math.max(t, seg.startSec + 0.1));
        segs[drag.index] = seg;
        return { ...e, segments: segs };
      });
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, duration, xToTime]);

  // ── reprodução / prévia dos cortes ───────────────────────────────────────────
  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (!previewing || segments.length === 0) return;
    let idx = previewSegRef.current;
    if (idx >= segments.length) idx = segments.length - 1;
    const seg = segments[idx];
    if (v.currentTime >= seg.endSec) {
      if (idx + 1 < segments.length) {
        previewSegRef.current = idx + 1;
        v.currentTime = segments[idx + 1].startSec;
      } else {
        v.pause();
        setPreviewing(false);
        setPlaying(false);
      }
    }
  }, [previewing, segments]);

  const playPreview = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (segments.length > 0) {
      previewSegRef.current = 0;
      v.currentTime = segments[0].startSec;
      setPreviewing(true);
    }
    v.muted = edit.audioMode !== 'original';
    v.volume = edit.volume;
    void v.play().catch(() => undefined);
    setPlaying(true);
  }, [segments, edit.audioMode, edit.volume]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      setPreviewing(false);
      v.muted = edit.audioMode !== 'original';
      v.volume = edit.volume;
      void v.play().catch(() => undefined);
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
      setPreviewing(false);
    }
  }, [edit.audioMode, edit.volume]);

  // ── waveform (sob demanda) ───────────────────────────────────────────────────
  const loadWaveform = useCallback(async () => {
    setLoadingWave(true);
    try {
      const res = await fetch(src);
      const buf = await res.arrayBuffer();
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const audio = await ctx.decodeAudioData(buf);
      const ch = audio.getChannelData(0);
      const N = 240;
      const block = Math.floor(ch.length / N) || 1;
      const out: number[] = [];
      for (let i = 0; i < N; i++) {
        let max = 0;
        for (let j = 0; j < block; j++) {
          const v = Math.abs(ch[i * block + j] || 0);
          if (v > max) max = v;
        }
        out.push(max);
      }
      void ctx.close();
      setPeaks(out);
    } catch {
      setPeaks(null);
    } finally {
      setLoadingWave(false);
    }
  }, [src]);

  // ── anexar áudio ─────────────────────────────────────────────────────────────
  const onPickAudio = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setAudioError('');
    try {
      const url = await fileToDataUrl(file);
      setEdit((e) => ({ ...e, trackUrl: url, audioMode: 'track' }));
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Falha ao carregar áudio');
    }
  }, []);

  const handleSave = useCallback(() => {
    saveVideoEdit(edit);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }, [edit]);

  const seekBarClick = useCallback(
    (ev: React.MouseEvent) => {
      if (drag) return;
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = xToTime(ev.clientX);
      setPreviewing(false);
    },
    [drag, xToTime],
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#050608]/95 backdrop-blur-sm p-4 lg:p-6">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0d10]">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3">
          <Scissors className="h-4 w-4 text-[var(--gold,#e8b864)]" />
          <span className="text-sm font-semibold text-white">Editar vídeo</span>
          <span className="truncate text-xs text-slate-500">— {label || videoId}</span>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-white" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
          {/* Preview */}
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black">
            <video
              ref={videoRef}
              src={src}
              playsInline
              className="h-full w-full object-contain"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
              onTimeUpdate={onTimeUpdate}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
            />
          </div>

          {/* Transport */}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={togglePlay}>
              {playing && !previewing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="primary" onClick={playPreview} disabled={segments.length === 0}>
              <Play className="h-3.5 w-3.5 mr-1" />Prévia dos cortes
            </Button>
            <span className="ml-auto font-mono text-[11px] text-slate-400">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
          </div>

          {/* Timeline */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Cortes (segmentos)</span>
              <div className="flex items-center gap-2">
                {!peaks && (
                  <button
                    onClick={() => void loadWaveform()}
                    disabled={loadingWave}
                    className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
                  >
                    {loadingWave ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                    forma de onda
                  </button>
                )}
                <button onClick={addSegment} className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300">
                  <Plus className="h-3 w-3" /> segmento
                </button>
              </div>
            </div>

            {/* Barra */}
            <div
              ref={barRef}
              onClick={seekBarClick}
              className="relative h-16 w-full cursor-pointer overflow-hidden rounded-lg border border-white/10 bg-[#07080a]"
            >
              {/* waveform */}
              {peaks && (
                <div className="absolute inset-0 flex items-center gap-px px-px opacity-40">
                  {peaks.map((p, i) => (
                    <div key={i} className="flex-1 bg-slate-500" style={{ height: `${Math.max(3, p * 100)}%` }} />
                  ))}
                </div>
              )}
              {/* segmentos */}
              {segments.map((seg, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full border-x-2 border-[var(--gold,#e8b864)] bg-[var(--gold,#e8b864)]/20"
                  style={{ left: `${timeToPct(seg.startSec)}%`, width: `${timeToPct(seg.endSec) - timeToPct(seg.startSec)}%` }}
                >
                  <span
                    onPointerDown={(e) => { e.stopPropagation(); setDrag({ index: i, edge: 'start' }); }}
                    className="absolute left-0 top-0 h-full w-2 -translate-x-1 cursor-ew-resize bg-[var(--gold,#e8b864)]"
                    title="Início do corte"
                  />
                  <span
                    onPointerDown={(e) => { e.stopPropagation(); setDrag({ index: i, edge: 'end' }); }}
                    className="absolute right-0 top-0 h-full w-2 translate-x-1 cursor-ew-resize bg-[var(--gold,#e8b864)]"
                    title="Fim do corte"
                  />
                </div>
              ))}
              {/* playhead */}
              <div className="absolute top-0 z-10 h-full w-0.5 bg-orange-500" style={{ left: `${timeToPct(currentTime)}%` }} />
              {segments.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-600">
                  Vídeo inteiro (sem corte). Clique em “segmento” para recortar trechos.
                </div>
              )}
            </div>

            {/* lista de segmentos */}
            {segments.length > 0 && (
              <div className="space-y-1">
                {segments.map((seg, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="font-mono text-slate-400">#{i + 1}</span>
                    <span className="font-mono text-slate-300">{fmt(seg.startSec)} → {fmt(seg.endSec)}</span>
                    <span className="text-slate-600">({fmt(seg.endSec - seg.startSec)})</span>
                    <button onClick={() => removeSegment(i)} className="ml-auto text-slate-600 hover:text-red-400">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Áudio + transição */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-[#07080a] p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Volume2 className="h-3.5 w-3.5 text-sky-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Áudio</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {(['muted', 'original', 'track'] as AudioMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setEdit((e) => ({ ...e, audioMode: m }))}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-[11px] transition',
                      edit.audioMode === m
                        ? 'border-violet-500/50 bg-violet-500/15 text-violet-300'
                        : 'border-white/8 text-slate-500 hover:text-slate-300',
                    )}
                  >
                    {m === 'muted' ? 'Mudo' : m === 'original' ? 'Original' : 'Trilha'}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Volume</span>
                  <span className="font-mono text-[10px] text-violet-300">{Math.round(edit.volume * 100)}%</span>
                </div>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={edit.volume}
                  onChange={(e) => setEdit((ed) => ({ ...ed, volume: Number(e.target.value) }))}
                  className="w-full accent-violet-500"
                />
              </div>
              {edit.audioMode === 'track' && (
                <div className="space-y-2 rounded-lg border border-white/8 p-2">
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <Music className="h-3 w-3" /> Trilha / efeito sonoro
                  </div>
                  <label className="block">
                    <span className="text-[10px] text-slate-500">Arquivo curto (até ~1 MB)</span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => void onPickAudio(e.target.files?.[0])}
                      className="mt-1 block w-full text-[10px] text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-violet-500/20 file:px-2 file:py-1 file:text-violet-300"
                    />
                  </label>
                  <input
                    type="text"
                    placeholder="ou cole uma URL de áudio (https://…)"
                    value={edit.trackUrl && !edit.trackUrl.startsWith('data:') ? edit.trackUrl : ''}
                    onChange={(e) => setEdit((ed) => ({ ...ed, trackUrl: e.target.value || undefined }))}
                    className="w-full rounded-lg border border-white/8 bg-[#0b0d10] px-2 py-1 text-[11px] text-slate-300 focus:border-violet-500/40 focus:outline-none"
                  />
                  {edit.trackUrl && (
                    <div className="flex items-center justify-between text-[10px] text-emerald-400">
                      <span>{edit.trackUrl.startsWith('data:') ? 'áudio carregado ✓' : 'URL definida ✓'}</span>
                      <button onClick={() => setEdit((ed) => ({ ...ed, trackUrl: undefined }))} className="text-slate-600 hover:text-red-400">remover</button>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-[11px] text-slate-400">
                    <input type="checkbox" checked={Boolean(edit.trackLoop)} onChange={(e) => setEdit((ed) => ({ ...ed, trackLoop: e.target.checked }))} />
                    repetir (loop)
                  </label>
                  {audioError && <p className="text-[10px] text-red-400">{audioError}</p>}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-[#07080a] p-3 space-y-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Transição (ao entrar)</span>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Duração</span>
                  <span className="font-mono text-[10px] text-violet-300">{edit.transitionMs}ms</span>
                </div>
                <input
                  type="range" min={0} max={2000} step={20}
                  value={edit.transitionMs}
                  onChange={(e) => setEdit((ed) => ({ ...ed, transitionMs: Number(e.target.value) }))}
                  className="w-full accent-violet-500"
                />
              </div>
              <p className="text-[10px] text-slate-600">
                As edições valem sempre que este vídeo tocar — inclusive quando a Diretora o escolhe.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-white/10 px-5 py-3">
          <Button variant="primary" size="sm" onClick={handleSave}>
            <Save className="h-3.5 w-3.5 mr-1" />{saved ? 'Salvo!' : 'Salvar edição'}
          </Button>
          <button onClick={onClose} className="text-[11px] text-slate-500 hover:text-slate-300">Fechar</button>
        </div>
      </div>
    </div>
  );
}
