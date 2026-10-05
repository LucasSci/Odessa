/** Selo "IA: …" — deixa claro, a qualquer momento, quem está respondendo o chat. */
import { Brain, Cloud, Cpu } from 'lucide-react';
import { useActiveAi } from '../core/useActiveAi';
import { cn } from '../lib/utils';

export function ActiveAiBadge({ className }: { className?: string }) {
  const { provider, label, missingKey } = useActiveAi();
  const cloud = provider !== 'ollama';
  const Icon = cloud ? Cloud : Cpu;
  return (
    <span
      key={label}
      title={
        missingKey
          ? 'Você escolheu uma IA de nuvem, mas falta a chave: o chat está usando a IA local. Configure em Configurações → IA e chaves.'
          : `O chat está sendo respondido por: ${label}`
      }
      className={cn(
        'od-pop flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest',
        missingKey
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          : cloud
            ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
            : 'border-white/10 bg-black/40 text-slate-400',
        className,
      )}
      data-state="open"
    >
      {missingKey ? <Brain className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
      IA: {label}
      {missingKey && ' (sem chave)'}
    </span>
  );
}
