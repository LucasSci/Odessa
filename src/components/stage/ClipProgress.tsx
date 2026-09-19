import { usePlaybackProgress } from '../../core/playback/progressStore';

function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

/** Barra de progresso do clip no ar. Assina o store, então só ela re-renderiza. */
export function ClipProgress({ videoId, nextLabel }: { videoId?: string | null; nextLabel?: string | null }) {
  const progress = usePlaybackProgress();
  const active = progress && videoId && progress.videoId === videoId ? progress : null;
  const ratio = active ? Math.min(1, active.elapsedSec / active.totalSec) : 0;
  const remaining = active ? active.totalSec - active.elapsedSec : null;

  return (
    <div className="mt-3">
      <div
        role="progressbar"
        aria-label="Progresso do clip no ar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        className="h-1.5 overflow-hidden rounded-full bg-[var(--bg4)]"
      >
        <div className="h-full rounded-full bg-[image:var(--accent-grad)]" style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[10px] text-[var(--t3)]">
        <span>{active ? `restam ${formatRemaining(remaining ?? 0)}` : '—'}</span>
        {nextLabel && <span className="min-w-0 truncate">a seguir: {nextLabel}</span>}
      </div>
    </div>
  );
}
