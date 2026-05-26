/**
 * StatusBadge — badge visual para estados do palco.
 * Usado em StagePanel e em qualquer painel que precise indicar estado do sistema.
 */
import { cn } from '../lib/utils';

export type StageStatus =
  | 'IDLE'
  | 'AO_VIVO'
  | 'EM_TRANSICAO'
  | 'GATILHO_ATIVO'
  | 'FILA'
  | 'AGUARDANDO_OCR'
  | 'AGUARDANDO_IA'
  | 'ERRO'
  | 'STANDBY';

interface StatusBadgeProps {
  status: StageStatus;
  /** Pulse animation no dot */
  pulse?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<
  StageStatus,
  { label: string; dot: string; bg: string; border: string; text: string }
> = {
  IDLE: {
    label: 'IDLE',
    dot: 'bg-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-300',
  },
  AO_VIVO: {
    label: 'AO VIVO',
    dot: 'bg-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    text: 'text-rose-300',
  },
  EM_TRANSICAO: {
    label: 'EM TRANSIÇÃO',
    dot: 'bg-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-300',
  },
  GATILHO_ATIVO: {
    label: 'GATILHO ATIVO',
    dot: 'bg-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    text: 'text-purple-300',
  },
  FILA: {
    label: 'NA FILA',
    dot: 'bg-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    text: 'text-cyan-300',
  },
  AGUARDANDO_OCR: {
    label: 'AGUARD. OCR',
    dot: 'bg-sky-400',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    text: 'text-sky-300',
  },
  AGUARDANDO_IA: {
    label: 'AGUARD. IA',
    dot: 'bg-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    text: 'text-violet-300',
  },
  ERRO: {
    label: 'ERRO',
    dot: 'bg-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-300',
  },
  STANDBY: {
    label: 'STANDBY',
    dot: 'bg-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    text: 'text-slate-400',
  },
};

export function StatusBadge({ status, pulse, className }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.STANDBY;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
        'text-[10px] font-bold uppercase tracking-[0.12em]',
        cfg.bg,
        cfg.border,
        cfg.text,
        className,
      )}
    >
      <span
        className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', cfg.dot, pulse && 'animate-pulse')}
      />
      {cfg.label}
    </span>
  );
}

/**
 * Derivar StageStatus a partir dos dados de videoState que já existem no sistema.
 */
export function deriveStageStatus(opts: {
  state?: string | null;
  isTransitioning?: boolean;
  queueLen?: number;
  autopilotEnabled?: boolean;
  hasError?: boolean;
}): StageStatus {
  if (opts.hasError) return 'ERRO';
  if (opts.isTransitioning) return 'EM_TRANSICAO';
  if (opts.state === 'ACTION') return 'GATILHO_ATIVO';
  if ((opts.queueLen ?? 0) > 0) return 'FILA';
  if (opts.autopilotEnabled) return 'AO_VIVO';
  if (opts.state === 'IDLE' || opts.state === 'idle') return 'IDLE';
  return 'STANDBY';
}
