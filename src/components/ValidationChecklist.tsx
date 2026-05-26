/**
 * ValidationChecklist — checklist de validação de fluxo do palco.
 * Verifica se o workflow está pronto para operar uma live.
 */
import { AlertTriangle, CheckCircle2, Circle, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';

export type CheckStatus = 'ok' | 'warn' | 'error' | 'pending';

export interface ValidationCheck {
  id: string;
  label: string;
  detail?: string;
  status: CheckStatus;
}

interface ValidationChecklistProps {
  checks: ValidationCheck[];
  title?: string;
  className?: string;
  /** Se true, mostra apenas os itens com status != ok */
  errorsOnly?: boolean;
}

const STATUS_ICONS: Record<CheckStatus, React.ReactNode> = {
  ok:      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />,
  warn:    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />,
  error:   <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />,
  pending: <Circle className="h-3.5 w-3.5 text-slate-600 shrink-0" />,
};

const STATUS_TEXT: Record<CheckStatus, string> = {
  ok:      'text-slate-300',
  warn:    'text-amber-200',
  error:   'text-red-300',
  pending: 'text-slate-500',
};

export function ValidationChecklist({
  checks,
  title = 'Validação do Fluxo',
  className,
  errorsOnly,
}: ValidationChecklistProps) {
  const visible = errorsOnly ? checks.filter((c) => c.status !== 'ok') : checks;
  const errorCount = checks.filter((c) => c.status === 'error').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const allOk = errorCount === 0 && warnCount === 0;

  return (
    <div
      className={cn(
        'rounded-xl border p-3 space-y-2',
        errorCount > 0
          ? 'border-red-500/20 bg-red-500/5'
          : warnCount > 0
            ? 'border-amber-500/20 bg-amber-500/5'
            : 'border-emerald-500/15 bg-emerald-500/5',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {title}
        </span>
        <span
          className={cn(
            'text-[9px] font-bold uppercase',
            allOk ? 'text-emerald-400' : errorCount > 0 ? 'text-red-300' : 'text-amber-300',
          )}
        >
          {allOk
            ? 'OK'
            : `${errorCount > 0 ? `${errorCount} erro${errorCount > 1 ? 's' : ''}` : ''}${errorCount > 0 && warnCount > 0 ? ', ' : ''}${warnCount > 0 ? `${warnCount} aviso${warnCount > 1 ? 's' : ''}` : ''}`}
        </span>
      </div>

      {/* Items */}
      {visible.length === 0 && errorsOnly ? (
        <p className="text-[11px] text-emerald-400 text-center py-1">Tudo pronto ✓</p>
      ) : (
        <div className="space-y-1">
          {visible.map((check) => (
            <div key={check.id} className="flex items-start gap-2">
              {STATUS_ICONS[check.status]}
              <div className="min-w-0">
                <p className={cn('text-[11px] font-medium leading-snug', STATUS_TEXT[check.status])}>
                  {check.label}
                </p>
                {check.detail && (
                  <p className="text-[10px] text-slate-600 leading-snug">{check.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Gera checks de validação a partir dos dados do workflow atual.
 * Pode ser expandido com mais regras conforme o sistema cresce.
 */
export function buildFlowValidationChecks(opts: {
  hasIdleVideo: boolean;
  videoCount: number;
  triggerCount: number;
  connectionCount: number;
  videosWithoutReturn: string[];
  triggersWithoutDestination: string[];
  orphanConnections: string[];
}): ValidationCheck[] {
  return [
    {
      id: 'idle-exists',
      label: 'Vídeo idle principal definido',
      detail: opts.hasIdleVideo ? undefined : 'Configure um vídeo idle no editor de fluxo.',
      status: opts.hasIdleVideo ? 'ok' : 'error',
    },
    {
      id: 'has-videos',
      label: `${opts.videoCount} vídeo${opts.videoCount !== 1 ? 's' : ''} no fluxo`,
      detail: opts.videoCount === 0 ? 'Adicione ao menos um vídeo ao fluxo.' : undefined,
      status: opts.videoCount > 0 ? 'ok' : 'error',
    },
    {
      id: 'has-triggers',
      label: `${opts.triggerCount} gatilho${opts.triggerCount !== 1 ? 's' : ''} configurado${opts.triggerCount !== 1 ? 's' : ''}`,
      detail: opts.triggerCount === 0 ? 'Nenhum gatilho ativo. O fluxo só irá responder a agendamentos.' : undefined,
      status: opts.triggerCount > 0 ? 'ok' : 'warn',
    },
    {
      id: 'has-connections',
      label: `${opts.connectionCount} conexão${opts.connectionCount !== 1 ? 'ões' : ''} no fluxo`,
      detail: opts.connectionCount === 0 ? 'Conecte os vídeos no editor de fluxo.' : undefined,
      status: opts.connectionCount > 0 ? 'ok' : 'warn',
    },
    {
      id: 'videos-return',
      label: 'Todos os vídeos têm retorno configurado',
      detail: opts.videosWithoutReturn.length > 0
        ? `Sem retorno: ${opts.videosWithoutReturn.slice(0, 3).join(', ')}${opts.videosWithoutReturn.length > 3 ? '…' : ''}`
        : undefined,
      status: opts.videosWithoutReturn.length === 0 ? 'ok' : 'warn',
    },
    {
      id: 'trigger-destinations',
      label: 'Todos os gatilhos têm destino',
      detail: opts.triggersWithoutDestination.length > 0
        ? `Sem destino: ${opts.triggersWithoutDestination.slice(0, 2).join(', ')}`
        : undefined,
      status: opts.triggersWithoutDestination.length === 0 ? 'ok' : 'error',
    },
    {
      id: 'orphan-connections',
      label: 'Sem conexões órfãs (becos sem saída)',
      detail: opts.orphanConnections.length > 0
        ? `${opts.orphanConnections.length} conexão(ões) sem destino válido.`
        : undefined,
      status: opts.orphanConnections.length === 0 ? 'ok' : 'warn',
    },
  ];
}

import React from 'react';
