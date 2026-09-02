/**
 * VideoGenPanel — painel em tempo real do pipeline de geração de vídeo.
 *
 * Mostra tudo que acontece durante a live: fila de vídeos, histórico de
 * mensagens (buffer), prompts gerados, próximo vídeo a gerar e as imagens
 * (frames) usadas como base.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Clapperboard, Image as ImageIcon, Loader2, MessageSquare, Play, Sparkles, Wand2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiUrl } from '../lib/api';
import {
  fetchVideoGenState,
  generatePrompt,
  enqueueGeneration,
  type VideoGenState,
} from '../core/videoGenApi';

const POLL_MS = 3000;

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  queued: { label: 'NA FILA', cls: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
  generating: { label: 'GERANDO', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  done: { label: 'PRONTO', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  error: { label: 'ERRO', cls: 'bg-red-500/10 text-red-400 border-red-500/30' },
};

export function VideoGenPanel({ className }: { className?: string }) {
  const [state, setState] = useState<VideoGenState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchVideoGenState();
      setState(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar estado');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    timerRef.current = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [refresh]);

  const handleGeneratePrompt = async () => {
    setBusy(true);
    try {
      await generatePrompt({ force: true });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gerar prompt');
    } finally {
      setBusy(false);
    }
  };

  const handleEnqueueNext = async () => {
    if (!state || !state.prompts.length) return;
    const next = state.prompts[state.prompts.length - 1];
    setBusy(true);
    try {
      await enqueueGeneration({ promptId: next.id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enfileirar');
    } finally {
      setBusy(false);
    }
  };

  const nextPrompt = state?.prompts[state?.prompts.length - 1];
  const nextToGenerate = state?.queue.find((q) => q.status === 'queued' || q.status === 'generating');

  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border border-white/10 bg-[#101114] p-4', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-4 w-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-slate-200">Geração de Vídeo</h3>
        </div>
        <div className="flex items-center gap-2">
          {state && (
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-mono text-slate-400">
              {state.provider}
            </span>
          )}
          <button
            onClick={handleGeneratePrompt}
            disabled={busy}
            className="flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            Gerar prompt
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {loading && !state && <p className="text-xs text-slate-500">Carregando estado...</p>}
      {!state && !loading && !error && <p className="text-xs text-slate-500">Backend indisponível.</p>}
      {!state && <div className="h-2" />}

      {state && (
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <Stat label="Buffer de chat" value={String(state.bufferSize)} />
          <Stat label="Na fila" value={String(state.queue.filter((q) => q.status !== 'done' && q.status !== 'error').length)} />
          <Stat label="Prompts" value={String(state.prompts.length)} />
          <Stat label="Vídeos gerados" value={String(state.videos.length)} />
        </div>
      )}

      {/* Próximo vídeo a gerar */}
      {state && nextToGenerate && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            <Play className="h-3 w-3" /> Próximo vídeo a gerar
          </div>
          <p className="line-clamp-2 text-xs text-slate-300">{nextToGenerate.prompt}</p>
          <div className="mt-1 flex items-center gap-2">
            <StatusPill status={nextToGenerate.status} />
            {nextToGenerate.videoId && (
              <span className="font-mono text-[10px] text-slate-500">{nextToGenerate.videoId}</span>
            )}
          </div>
        </div>
      )}

      {/* Fila de vídeos */}
      <Section title="Fila de vídeos" icon={<Clapperboard className="h-3 w-3" />}>
        {!state || state.queue.length === 0 ? (
          <p className="text-xs text-slate-600">Fila vazia.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {state.queue.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-2 rounded-md bg-white/5 p-1.5">
                <div className="min-w-0">
                  <p className="line-clamp-1 text-xs text-slate-300">{item.prompt}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <StatusPill status={item.status} />
                    {item.videoId && (
                      <a
                        href={apiUrl(`/api/video-gen/video/${item.videoId}`)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[10px] text-violet-400 hover:underline"
                      >
                        {item.videoId}
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Histórico de mensagens (buffer) */}
      <Section title="Histórico de mensagens" icon={<MessageSquare className="h-3 w-3" />}>
        {!state || state.buffer.length === 0 ? (
          <p className="text-xs text-slate-600">Aguardando interações do chat...</p>
        ) : (
          <ul className="flex max-h-28 flex-col gap-1 overflow-y-auto">
            {state.buffer.map((it, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs">
                <span className="shrink-0 rounded bg-white/5 px-1 font-mono text-[9px] uppercase text-slate-500">
                  {it.kind}
                </span>
                <span className="text-slate-400">
                  {it.user && <span className="font-medium text-slate-300">{it.user}: </span>}
                  {it.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Prompts gerados */}
      <Section title="Prompts gerados" icon={<Sparkles className="h-3 w-3" />}>
        {!state || state.prompts.length === 0 ? (
          <p className="text-xs text-slate-600">Nenhum prompt gerado ainda.</p>
        ) : (
          <ul className="flex max-h-28 flex-col gap-1.5 overflow-y-auto">
            {state.prompts.slice(-6).map((p) => (
              <li key={p.id} className="rounded-md bg-white/5 p-1.5">
                <p className="line-clamp-2 text-xs text-slate-300">{p.prompt}</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase text-slate-500">{p.source}</span>
                  {p.id === nextPrompt?.id && (
                    <button
                      onClick={handleEnqueueNext}
                      disabled={busy}
                      className="ml-auto flex items-center gap-1 rounded bg-violet-600/80 px-1.5 py-0.5 text-[10px] text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      <Play className="h-2.5 w-2.5" /> Gerar vídeo
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Imagens usadas (frames) */}
      <Section title="Imagens usadas (frames)" icon={<ImageIcon className="h-3 w-3" />}>
        {!state || state.frameHistory.length === 0 ? (
          <p className="text-xs text-slate-600">Nenhum frame capturado.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {state.frameHistory.slice(-8).map((name) => (
              <div key={name} className="flex flex-col items-center gap-0.5">
                <img
                  src={apiUrl(`/api/video-gen/frame`)}
                  alt={name}
                  className="h-12 w-8 rounded border border-white/10 object-cover"
                />
                <span className="font-mono text-[8px] text-slate-600">{name.slice(6, 14)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/5 px-2 py-1.5">
      <div className="text-sm font-semibold text-slate-200">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.queued;
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-semibold', style.cls)}>{style.label}</span>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
