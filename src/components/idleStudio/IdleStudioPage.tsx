/**
 * Estúdio da IDLE — do prompt ao fluxo da live, dentro do Odessa.
 *
 * Etapa a etapa: copiar o prompt (ou gerar por API), anexar o resultado (o
 * nome vira o da etapa sozinho), aprovar e, com os clipes aprovados, montar o
 * fluxo reativo da persona com um clique.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, GitBranch, Rocket } from 'lucide-react';
import { getActivePersona } from '../../core/personaManager';
import { usePolling } from '../../core/usePolling';
import {
  buildFlow,
  EMPTY_ITEM,
  FACE_KEY,
  fetchJob,
  fetchStudio,
  inputKeys,
  listStudioPersonas,
  removeAsset,
  startGeneration,
  updateItem,
  uploadAsset,
  WORKFLOW_CHANGED_EVENT,
  type FlowSummary,
  type ItemStatus,
  type StudioItemState,
  type StudioView,
} from '../../core/idleStudioApi';
import { safeLocal } from '../../lib/safeStorage';
import { ErrorState } from '../common/OperationalState';
import { useToast } from '../Toast';
import { Button, ConfirmButton, PanelSkeleton, Tabs } from '../ui';
import { StudioItemCard, type StudioEntry } from './StudioItemCard';

type Kind = 'images' | 'videos';
const UI_KEY = 'odessa:idle-studio:ui';
const JOB_POLL_MS = 3000;
const STUDIO_POLL_MS = 30_000;
const FICHA_LABELS: Record<string, string> = {
  IDENTITY: 'Rosto e cabelo',
  WARDROBE: 'Roupa e joias',
  ROOM: 'Cenário',
  LIGHT: 'Luz',
  MIC: 'Microfone',
  MOTION: 'Jeito de se mexer',
  DRINK: 'Bebida',
  PET: 'Pet',
};

type UiState = { personaId: string; kind: Kind; lote: string; category: string; onlyOpen: boolean };

function readUi(): UiState {
  const fallback: UiState = { personaId: '', kind: 'images', lote: 'all', category: 'all', onlyOpen: false };
  return { ...fallback, ...safeLocal.getJSON<Partial<UiState>>(UI_KEY, {}) };
}

function ProgressBar({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="font-semibold tabular-nums text-slate-100">{done}/{total}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-sky-400 transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FlowResult({ flow }: { flow: FlowSummary }) {
  return (
    <div className="anim-fade-in space-y-1 rounded-2xl border border-white/5 bg-black/30 p-3 text-xs text-slate-400">
      <div className="text-slate-200">
        {flow.published ? 'Publicado' : 'Rascunho montado'} em {new Date(flow.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
      </div>
      <div>
        IDLE <code className="text-slate-300">{flow.idleVideoId}</code> · {flow.videos} vídeos · ciclo natural com {flow.cycle} clipes · {flow.triggers} gatilhos
        {flow.alternatives ? ` (${flow.alternatives} alternativas desligadas)` : ''}
      </div>
      {flow.outOfCycle.length > 0 && (
        <div className="text-amber-300">
          Fora do ciclo (falta o clipe de volta para A0): {flow.outOfCycle.join(', ')}
        </div>
      )}
    </div>
  );
}

export default function IdleStudioPage() {
  const toast = useToast();
  const [ui, setUi] = useState<UiState>(readUi);
  const [personas, setPersonas] = useState<{ id: string; name: string }[]>([]);
  const [view, setView] = useState<StudioView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<Record<string, string>>({});
  const [building, setBuilding] = useState<'draft' | 'publish' | null>(null);
  const viewPersona = useRef('');

  const patchUi = (patch: Partial<UiState>) =>
    setUi((current) => {
      const next = { ...current, ...patch };
      safeLocal.setJSON(UI_KEY, next);
      return next;
    });

  // Personas com plano; abre na persona ativa na primeira vez.
  useEffect(() => {
    let alive = true;
    Promise.all([listStudioPersonas(), getActivePersona().catch(() => null)])
      .then(([list, active]) => {
        if (!alive) return;
        setPersonas(list.personas);
        setUi((current) => {
          if (list.personas.some((p) => p.id === current.personaId)) return current;
          const activeId = active?.persona?.id;
          const personaId = list.personas.find((p) => p.id === activeId)?.id ?? list.personas[0]?.id ?? '';
          return { ...current, personaId };
        });
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Não consegui carregar o Estúdio.'));
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async (personaId: string, signal?: AbortSignal) => {
    try {
      const data = await fetchStudio(personaId, signal);
      viewPersona.current = personaId;
      setView(data);
      setError(null);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : 'Não consegui carregar o Estúdio.');
    }
  }, []);

  // Recarrega ao trocar de persona e de tempos em tempos (pausa com a página escondida).
  const refresh = useCallback((signal: AbortSignal) => (ui.personaId ? load(ui.personaId, signal) : undefined), [ui.personaId, load]);
  usePolling(refresh, STUDIO_POLL_MS, { restartKey: refresh, enabled: Boolean(ui.personaId) });

  const personaId = view?.persona.id ?? '';
  const items = view?.items;

  const setItem = useCallback((pid: string, key: string, state: StudioItemState) => {
    setView((current) => (current && viewPersona.current === pid ? { ...current, items: { ...current.items, [key]: state } } : current));
  }, []);

  const setBusyKey = (key: string, label: string | null) =>
    setBusy((current) => {
      const next = { ...current };
      if (label) next[key] = label;
      else delete next[key];
      return next;
    });

  const onUpload = useCallback(
    async (key: string, files: File[]) => {
      const pid = viewPersona.current;
      setBusyKey(key, 'Enviando…');
      try {
        for (const file of files) setItem(pid, key, await uploadAsset(pid, key, file));
        toast.success(files.length > 1 ? `${files.length} arquivos anexados e renomeados.` : 'Anexado e renomeado pela etapa.');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não consegui anexar.');
      } finally {
        setBusyKey(key, null);
      }
    },
    [setItem, toast],
  );

  const mutate = useCallback(
    async (key: string, run: () => Promise<StudioItemState>, failMsg: string) => {
      const pid = viewPersona.current;
      try {
        setItem(pid, key, await run());
      } catch (e) {
        toast.error(e instanceof Error ? e.message : failMsg);
      }
    },
    [setItem, toast],
  );

  const onStatus = useCallback(
    (key: string, status: ItemStatus) => void mutate(key, () => updateItem(viewPersona.current, key, { status }), 'Não consegui salvar o status.'),
    [mutate],
  );
  const onChoose = useCallback(
    (key: string, chosen: string) => void mutate(key, () => updateItem(viewPersona.current, key, { chosen }), 'Não consegui escolher.'),
    [mutate],
  );
  const onRemove = useCallback(
    (key: string, assetId: string) => void mutate(key, () => removeAsset(viewPersona.current, key, assetId), 'Não consegui remover.'),
    [mutate],
  );
  const onGenerate = useCallback(
    async (key: string) => {
      try {
        const job = await startGeneration(viewPersona.current, key);
        setJobs((current) => ({ ...current, [key]: job.jobId }));
        setBusyKey(key, 'Gerando…');
        toast.info(`Gerando ${key} via ${job.provider}. O resultado entra aqui sozinho.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não consegui iniciar a geração.');
      }
    },
    [toast],
  );

  // Acompanha as gerações em andamento até terminarem.
  useEffect(() => {
    const pending = Object.entries(jobs);
    if (!pending.length) return;
    const timer = window.setTimeout(async () => {
      for (const [key, jobId] of pending) {
        const job = await fetchJob(jobId).catch(() => null);
        if (job && job.status === 'generating') continue;
        setJobs((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        setBusyKey(key, null);
        if (job?.status === 'done') {
          toast.success(`${key} gerado e anexado. Confira e aprove.`);
          void load(viewPersona.current);
        } else {
          toast.error(job?.error ? `Geração de ${key} falhou: ${job.error}` : `Perdi o acompanhamento de ${key}.`);
        }
      }
    }, JOB_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [jobs, load, toast]);

  const onBuildFlow = async (publish: boolean) => {
    setBuilding(publish ? 'publish' : 'draft');
    try {
      const summary = await buildFlow(personaId, publish);
      setView((current) => (current ? { ...current, lastFlow: summary } : current));
      window.dispatchEvent(new Event(WORKFLOW_CHANGED_EVENT));
      toast.success(publish ? 'Fluxo montado e publicado: a live já usa os clipes novos.' : 'Rascunho do fluxo montado. Revise e publique em Automações.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui montar o fluxo.');
    } finally {
      setBuilding(null);
    }
  };

  const derived = useMemo(() => {
    if (!view) return null;
    const state = (key: string) => view.items[key] ?? EMPTY_ITEM;
    const done = (key: string) => state(key).status === 'aprovado';
    const imageEntries: StudioEntry[] = [
      { kind: 'image', key: FACE_KEY, image: null },
      ...view.images.map((image) => ({ kind: 'image' as const, key: image.file, image })),
    ];
    const videoEntries: StudioEntry[] = [...view.videos]
      .sort((a, b) => a.lote - b.lote || a.number - b.number)
      .map((video) => ({ kind: 'video' as const, key: video.file, video }));
    const lote = (n: number) => {
      const list = view.videos.filter((v) => v.lote === n);
      return { done: list.filter((v) => done(v.file)).length, total: list.length };
    };
    const next =
      imageEntries.find((e) => !done(e.key)) ?? videoEntries.find((e) => !done(e.key)) ?? null;
    const blockedBy = !next
      ? []
      : next.kind === 'video'
        ? [...new Set([next.video.firstFrame, next.video.lastFrame])].filter((k) => !done(k))
        : inputKeys(next.image?.inputs ?? '').filter((k) => !done(k));
    const categories = ['all', ...new Set(view.videos.map((v) => v.categoryLabel))];
    const approvedVideos = view.videos.filter((v) => done(v.file)).length;
    return {
      imageEntries,
      videoEntries,
      progress: {
        images: { done: imageEntries.filter((e) => done(e.key)).length, total: imageEntries.length },
        l0: lote(0),
        l1: lote(1),
        l2: lote(2),
      },
      next,
      blockedBy,
      categories,
      approvedVideos,
    };
  }, [view]);

  const shown = useMemo(() => {
    if (!derived || !items) return [];
    const open = (key: string) => (items[key] ?? EMPTY_ITEM).status !== 'aprovado';
    const list = ui.kind === 'images' ? derived.imageEntries : derived.videoEntries;
    return list.filter(
      (e) =>
        (!ui.onlyOpen || open(e.key)) &&
        (e.kind === 'image' ||
          ((ui.lote === 'all' || String(e.video.lote) === ui.lote) && (ui.category === 'all' || e.video.categoryLabel === ui.category))),
    );
  }, [derived, items, ui.kind, ui.lote, ui.category, ui.onlyOpen]);

  const goToNext = () => {
    const next = derived?.next;
    if (!next) return;
    patchUi({ kind: next.kind === 'video' ? 'videos' : 'images', lote: 'all', category: 'all', onlyOpen: false });
    window.setTimeout(() => {
      const el = document.getElementById(`studio-item-${next.key}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  if (error && !view) {
    return <ErrorState title="Estúdio indisponível" message={error} onRetry={() => ui.personaId && void load(ui.personaId)} className="h-full" />;
  }
  if (!view || !derived || !items || view.persona.id !== ui.personaId) {
    return <PanelSkeleton label="Carregando o Estúdio da IDLE" className="m-4" />;
  }

  const providers = view.providers;
  const genHint = (kind: 'image' | 'video') =>
    providers[kind].ready
      ? `Gera com ${providers[kind].name} e anexa o resultado aqui`
      : kind === 'video'
        ? 'Configure um provedor de vídeo (VIDEO_GEN_PROVIDER) no backend para gerar com um clique'
        : 'Configure GEMINI_API_KEY ou Higgsfield no backend para gerar com um clique';

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={ui.personaId}
          onChange={(id) => patchUi({ personaId: id })}
          items={personas.map((p) => ({ id: p.id, label: p.name }))}
        />
        <p className="text-xs text-slate-400">
          Copie o prompt ou gere por API, anexe o resultado (o nome vira o da etapa sozinho), aprove, e monte o fluxo da live com um clique.
        </p>
      </div>

      <details className="group rounded-[26px] border border-white/10 bg-[#0b0d10] p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-200">Ficha de {view.persona.name}: o que vai em todos os prompts</summary>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.entries(FICHA_LABELS).map(([k, label]) => (
            <div key={k}>
              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
              <dd className="text-xs leading-relaxed text-slate-300">{view.persona.ficha[k]}</dd>
            </div>
          ))}
        </dl>
      </details>

      <section className="space-y-4 rounded-[26px] border border-white/10 bg-[#0b0d10] p-4" aria-live="polite">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <ProgressBar label="Imagens (com foto de rosto)" {...derived.progress.images} />
          <ProgressBar label="Vídeos · lote 0 (teste)" {...derived.progress.l0} />
          <ProgressBar label="Vídeos · lote 1 (ir ao ar)" {...derived.progress.l1} />
          <ProgressBar label="Vídeos · lote 2 (variedade)" {...derived.progress.l2} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-3">
          {derived.next ? (
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Próximo passo</div>
              <div className="text-sm text-slate-100">
                <code className="font-semibold">{derived.next.key}</code>{' '}
                <span className="text-slate-500">{derived.next.kind === 'video' ? `Vídeo · lote ${derived.next.video.lote}` : 'Imagem'}</span>
              </div>
              {derived.blockedBy.length > 0 && <div className="text-xs text-amber-300">Antes, aprove: {derived.blockedBy.join(', ')}</div>}
            </div>
          ) : (
            <div className="text-sm font-semibold text-emerald-300">Tudo aprovado para {view.persona.name}.</div>
          )}
          {derived.next && (
            <Button size="sm" variant="secondary" onClick={goToNext}>
              Ir para o próximo
            </Button>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-[26px] border border-sky-400/20 bg-sky-500/[0.04] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <GitBranch className="h-4 w-4 text-sky-300" />
              Montar o fluxo da live no Odessa
            </h3>
            <p className="text-xs leading-relaxed text-slate-400">
              Pega os {derived.approvedVideos} vídeos aprovados, cadastra na persona ativa e monta o fluxo reativo: a IDLE, o ciclo natural
              pelos estados A0–A3 (só entra num estado se houver o clipe de volta) e um gatilho por evento (presente, seguidor, palavra no chat;
              segmentos ficam manuais). O que você criou à mão no fluxo é mantido.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onBuildFlow(false)}
              loading={building === 'draft'}
              disabled={!derived.approvedVideos || building !== null}
            >
              <Clapperboard className="h-3.5 w-3.5" />
              Montar rascunho
            </Button>
            <ConfirmButton
              size="sm"
              variant="primary"
              confirmLabel="Publicar na live?"
              onConfirm={() => onBuildFlow(true)}
              loading={building === 'publish'}
              disabled={!derived.approvedVideos || building !== null}
            >
              <Rocket className="h-3.5 w-3.5" />
              Montar e publicar
            </ConfirmButton>
            <Button size="sm" variant="ghost" onClick={() => (window.location.hash = '#/automacoes')}>
              Abrir Automações
            </Button>
          </div>
        </div>
        {view.lastFlow && <FlowResult flow={view.lastFlow} />}
      </section>

      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-2xl bg-[#07080a]/95 px-1 py-2 backdrop-blur">
        <Tabs
          size="sm"
          value={ui.kind}
          onChange={(id) => patchUi({ kind: id as Kind })}
          items={[
            { id: 'images', label: `Imagens (${derived.imageEntries.length})` },
            { id: 'videos', label: `Vídeos (${derived.videoEntries.length})` },
          ]}
        />
        {ui.kind === 'videos' && (
          <>
            <Tabs
              size="sm"
              value={ui.lote}
              onChange={(id) => patchUi({ lote: id })}
              items={[
                { id: 'all', label: 'Todos' },
                { id: '0', label: 'Lote 0' },
                { id: '1', label: 'Lote 1' },
                { id: '2', label: 'Lote 2' },
              ]}
            />
            <select
              value={ui.category}
              onChange={(e) => patchUi({ category: e.target.value })}
              aria-label="Categoria"
              className="h-8 rounded-full border border-white/10 bg-[var(--bg3)] px-3 text-xs text-slate-200"
            >
              {derived.categories.map((c) => (
                <option key={c} value={c}>{c === 'all' ? 'Todas as categorias' : c}</option>
              ))}
            </select>
          </>
        )}
        <Button size="sm" variant={ui.onlyOpen ? 'secondary' : 'ghost'} aria-pressed={ui.onlyOpen} onClick={() => patchUi({ onlyOpen: !ui.onlyOpen })}>
          Só o que falta
        </Button>
        <span className="ml-auto text-xs tabular-nums text-slate-500">{shown.length} de {ui.kind === 'images' ? derived.imageEntries.length : derived.videoEntries.length}</span>
      </div>

      <div className="space-y-3">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">Nada aqui com esses filtros.</p>
        ) : (
          shown.map((entry) => (
            <StudioItemCard
              key={`${personaId}-${entry.key}`}
              entry={entry}
              state={items[entry.key] ?? EMPTY_ITEM}
              states={items}
              negative={view.persona.negative}
              busy={busy[entry.key]}
              generateReady={providers[entry.kind].ready && !busy[entry.key]}
              generateHint={genHint(entry.kind)}
              onUpload={onUpload}
              onStatus={onStatus}
              onChoose={onChoose}
              onRemove={onRemove}
              onGenerate={onGenerate}
            />
          ))
        )}
      </div>
    </div>
  );
}
