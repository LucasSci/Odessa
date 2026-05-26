/**
 * AiDecisionPanel — painel visual da decisão da IA.
 * Por enquanto usa mock (status: 'simulated' | 'offline').
 * Quando a IA real estiver integrada, basta passar status: 'online'
 * e alimentar com decisões reais via hook/context.
 */
import { Brain, Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import type { AiDecision, AiStatus } from '../core/aiDecisionContract';
import {
  INTENT_LABELS,
  EMOTION_LABELS,
  ACTION_LABELS,
  EMPTY_AI_DECISION,
} from '../core/aiDecisionContract';

interface AiDecisionPanelProps {
  decision?: AiDecision | null;
  className?: string;
}

const STATUS_STYLES: Record<AiStatus, { label: string; color: string; bg: string; border: string }> = {
  offline: {
    label: 'IA OFFLINE',
    color: 'text-slate-500',
    bg: 'bg-slate-800/40',
    border: 'border-slate-700/40',
  },
  simulated: {
    label: 'IA SIMULADA',
    color: 'text-amber-400',
    bg: 'bg-amber-500/8',
    border: 'border-amber-500/20',
  },
  online: {
    label: 'IA ONLINE',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/8',
    border: 'border-emerald-500/20',
  },
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? 'bg-emerald-500' : value >= 0.5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-slate-800">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-[10px] font-mono text-slate-400">{pct}%</span>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{label}</span>
      <p className={cn('text-[11px] text-slate-300 truncate', mono && 'font-mono')}>{value || '—'}</p>
    </div>
  );
}

export function AiDecisionPanel({ decision, className }: AiDecisionPanelProps) {
  const d = decision ?? EMPTY_AI_DECISION;
  const st = STATUS_STYLES[d.status];

  return (
    <div
      className={cn(
        'rounded-xl border p-3 space-y-3 transition-colors',
        st.bg,
        st.border,
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Decisão da IA
          </span>
        </div>
        <span className={cn('text-[9px] font-bold uppercase tracking-widest', st.color)}>
          {st.label}
        </span>
      </div>

      {d.status === 'offline' ? (
        <p className="text-[11px] text-slate-600 text-center py-2">
          IA não conectada — sistema operando por regras diretas.
        </p>
      ) : (
        <div className="space-y-2.5">
          {/* Última mensagem */}
          {d.sourceEvent && (
            <Field
              label="Última entrada"
              value={d.sourceEvent.normalizedText || d.sourceEvent.rawText}
            />
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Intenção" value={INTENT_LABELS[d.intent] ?? d.intent} />
            <Field label="Emoção / Tom" value={EMOTION_LABELS[d.emotion] ?? d.emotion} />
            <Field label="Ação recomendada" value={ACTION_LABELS[d.recommendedAction]} />
            <Field
              label="Gatilho selecionado"
              value={d.selectedTriggerId ?? 'nenhum'}
              mono
            />
          </div>

          {d.selectedVideoLabel && (
            <div className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/8 px-2.5 py-1.5">
              <Zap className="h-3 w-3 text-violet-400 shrink-0" />
              <span className="text-[11px] font-semibold text-violet-300 truncate">
                {d.selectedVideoLabel}
              </span>
            </div>
          )}

          {/* Confiança */}
          <div className="space-y-0.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">
              Confiança
            </span>
            <ConfidenceBar value={d.confidence} />
          </div>

          {/* Motivo */}
          <Field label="Motivo" value={d.reasoning} />

          <p className="text-[9px] text-slate-600 font-mono">
            {new Date(d.timestamp).toLocaleTimeString()}
          </p>
        </div>
      )}
    </div>
  );
}
