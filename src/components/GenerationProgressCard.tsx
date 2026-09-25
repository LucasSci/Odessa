/**
 * GenerationProgressCard — indicador de progresso de geração de conteúdo
 * (foto ou vídeo), compartilhado entre Content Studio, Video Gen Panel e a
 * Biblioteca.
 *
 * A Higgsfield (e o pipeline de vídeo em geral) não expõe porcentagem real,
 * posição na fila ou ETA em nenhum endpoint público — só estados
 * categóricos (queued/in_progress/completed/failed). Por isso o melhor
 * indicador possível aqui é etapa atual + tempo decorrido, não uma barra
 * de progresso de verdade.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';

export type GenerationStage = 'queued' | 'gerando' | 'pronto' | 'erro';

const STAGE_META: Record<GenerationStage, { label: string; cls: string }> = {
  queued: { label: 'Na fila', cls: 'border-sky-500/30 bg-sky-500/10 text-sky-400' },
  gerando: { label: 'Gerando', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400' },
  pronto: { label: 'Pronto', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' },
  erro: { label: 'Erro', cls: 'border-red-500/30 bg-red-500/10 text-red-400' },
};

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

export function GenerationProgressCard({
  stage,
  startedAt,
  label,
  errorMessage,
  className,
}: {
  stage: GenerationStage;
  /** ISO timestamp de quando a etapa atual (fila ou geração) começou. */
  startedAt?: string | null;
  label?: string;
  errorMessage?: string | null;
  className?: string;
}) {
  const running = stage === 'queued' || stage === 'gerando';
  const [now, setNow] = useState(() => Date.now());

  // Relógio de 1 s só enquanto a etapa está em andamento. O tempo decorrido
  // é derivado no render (sem setState dentro do efeito).
  useEffect(() => {
    if (!running || !startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const startedMs = startedAt ? new Date(startedAt).getTime() : NaN;
  const elapsedSec = running && Number.isFinite(startedMs) ? Math.max(0, Math.floor((now - startedMs) / 1000)) : 0;

  const meta = STAGE_META[stage];

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
        meta.cls,
        className,
      )}
    >
      {stage === 'queued' && <Clock className="h-3.5 w-3.5 shrink-0" />}
      {stage === 'gerando' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
      {stage === 'pronto' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
      {stage === 'erro' && <XCircle className="h-3.5 w-3.5 shrink-0" />}
      <span className="font-semibold">{meta.label}</span>
      {label && <span className="truncate text-slate-400">{label}</span>}
      {running && startedAt && (
        <span className="ml-auto shrink-0 font-mono text-[10px] opacity-70">{formatElapsed(elapsedSec)}</span>
      )}
      {stage === 'erro' && errorMessage && (
        <span className="ml-auto truncate text-[10px] opacity-70" title={errorMessage}>
          {errorMessage}
        </span>
      )}
    </div>
  );
}
