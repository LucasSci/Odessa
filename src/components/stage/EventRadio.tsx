import { Gift, MessageCircle, Radio, UserPlus } from 'lucide-react';
import type { LiveEvent } from '../../types';

const KIND_ICON: Record<string, typeof Radio> = {
  gift: Gift,
  chat: MessageCircle,
  follow: UserPlus,
};

/** Feed cronológico (mais recente primeiro) dos eventos capturados da live. */
export function EventRadio({ events, limit = 30 }: { events: LiveEvent[]; limit?: number }) {
  const recent: LiveEvent[] = [];
  for (let i = events.length - 1; i >= 0 && recent.length < limit; i--) recent.push(events[i]);

  if (recent.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border2)] p-5 text-center text-xs text-[var(--t3)]">
        Nenhum evento capturado ainda. Chat, presentes e alertas aparecem aqui em tempo real.
      </div>
    );
  }

  return (
    <ol className="space-y-1.5" aria-label="Eventos da live">
      {recent.map((event) => {
        const Icon = KIND_ICON[event.kind] ?? Radio;
        return (
          <li key={event.id} className="flex items-start gap-2 rounded-xl bg-[var(--bg3)]/60 px-2.5 py-2 text-xs">
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--sky)]" />
            <span className="min-w-0 flex-1 break-words text-[var(--t1)]">{event.text}</span>
            <time className="shrink-0 font-mono text-[10px] text-[var(--t3)]">{event.time}</time>
          </li>
        );
      })}
    </ol>
  );
}
