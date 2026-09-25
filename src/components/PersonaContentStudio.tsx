/**
 * PersonaContentStudio.tsx — Organizar / Gerar / Visualizar o conteúdo
 * (fotos + vídeos, enviados ou autogerados) de uma persona.
 *
 * Terceiro pilar do "mega upgrade" de Conversas: uma única aba pra ver tudo
 * que a persona já tem e disparar geração manual (Higgsfield/Gemini pra
 * fotos, o pipeline de video-gen existente pra vídeos), sem precisar abrir
 * JSON na mão ou navegar entre painéis separados.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePolling } from '../core/usePolling';
import { Images, Sparkles, LayoutGrid, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import {
  fetchPersonaContent,
  generatePersonaPhoto,
  generatePersonaVideo,
  CONTENT_STUDIO_POLL_MS,
  type PersonaContentItem,
  type PersonaContentState,
} from '../core/personaContentApi';
import { fetchPhotoJobStatus } from '../core/personaSelfConfig';
import { fetchQueue, type VideoGenQueueItem } from '../core/videoGenApi';
import { GenerationProgressCard, type GenerationStage } from './GenerationProgressCard';
import { Tabs, SkeletonList } from './ui';

const JOB_POLL_MS = 2000;

function queueStatusToStage(status: VideoGenQueueItem['status']): GenerationStage {
  if (status === 'generating') return 'gerando';
  if (status === 'done') return 'pronto';
  if (status === 'error') return 'erro';
  return 'queued';
}

type Props = {
  personaId: string;
  personaName: string;
};

type SubTab = 'organize' | 'generate' | 'overview';

const KIND_LABEL: Record<string, string> = {
  image: 'Foto',
  video: 'Vídeo',
};

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function PersonaContentStudio({ personaId, personaName }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('organize');
  const [content, setContent] = useState<PersonaContentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<'all' | 'image' | 'video'>('all');
  const [filterGenerated, setFilterGenerated] = useState<'all' | 'generated' | 'uploaded'>('all');

  const [photoPrompt, setPhotoPrompt] = useState('');
  const [videoPrompt, setVideoPrompt] = useState('');
  const [generatingPhoto, setGeneratingPhoto] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [generateMsg, setGenerateMsg] = useState<string | null>(null);

  // Job em andamento (foto via /selfconfig/photo-status, vídeo via a fila do
  // video-gen) — null quando não há geração ativa pra acompanhar.
  const [photoJobId, setPhotoJobId] = useState<string | null>(null);
  const [photoJobStage, setPhotoJobStage] = useState<GenerationStage>('queued');
  const [photoJobStartedAt, setPhotoJobStartedAt] = useState<string | null>(null);
  const [photoJobError, setPhotoJobError] = useState<string | null>(null);
  const [videoQueueItemId, setVideoQueueItemId] = useState<string | null>(null);
  const [videoQueueStage, setVideoQueueStage] = useState<GenerationStage>('queued');
  const [videoQueueStartedAt, setVideoQueueStartedAt] = useState<string | null>(null);
  const [videoQueueError, setVideoQueueError] = useState<string | null>(null);

  // loading começa true (useState(true) abaixo) só pra cobrir a primeira
  // carga — trocas de persona depois disso mostram o conteúdo antigo por um
  // instante em vez de piscar o spinner de novo (evita setState síncrono
  // direto no corpo do efeito).
  const refresh = useCallback(async () => {
    try {
      const data = await fetchPersonaContent(personaId);
      setContent(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar conteúdo da persona');
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  usePolling(refresh, CONTENT_STUDIO_POLL_MS, { restartKey: refresh });

  // Acompanha o job de geração de foto até done/error, então avisa a lista
  // de conteúdo (refresh) e some com o card depois de um instante. Auto-
  // agendado (setTimeout recursivo) em vez de setInterval — para de bater no
  // endpoint assim que chega num estado terminal, sem precisar de um efeito
  // separado só pra isso.
  useEffect(() => {
    if (!photoJobId) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const status = await fetchPhotoJobStatus(personaId, photoJobId);
      if (cancelled) return;
      if (!status) {
        setPhotoJobId(null);
        return;
      }
      const stage = queueStatusToStage(status.status);
      setPhotoJobStage(stage);
      setPhotoJobStartedAt(status.startedAt || status.queuedAt || null);
      setPhotoJobError(status.error || null);
      if (stage === 'pronto' || stage === 'erro') {
        void refresh();
        timer = window.setTimeout(() => {
          if (!cancelled) setPhotoJobId(null);
        }, 4000);
        return;
      }
      timer = window.setTimeout(poll, JOB_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [photoJobId, personaId, refresh]);

  // Mesmo padrão do efeito acima, pro item da fila de video-gen.
  useEffect(() => {
    if (!videoQueueItemId) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      let item: VideoGenQueueItem | undefined;
      try {
        const queue = await fetchQueue(personaId);
        item = queue.find((q) => q.id === videoQueueItemId);
      } catch {
        item = undefined;
      }
      if (cancelled) return;
      if (!item) {
        setVideoQueueItemId(null);
        return;
      }
      const stage = queueStatusToStage(item.status);
      setVideoQueueStage(stage);
      setVideoQueueStartedAt(item.createdAt || null);
      setVideoQueueError(item.error || null);
      if (stage === 'pronto' || stage === 'erro') {
        void refresh();
        timer = window.setTimeout(() => {
          if (!cancelled) setVideoQueueItemId(null);
        }, 4000);
        return;
      }
      timer = window.setTimeout(poll, JOB_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [videoQueueItemId, personaId, refresh]);

  const handleGeneratePhoto = async () => {
    const prompt = photoPrompt.trim();
    if (!prompt || generatingPhoto) return;
    setGeneratingPhoto(true);
    setGenerateMsg(null);
    try {
      const result = await generatePersonaPhoto(personaId, prompt);
      if (result.ok) {
        setGenerateMsg('🎨 Geração de foto iniciada — acompanhe o progresso abaixo.');
        setPhotoPrompt('');
        if (result.jobId) {
          setPhotoJobError(null);
          setPhotoJobStage('queued');
          setPhotoJobStartedAt(new Date().toISOString());
          setPhotoJobId(result.jobId);
        }
      } else if (result.status === 'cooldown') {
        setGenerateMsg('⏳ Aguarde um pouco antes de gerar outra foto (cooldown ativo).');
      } else if (result.status === 'max_reached') {
        setGenerateMsg('⚠️ Limite de fotos autogeradas para esta persona atingido.');
      } else {
        setGenerateMsg(`⚠️ Não foi possível iniciar a geração (${result.status}).`);
      }
    } finally {
      setGeneratingPhoto(false);
    }
  };

  const handleGenerateVideo = async () => {
    const prompt = videoPrompt.trim();
    if (!prompt || generatingVideo) return;
    setGeneratingVideo(true);
    setGenerateMsg(null);
    try {
      const result = await generatePersonaVideo(personaId, { prompt });
      setGenerateMsg(
        result.ok
          ? '🎬 Geração de vídeo enfileirada — acompanhe o progresso abaixo.'
          : '⚠️ Não foi possível enfileirar a geração de vídeo.',
      );
      if (result.ok) {
        setVideoPrompt('');
        if (result.item) {
          setVideoQueueError(null);
          setVideoQueueStage(queueStatusToStage(result.item.status));
          setVideoQueueStartedAt(result.item.createdAt || new Date().toISOString());
          setVideoQueueItemId(result.item.id);
        }
      }
    } catch (err) {
      // enqueueGeneration/generateFromTemplate lançam em qualquer resposta
      // não-2xx (ex.: fila cheia) em vez de devolver {ok:false} — sem este
      // catch, isso vira uma rejeição de promise não tratada.
      const detail = err instanceof Error ? err.message : 'erro desconhecido';
      setGenerateMsg(`⚠️ Não foi possível enfileirar a geração de vídeo (${detail}).`);
    } finally {
      setGeneratingVideo(false);
    }
  };

  const items = content?.items || [];
  const filteredItems = items.filter((item) => {
    if (filterKind !== 'all' && item.kind !== filterKind) return false;
    if (filterGenerated === 'generated' && !item.generated) return false;
    if (filterGenerated === 'uploaded' && item.generated) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Content Studio — {personaName}</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Organize, gere e veja de forma geral todo o conteúdo desta persona
          </p>
        </div>
        <Tabs
          size="sm"
          className="rounded-xl border border-white/10 bg-black/20 p-1"
          value={subTab}
          onChange={(id) => setSubTab(id as SubTab)}
          items={[
            { id: 'organize', label: 'Organizar', icon: <Images className="h-3.5 w-3.5" /> },
            { id: 'generate', label: 'Gerar', icon: <Wand2 className="h-3.5 w-3.5" /> },
            { id: 'overview', label: 'Visualizar', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
          ]}
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && !content ? (
        <SkeletonList label="Carregando conteúdo" rows={4} className="py-4" itemClassName="h-14" />
      ) : (
        <>
          {subTab === 'organize' && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={filterKind}
                  onChange={(e) => setFilterKind(e.target.value as typeof filterKind)}
                  className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-200"
                >
                  <option value="all">Todos os tipos</option>
                  <option value="image">Fotos</option>
                  <option value="video">Vídeos</option>
                </select>
                <select
                  value={filterGenerated}
                  onChange={(e) => setFilterGenerated(e.target.value as typeof filterGenerated)}
                  className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-200"
                >
                  <option value="all">Geradas + enviadas</option>
                  <option value="generated">Só autogeradas</option>
                  <option value="uploaded">Só enviadas</option>
                </select>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="ml-auto flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                >
                  <RefreshCw className="h-3 w-3" /> Atualizar
                </button>
              </div>

              {filteredItems.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  Nenhum conteúdo encontrado com esses filtros.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {filteredItems.map((item) => (
                    <ContentCard key={`${item.kind}-${item.id}`} item={item} />
                  ))}
                </div>
              )}
            </div>
          )}

          {subTab === 'generate' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <Sparkles className="h-3.5 w-3.5 text-sky-400" /> Nova foto
                </h4>
                <p className="mt-1 text-[11px] text-slate-500">
                  Usa o rosto principal já cadastrado como referência de personagem (Higgsfield SoulId, com fallback pro Gemini).
                </p>
                <textarea
                  value={photoPrompt}
                  onChange={(e) => setPhotoPrompt(e.target.value)}
                  placeholder="Ex.: sorrindo, luz dourada de fim de tarde"
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-slate-200 placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={() => void handleGeneratePhoto()}
                  disabled={!photoPrompt.trim() || generatingPhoto}
                  className="mt-2 flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {generatingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Gerar foto
                </button>
                {photoJobId && (
                  <GenerationProgressCard
                    className="mt-2"
                    stage={photoJobStage}
                    startedAt={photoJobStartedAt}
                    errorMessage={photoJobError}
                  />
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <Sparkles className="h-3.5 w-3.5 text-blue-400" /> Novo vídeo
                </h4>
                <p className="mt-1 text-[11px] text-slate-500">
                  Enfileira no mesmo pipeline de geração de vídeo em tempo real (Ao Vivo → Video Gen).
                </p>
                <textarea
                  value={videoPrompt}
                  onChange={(e) => setVideoPrompt(e.target.value)}
                  placeholder="Ex.: acenando animada, olhando pra câmera"
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-slate-200 placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={() => void handleGenerateVideo()}
                  disabled={!videoPrompt.trim() || generatingVideo}
                  className="mt-2 flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {generatingVideo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Gerar vídeo
                </button>
                {videoQueueItemId && (
                  <GenerationProgressCard
                    className="mt-2"
                    stage={videoQueueStage}
                    startedAt={videoQueueStartedAt}
                    errorMessage={videoQueueError}
                  />
                )}
              </div>

              {generateMsg && (
                <p className="sm:col-span-2 text-xs text-slate-400">{generateMsg}</p>
              )}
            </div>
          )}

          {subTab === 'overview' && content && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Total" value={content.total} />
                <StatCard label="Autogerado" value={content.generatedCount} />
                {Object.entries(content.countsByCategory).map(([key, count]) => (
                  <StatCard key={key} label={key.replace(':', ' · ')} value={count} />
                ))}
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <h4 className="text-xs font-semibold text-slate-200">Recentes</h4>
                <div className="mt-2 flex flex-col divide-y divide-white/5">
                  {items.slice(0, 10).map((item) => (
                    <div key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                      <span className="truncate text-slate-300">
                        {KIND_LABEL[item.kind] || item.kind} — {item.label}
                        {item.generated && <span className="ml-1.5 text-violet-400">(gerado{item.provider ? ` · ${item.provider}` : ''})</span>}
                      </span>
                      <span className="shrink-0 text-slate-500">{formatDate(item.createdAt)}</span>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <p className="py-4 text-center text-slate-500">Nenhum conteúdo ainda.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-center">
      <div className="text-lg font-semibold text-slate-100">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

function ContentCard({ item }: { item: PersonaContentItem }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
      <div className="flex aspect-square items-center justify-center bg-black/30">
        {item.kind === 'image' && item.url ? (
          <img src={item.url} alt={item.label} className="h-full w-full object-cover" />
        ) : item.kind === 'video' && item.url ? (
          <video src={item.url} className="h-full w-full object-cover" muted />
        ) : (
          <span className="text-2xl text-slate-700">{item.kind === 'video' ? '🎬' : '🖼️'}</span>
        )}
      </div>
      <div className="p-2">
        <p className="truncate text-[11px] text-slate-300" title={item.label}>
          {item.label}
        </p>
        <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-500">
          <span>{formatDate(item.createdAt)}</span>
          {item.generated && <span className="text-violet-400">gerado</span>}
        </div>
      </div>
    </div>
  );
}
