import type { RefObject } from 'react';
import { cn } from '../../lib/utils';
import type { VideoSegment } from '../../core/videoEdits';

export interface TimelineProps {
  trackRef: RefObject<HTMLDivElement | null>;
  duration: number;
  zoom: number;
  segments: VideoSegment[];
  selectedSeg: number | null;
  currentTime: number;
  peaks: number[] | null;
  frames: string[];
  dragging: boolean;
  onSeek: (clientX: number) => void;
  onSelect: (index: number) => void;
  onDragStart: (index: number, edge: 'start' | 'end') => void;
}

/** Faixa de vídeo com miniaturas, forma de onda, régua, cortes arrastáveis e playhead. */
export function Timeline({
  trackRef,
  duration,
  zoom,
  segments,
  selectedSeg,
  currentTime,
  peaks,
  frames,
  dragging,
  onSeek,
  onSelect,
  onDragStart,
}: TimelineProps) {
  const trackWidth = Math.max(640, duration * zoom);
  const hasCuts = segments.length > 0;

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border2)] bg-[var(--bg)]">
      <div
        ref={trackRef}
        onClick={(e) => {
          if (!dragging) onSeek(e.clientX);
        }}
        className="relative h-24 cursor-text select-none"
        style={{ width: trackWidth }}
      >
        {/* miniaturas */}
        {frames.length > 0 && (
          <div className="pointer-events-none absolute inset-0 flex opacity-70">
            {frames.map((src, i) => (
              <div
                key={i}
                className="h-full flex-1 bg-cover bg-center"
                style={{ backgroundImage: `url(${src})` }}
              />
            ))}
          </div>
        )}
        {/* fora dos cortes fica escurecido: o que não toca */}
        {hasCuts && <div className="pointer-events-none absolute inset-0 bg-black/55" />}
        {/* forma de onda */}
        {peaks && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-8 items-end gap-px px-px opacity-60">
            {peaks.map((p, i) => (
              <div key={i} className="flex-1 bg-[var(--sky)]" style={{ height: `${Math.max(4, p * 100)}%` }} />
            ))}
          </div>
        )}
        {/* régua */}
        {duration > 0 &&
          zoom >= 12 &&
          Array.from({ length: Math.floor(duration) + 1 }).map((_, s) => (
            <div key={s} className="pointer-events-none absolute bottom-0 top-0 border-l border-white/10" style={{ left: s * zoom }}>
              <span className="absolute left-1 top-0.5 font-mono text-[9px] text-white/60">{s}s</span>
            </div>
          ))}
        {/* cortes */}
        {segments.map((seg, i) => {
          const selected = selectedSeg === i;
          return (
            <div
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(i);
              }}
              className={cn(
                'absolute top-0 h-full border-y-2',
                selected ? 'border-[var(--sky)] bg-[var(--sky)]/20' : 'border-[var(--sky)]/50 bg-[var(--sky)]/10',
              )}
              style={{ left: seg.startSec * zoom, width: Math.max(2, (seg.endSec - seg.startSec) * zoom) }}
            >
              <span
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(i);
                  onDragStart(i, 'start');
                }}
                className="absolute left-0 top-0 h-full w-2 -translate-x-1 cursor-ew-resize rounded-l bg-[var(--sky)]"
                title="Arrastar início"
              />
              <span
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(i);
                  onDragStart(i, 'end');
                }}
                className="absolute right-0 top-0 h-full w-2 translate-x-1 cursor-ew-resize rounded-r bg-[var(--sky)]"
                title="Arrastar fim"
              />
              <span className="absolute bottom-1 left-2 rounded bg-black/70 px-1.5 font-mono text-[10px] font-bold text-white">
                #{i + 1}
                {seg.speed && seg.speed !== 1 ? ` · ${seg.speed}×` : ''}
              </span>
            </div>
          );
        })}
        {/* playhead */}
        <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-orange-500" style={{ left: currentTime * zoom }}>
          <span className="absolute -left-[3px] top-0 h-2 w-2 rounded-full bg-orange-500" />
        </div>
        {!hasCuts && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] text-white/70">
            Vídeo inteiro. Posicione o playhead e use S (dividir), I/O (marcar) ou “+ corte”.
          </div>
        )}
      </div>
    </div>
  );
}
