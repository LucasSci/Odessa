import { useMemo } from 'react';
import { Scissors } from 'lucide-react';
import { categorizeVideo, VIDEO_ROTEIRO } from '../../core/videoRoteiro';
import { cn } from '../../lib/utils';

export interface DeckVideo {
  id: string;
  label: string;
  loop?: boolean;
  /** URL usada só para a miniatura (primeiro frame). */
  thumbSrc: string;
  edited?: boolean;
}

export interface DeckGroup {
  key: string;
  label: string;
  videos: DeckVideo[];
}

/** Agrupa por categoria do roteiro (Idle/Gatilho/Transição/Especial) e devolve o resto em "Outros". */
export function groupDeckVideos(videos: Array<DeckVideo & { id: string }>): DeckGroup[] {
  const buckets = new Map<string, DeckVideo[]>();
  for (const video of videos) {
    const key = categorizeVideo(video) ?? 'outros';
    const list = buckets.get(key);
    if (list) list.push(video);
    else buckets.set(key, [video]);
  }
  const groups: DeckGroup[] = VIDEO_ROTEIRO.filter((cat) => buckets.has(cat.key)).map((cat) => ({
    key: cat.key,
    label: cat.label,
    videos: buckets.get(cat.key)!,
  }));
  if (buckets.has('outros')) groups.push({ key: 'outros', label: 'Outros', videos: buckets.get('outros')! });
  return groups;
}

/** Ordem plana dos pads — a mesma usada pelos atalhos 1-9. */
export function deckOrder(groups: DeckGroup[]): DeckVideo[] {
  return groups.flatMap((group) => group.videos);
}

export function ClipDeck({
  groups,
  activeVideoId,
  busy,
  onPlay,
  onEdit,
}: {
  groups: DeckGroup[];
  activeVideoId?: string | null;
  busy?: boolean;
  onPlay: (videoId: string) => void;
  onEdit: (videoId: string, label: string) => void;
}) {
  const order = useMemo(() => deckOrder(groups), [groups]);

  if (order.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border2)] p-6 text-center text-sm text-[var(--t3)]">
        Nenhum clip na biblioteca desta persona ainda. Gere ou envie vídeos em Biblioteca.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--t3)]">
            {group.label}
            <span className="font-mono text-[var(--t4)]">{group.videos.length}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {group.videos.map((video) => {
              const index = order.indexOf(video);
              const live = video.id === activeVideoId;
              return (
                <div
                  key={video.id}
                  className={cn(
                    'group relative overflow-hidden rounded-xl border bg-black transition',
                    live
                      ? 'border-[var(--sky)] shadow-[0_0_0_1px_var(--sky),var(--shadow-live)]'
                      : 'border-[var(--border2)] hover:border-[var(--sky)]/60',
                  )}
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPlay(video.id)}
                    aria-label={`Colocar no ar: ${video.label}`}
                    className="block w-full text-left disabled:cursor-wait"
                  >
                    <div className="relative aspect-[9/16] w-full bg-[var(--bg3)]">
                      <video
                        className="h-full w-full object-cover"
                        src={`${video.thumbSrc}#t=0.5`}
                        muted
                        playsInline
                        preload="metadata"
                        tabIndex={-1}
                        aria-hidden="true"
                        onError={() => console.debug('[VIDEO_DEBUG] deck_thumb_error', { videoId: video.id })}
                      />
                      {index < 9 && (
                        <kbd className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                          {index + 1}
                        </kbd>
                      )}
                      {live && (
                        <span className="absolute right-1 top-1 rounded-full bg-[var(--sky)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">
                          no ar
                        </span>
                      )}
                    </div>
                    <div className="truncate px-2 py-1.5 text-[11px] font-semibold text-[var(--t1)]">{video.label}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(video.id, video.label)}
                    aria-label={`Editar ${video.label}`}
                    className={cn(
                      'absolute bottom-7 right-1 rounded-md bg-black/70 p-1 text-white opacity-0 transition hover:bg-black focus:opacity-100 group-hover:opacity-100',
                      video.edited && 'opacity-100 text-[var(--sky)]',
                    )}
                  >
                    <Scissors className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
