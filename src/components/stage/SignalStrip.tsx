import { StatusDot } from '../ui';
import { cn } from '../../lib/utils';

export type SignalStatus = 'online' | 'idle' | 'warn' | 'error';

export interface Signal {
  id: string;
  label: string;
  status: SignalStatus;
  detail?: string;
}

/** Faixa única de sinais vitais da live — substitui os status espalhados e conflitantes. */
export function SignalStrip({ signals, className }: { signals: Signal[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)} role="list" aria-label="Sinais vitais da live">
      {signals.map((signal) => (
        <div
          key={signal.id}
          role="listitem"
          title={signal.detail}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--t2)]"
        >
          <StatusDot status={signal.status} pulse={signal.status === 'error'} />
          <span>{signal.label}</span>
          {signal.detail && <span className="max-w-[160px] truncate font-normal text-[var(--t3)]">{signal.detail}</span>}
        </div>
      ))}
    </div>
  );
}
