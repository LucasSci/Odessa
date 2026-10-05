/**
 * Motor da IA local: a GPU integrada (llama.cpp do Odessa, o mesmo motor do
 * Ollama, rodando direto) ou o Ollama na CPU. Medido no PC da live: na GPU,
 * 3× mais rápido e ~3,5 núcleos livres para o OBS.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiFetch';
import { cn } from '../lib/utils';
import { useToast } from './Toast';

interface EngineStatus {
  mode: 'gpu' | 'ollama';
  available: boolean;
  running: boolean;
  model: string | null;
  device: 'gpu' | 'cpu' | null;
}

const CHOICES: Array<{ id: 'auto' | 'ollama'; mode: EngineStatus['mode']; label: string; hint: string }> = [
  { id: 'auto', mode: 'gpu', label: 'GPU integrada (rápido)', hint: '~3 s por resposta e quase nada de CPU: sobra para o OBS.' },
  { id: 'ollama', mode: 'ollama', label: 'Ollama', hint: 'Roda na CPU: ~10 s por resposta e ocupa ~4 núcleos enquanto responde.' },
];

export function LocalEngineChoice() {
  const toast = useToast();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await apiFetch<EngineStatus>('/ai/engine'));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(first);
  }, [refresh]);

  if (!status) return null;

  const choose = async (id: 'auto' | 'ollama') => {
    setSaving(true);
    try {
      setStatus(await apiFetch<EngineStatus>('/ai/engine', { method: 'POST', json: { mode: id } }));
      toast.success(id === 'ollama' ? 'IA local pelo Ollama.' : 'IA local na GPU integrada.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui trocar o motor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Motor da IA local">
        <span className="text-[11px] text-slate-400">Motor:</span>
        {CHOICES.map((choice) => {
          const disabled = saving || (choice.mode === 'gpu' && !status.available);
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={status.mode === choice.mode}
              disabled={disabled}
              title={choice.mode === 'gpu' && !status.available ? 'O motor não foi encontrado neste computador.' : choice.hint}
              onClick={() => void choose(choice.id)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                status.mode === choice.mode
                  ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-white/10 text-slate-400 hover:text-slate-200',
              )}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] leading-relaxed text-slate-500">
        {status.mode === 'gpu'
          ? status.running
            ? `Carregado: ${status.model} na ${status.device === 'gpu' ? 'GPU integrada' : 'CPU (a GPU não aceitou)'}. Descarrega sozinho após 10 min sem uso fora da live.`
            : 'Carrega na primeira resposta (alguns segundos) e usa os modelos que o Ollama já baixou.'
          : 'Usa o Ollama instalado neste computador.'}
      </p>
    </div>
  );
}
