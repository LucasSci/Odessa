/**
 * SystemHealthCard — card de saúde do sistema com status de múltiplos serviços.
 * Usado em StagePanel e CaptureStudio para diagnóstico unificado.
 */
import { cn } from '../lib/utils';

export type ServiceStatus = 'online' | 'offline' | 'degraded' | 'unknown' | 'checking';

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  /** Mensagem curta de detalhe (opcional) */
  detail?: string;
  /** Latência em ms (opcional) */
  latencyMs?: number | null;
}

interface SystemHealthCardProps {
  services: ServiceHealth[];
  className?: string;
  compact?: boolean;
}

const STATUS_CONFIG: Record<ServiceStatus, { dot: string; label: string; text: string }> = {
  online:   { dot: 'bg-emerald-400',  label: 'online',    text: 'text-emerald-300' },
  offline:  { dot: 'bg-slate-600',    label: 'offline',   text: 'text-slate-500'   },
  degraded: { dot: 'bg-amber-400',    label: 'degradado', text: 'text-amber-300'   },
  unknown:  { dot: 'bg-slate-700',    label: '?',         text: 'text-slate-600'   },
  checking: { dot: 'bg-blue-400',     label: 'checando',  text: 'text-blue-300'    },
};

function ServiceRow({ service, compact }: { service: ServiceHealth; compact?: boolean }) {
  const cfg = STATUS_CONFIG[service.status];
  return (
    <div className={cn('flex items-center gap-2', compact ? 'py-0.5' : 'py-1')}>
      <span
        className={cn(
          'inline-block rounded-full shrink-0',
          compact ? 'h-1.5 w-1.5' : 'h-2 w-2',
          cfg.dot,
          service.status === 'online' && 'shadow-[0_0_4px_currentColor]',
          service.status === 'checking' && 'animate-pulse',
        )}
      />
      <span className={cn('font-medium', compact ? 'text-[10px]' : 'text-xs', 'text-slate-300 min-w-0 flex-1 truncate')}>
        {service.name}
      </span>
      {service.latencyMs != null && (
        <span className="text-[9px] font-mono text-slate-600 shrink-0">{service.latencyMs}ms</span>
      )}
      <span className={cn('shrink-0 font-bold', compact ? 'text-[9px]' : 'text-[10px]', cfg.text)}>
        {cfg.label}
      </span>
    </div>
  );
}

export function SystemHealthCard({ services, className, compact }: SystemHealthCardProps) {
  const onlineCount = services.filter((s) => s.status === 'online').length;
  const errorCount = services.filter((s) => s.status === 'offline' || s.status === 'degraded').length;

  return (
    <div
      className={cn(
        'rounded-xl border bg-[#0d0f14] p-3',
        errorCount > 0
          ? 'border-amber-500/20'
          : onlineCount === services.length
            ? 'border-emerald-500/15'
            : 'border-slate-700/40',
        className,
      )}
    >
      {!compact && (
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">
            Sistema
          </span>
          <span
            className={cn(
              'text-[9px] font-bold',
              errorCount > 0 ? 'text-amber-300' : 'text-emerald-400',
            )}
          >
            {onlineCount}/{services.length} online
          </span>
        </div>
      )}
      <div className="space-y-0">
        {services.map((s) => (
          <ServiceRow key={s.name} service={s} compact={compact} />
        ))}
      </div>
    </div>
  );
}

/** Hook simples para checar saúde dos serviços via fetch */
export function useServiceHealth(checks: Array<{ name: string; url: string }>) {
  const [services, setServices] = useState<ServiceHealth[]>(
    checks.map((c) => ({ name: c.name, status: 'checking' as ServiceStatus })),
  );

  useEffect(() => {
    const run = async () => {
      const results = await Promise.all(
        checks.map(async (check) => {
          const start = Date.now();
          try {
            const res = await fetch(check.url, { signal: AbortSignal.timeout(3000) });
            return {
              name: check.name,
              status: (res.ok ? 'online' : 'degraded') as ServiceStatus,
              latencyMs: Date.now() - start,
            };
          } catch {
            return { name: check.name, status: 'offline' as ServiceStatus, latencyMs: null };
          }
        }),
      );
      setServices(results);
    };
    void run();
    const id = setInterval(() => void run(), 15000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return services;
}


import { useEffect, useState } from 'react';
