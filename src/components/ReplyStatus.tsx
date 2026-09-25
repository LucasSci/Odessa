import type { ReactNode } from 'react';
import type { ReplyQueueStatus } from '../core/tangoChatSession';
import { cn } from '../lib/utils';

/** Rótulo e cor de cada status da fila de respostas públicas — única fonte para toda tela que mostra a fila. */
const REPLY_STATUS: Record<ReplyQueueStatus, { label: string; badge: string; card: string }> = {
  draft: { label: 'Aguardando aprovação', badge: 'text-amber-300 bg-amber-500/10 border-amber-400/30', card: 'border-sky-500/30 bg-sky-500/5' },
  sending: { label: 'Enviando…', badge: 'text-sky-300 bg-sky-500/10 border-sky-400/30', card: 'border-sky-500/30 bg-sky-500/5' },
  sent: { label: 'Enviada', badge: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30', card: 'border-emerald-500/30 bg-emerald-500/5' },
  simulated: { label: 'Simulada (teste)', badge: 'text-violet-300 bg-violet-500/10 border-violet-400/30', card: 'border-violet-500/25 bg-violet-500/[0.04]' },
  blocked: { label: 'Bloqueada', badge: 'text-red-300 bg-red-500/10 border-red-400/30', card: 'border-red-500/30 bg-red-500/5' },
  failed: { label: 'Falhou no envio', badge: 'text-orange-300 bg-orange-500/10 border-orange-400/30', card: 'border-orange-500/30 bg-orange-500/5' },
  discarded: { label: 'Descartada', badge: 'text-slate-400 bg-white/5 border-white/10', card: 'border-white/10 bg-white/[0.02]' },
};

/** Enviada, mas a mensagem não apareceu no chat a tempo (#158): o operador confere no Tango. */
const SENT_UNCONFIRMED = {
  label: 'Enviada · sem confirmação',
  badge: 'text-amber-300 bg-amber-500/10 border-amber-400/30',
  title: 'O Tango aceitou o envio, mas a mensagem não apareceu no chat a tempo. Confira no Tango.',
};

export function ReplyStatusBadge({
  status,
  confirmed,
  className,
}: {
  status: ReplyQueueStatus;
  /** Só importa para "sent": false = não apareceu no chat. */
  confirmed?: boolean;
  className?: string;
}) {
  const unconfirmed = status === 'sent' && confirmed === false;
  const meta = unconfirmed ? SENT_UNCONFIRMED : { ...REPLY_STATUS[status], title: undefined };
  return (
    <span
      title={meta.title}
      className={cn('inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold', meta.badge, className)}
    >
      {meta.label}
    </span>
  );
}

/** "Memórias usadas" de uma resposta (#165): o que a IA sabia de quem falou. */
export function MemoriesUsed({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <p className="text-[10px] leading-relaxed text-slate-400">
      <span className="font-semibold text-slate-300">Memórias usadas:</span> {items.join(' · ')}
    </p>
  );
}

/** Moldura do cartão de uma resposta na fila, com a cor do status. */
export function ReplyCardFrame({ status, className, children }: { status: ReplyQueueStatus; className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border p-3 transition-colors', REPLY_STATUS[status].card, className)}>{children}</div>;
}
