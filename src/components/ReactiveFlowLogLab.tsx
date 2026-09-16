/**
 * ReactiveFlowLogLab — laboratório de teste do fluxo reativo + timeline de
 * auditoria da Diretora (rodadas do autopilot, logs do backend). Extraído de
 * OdessaLiveCenter.tsx (redesenho do frontend, fase 3.1) para virar um chunk
 * lazy — só usado na sub-aba "Logs de Automação" de Automações.
 */
import { useState, type ReactNode } from 'react';
import { ClipboardCheck, Download, ListVideo, Play, RadioTower, RefreshCw, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge, Button } from './ui';
import type { AutopilotRuntimeState } from '../core/useAutopilotRuntime';
import type { AuditTimelineEntry, AutopilotCycle, CapturedMessage } from '../types';
import type { AutomationLogEntry, ReactiveRunResult, VideoState } from '../OdessaLiveCenter';

function textValue(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

type AuditTimelineFilter = 'all' | 'chat' | 'gift' | 'video' | 'obs' | 'moderation' | 'error';

const AUDIT_FILTERS: Array<{ id: AuditTimelineFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'chat', label: 'Chat' },
  { id: 'gift', label: 'Presente' },
  { id: 'video', label: 'Video' },
  { id: 'obs', label: 'OBS' },
  { id: 'moderation', label: 'Moderacao' },
  { id: 'error', label: 'Erro' },
];

function actionAuditType(action: AutopilotCycle['actions'][number]): AuditTimelineEntry['type'] {
  if (action.status === 'error') return 'error';
  if (action.capability === 'chat.reply') return 'chat';
  if (action.capability === 'gift.acknowledge') return 'gift';
  if (action.capability === 'media.play_video' || action.capability === 'media.play_music') return 'video';
  if (action.capability === 'obs.switch_scene' || action.capability === 'obs.show_overlay') return 'obs';
  if (action.capability === 'moderation.message') return 'moderation';
  return 'execution';
}

function auditEntriesForCycle(cycle: AutopilotCycle): AuditTimelineEntry[] {
  if (Array.isArray(cycle.timeline) && cycle.timeline.length) return cycle.timeline;
  const createdAt = cycle.createdAt || new Date().toISOString();
  return [
    {
      id: `${cycle.id}-capture`,
      at: createdAt,
      time: cycle.event.time,
      type: 'capture',
      title: 'Eventos capturados para a rodada',
      status: 'done',
      payload: { events: cycle.events },
    },
    ...(cycle.decision
      ? [{
          id: `${cycle.id}-decision`,
          at: createdAt,
          time: cycle.event.time,
          type: 'decision' as const,
          title: 'Decisao da IA/Diretora',
          status: 'done' as const,
          payload: cycle.decision as unknown as Record<string, unknown>,
        }]
      : []),
    ...cycle.actions.map((action): AuditTimelineEntry => {
      const status: AuditTimelineEntry['status'] =
        action.status === 'error'
          ? 'error'
          : action.status === 'blocked' || action.status === 'approval_required'
            ? 'blocked'
            : action.status === 'queued' || action.status === 'running'
              ? 'queued'
              : 'done';
      return {
        id: `${cycle.id}-${action.id}`,
        at: action.createdAt || createdAt,
        time: cycle.event.time,
        type: actionAuditType(action),
        title: action.label,
        status,
        actionId: action.id,
        payload: {
          capability: action.capability,
          mode: action.executionMode || (action.requiresApproval ? 'approval_required' : action.simulated ? 'simulated' : 'real'),
          chatAutomationStatus: action.chatAutomationStatus,
          status: action.status,
          payload: action.payload,
        },
        result: action.result,
      };
    }),
    ...(cycle.error
      ? [{
          id: `${cycle.id}-error`,
          at: cycle.completedAt || createdAt,
          time: cycle.event.time,
          type: 'error' as const,
          title: 'Erro na rodada',
          status: 'error' as const,
          payload: { stage: cycle.stage, error: cycle.error },
          result: cycle.error,
        }]
      : []),
  ];
}

function matchesAuditFilter(entry: AuditTimelineEntry, filter: AuditTimelineFilter) {
  if (filter === 'all') return true;
  if (filter === 'error') return entry.type === 'error' || entry.status === 'error';
  return entry.type === filter;
}

function AuditTimelineRow({ entry }: { entry: AuditTimelineEntry }) {
  const mode = typeof entry.payload?.mode === 'string' ? entry.payload.mode : null;
  const chatStatus = typeof entry.payload?.chatAutomationStatus === 'string'
    ? entry.payload.chatAutomationStatus
    : null;
  return (
    <div className={cn('rounded-xl border bg-black/25 p-3', entry.status === 'error' ? 'border-red-400/30' : 'border-white/10')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 shrink-0 font-mono text-[10px] text-slate-500">{entry.time}</span>
        <Badge variant={entry.status === 'error' || entry.status === 'blocked' ? 'warning' : entry.status === 'done' ? 'success' : 'lavender'}>
          {entry.type}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{entry.title}</span>
        {mode && <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300">{mode}</span>}
        {chatStatus && <span className="rounded-full border border-sky-200/20 bg-sky-300/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-sky-100">{chatStatus}</span>}
      </div>
      {entry.result && <div className="mt-2 text-xs text-slate-300">{entry.result}</div>}
      {entry.payload && (
        <pre className="mt-2 max-h-44 overflow-auto rounded-xl bg-black/40 p-2 text-[10px] text-slate-400">
          {JSON.stringify(entry.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

function FlowDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--t1)]">
      <span className="flex h-4 w-4 items-center justify-center text-[var(--sky)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.75]">
        {icon}
      </span>
      {title}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="anim-card-in min-w-0 rounded-[22px] border border-[var(--border2)] bg-black/20 p-4 shadow-[var(--shadow-1)] transition-all duration-200 hover:border-[var(--border3)] hover:shadow-[0_0_24px_rgba(125,211,252,0.08)]">
      <div className="heading-serif truncate text-[34px] leading-none text-[var(--t1)]">{value}</div>
      <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--t3)]">
        {label}
      </div>
    </div>
  );
}

export default function ReactiveFlowLogLab({
  capturedText,
  logs,
  latestRun,
  error,
  busy,
  videoState,
  runtime,
  onRefreshLogs,
  onRun,
}: {
  capturedText: CapturedMessage[];
  logs: AutomationLogEntry[];
  latestRun: ReactiveRunResult | null;
  error: string | null;
  busy: boolean;
  videoState: VideoState | null;
  runtime: AutopilotRuntimeState;
  onRefreshLogs: () => Promise<void>;
  onRun: (text: string, source?: string) => Promise<ReactiveRunResult | null>;
}) {
  const [text, setText] = useState('Lucas enviou Rosa');
  const [auditFilter, setAuditFilter] = useState<AuditTimelineFilter>('all');
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);
  const [visibleRounds, setVisibleRounds] = useState(8);
  const parsedEvent = latestRun?.test.events?.[0];
  const matched = latestRun?.test.matchedTriggers || [];
  const queued = latestRun?.test.queuedActions || [];
  const executed = latestRun?.executions.filter((item) => item.status !== 'empty') || [];
  const quickInputs = [
    'Lucas enviou Rosa',
    '@Viewer: oi',
    '@AnaStarlight: Boa! Mandou muito bem',
    'xXSpamXx: COMPRE SEGUIDORES BARATO www.fake.com',
  ];

  const submit = (nextText = text) => {
    setText(nextText);
    void onRun(nextText, 'test');
  };

  // ⚡ Bolt: Using a backward for-loop instead of .slice().reverse().filter().slice()
  // to avoid O(N) memory allocation and multiple traversals on every render.
  const auditCycles: typeof runtime.cycles = [];
  for (let i = runtime.cycles.length - 1; i >= 0 && auditCycles.length < visibleRounds; i--) {
    const cycle = runtime.cycles[i];
    if (auditFilter === 'all' || auditEntriesForCycle(cycle).some((entry) => matchesAuditFilter(entry, auditFilter))) {
      auditCycles.push(cycle);
    }
  }

  return (
    <div className="grid min-h-full gap-4 p-4 xl:grid-cols-[minmax(540px,1fr)_420px]">
      <section className="flex min-h-0 flex-col gap-4">
        <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.26em] text-sky-200/70">
                Laboratorio do fluxo
              </div>
              <div className="mt-1 text-sm text-slate-400">
                O texto entra no backend e drena a fila ate o video mudar.
              </div>
            </div>
            <Button variant="secondary" onClick={() => void onRefreshLogs()}>
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
          </div>

          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white outline-none focus:border-sky-200/45"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" loading={busy} onClick={() => submit()}>
              <Play className="h-4 w-4" />
              Testar fluxo
            </Button>
            {quickInputs.map((sample) => (
              <Button key={sample} variant="secondary" onClick={() => submit(sample)}>
                {sample.length > 24 ? `${sample.slice(0, 24)}...` : sample}
              </Button>
            ))}
          </div>
          {error && (
            <div className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {error}
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Evento" value={textValue(parsedEvent?.kind)} />
          <Metric label="Gatilhos" value={matched.length} />
          <Metric label="Fila" value={queued.length} />
          <Metric label="Execucoes" value={executed.length} />
        </div>

        <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SectionTitle icon={<ClipboardCheck />} title="Timeline da Diretora" />
            <div className="ml-auto flex flex-wrap gap-1.5">
              {AUDIT_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setAuditFilter(filter.id)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition',
                    auditFilter === filter.id
                      ? 'border-sky-200/45 bg-sky-300/15 text-sky-100'
                      : 'border-white/10 bg-white/[0.035] text-slate-500 hover:text-slate-200',
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            {auditCycles.map((cycle) => {
              const entries = auditEntriesForCycle(cycle).filter((entry) =>
                matchesAuditFilter(entry, auditFilter),
              );
              const chatStatus = cycle.actions.find((action) => action.capability === 'chat.reply')?.chatAutomationStatus;
              const hasError = cycle.stage === 'erro' || entries.some((entry) => entry.status === 'error');
              const expanded = expandedCycleId === cycle.id;
              return (
                <div key={cycle.id} className={cn('rounded-2xl border bg-white/[0.035] p-3', hasError ? 'border-red-400/30' : 'border-white/10')}>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={hasError ? 'warning' : cycle.stage === 'concluido' ? 'success' : 'lavender'}>
                          {cycle.stage}
                        </Badge>
                        <span className="truncate text-sm font-semibold text-white">
                          {cycle.event.kind} / {cycle.decision?.intent || 'sem decisao'}
                        </span>
                        {chatStatus && <span className="rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300">chat: {chatStatus}</span>}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-slate-400">{cycle.event.text}</div>
                      {cycle.error && <div className="mt-2 text-xs text-red-200">{cycle.error}</div>}
                    </div>
                    <button
                      className="odsa-btn odsa-btn-secondary odsa-btn-md odsa-btn-icon"
                      title="Replay em modo teste"
                      disabled={runtime.isProcessing}
                      onClick={() => void runtime.replayRound(cycle.id)}
                    >
                      <RotateCcw style={{ width: 14, height: 14 }} />
                    </button>
                    <button
                      className="odsa-btn odsa-btn-secondary odsa-btn-md"
                      onClick={() => setExpandedCycleId(expanded ? null : cycle.id)}
                    >
                      {expanded ? 'Ocultar' : 'Detalhes'}
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-3 space-y-2">
                      {entries.map((entry) => (
                        <AuditTimelineRow key={entry.id} entry={entry} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!auditCycles.length && (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-500">
                Nenhuma rodada encontrada para este filtro.
              </div>
            )}
            {runtime.cycles.length > visibleRounds && (
              <Button variant="secondary" onClick={() => setVisibleRounds((value) => value + 8)}>
                Mostrar mais rodadas
              </Button>
            )}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
          <div className="min-h-[260px] overflow-y-auto rounded-[28px] border border-white/10 bg-[#101114] p-4">
            <SectionTitle icon={<RadioTower />} title="Ultimo teste" />
            <div className="mt-4 space-y-3 text-sm">
              <FlowDatum label="Entrada" value={latestRun?.input || 'aguardando teste'} />
              <FlowDatum label="Tipo parseado" value={textValue(parsedEvent?.kind)} />
              <FlowDatum label="Gift key" value={textValue(parsedEvent?.gift_key)} />
              <FlowDatum label="Mensagem" value={textValue(parsedEvent?.message || parsedEvent?.text)} />
              <FlowDatum label="Gatilho" value={textValue(matched[0]?.name || matched[0]?.id)} />
              <FlowDatum label="Video enfileirado" value={textValue(queued[0]?.videoId)} />
              <FlowDatum
                label="Video atual"
                value={textValue(videoState?.current_video_id || latestRun?.executions[0]?.videoState?.current_video_id)}
              />
            </div>
          </div>

          <div className="min-h-[260px] overflow-y-auto rounded-[28px] border border-white/10 bg-[#101114] p-4">
            <SectionTitle icon={<ListVideo />} title="Eventos capturados" />
            <div className="mt-4 space-y-2 pr-1">
              {(() => {
                // ⚡ Bolt: Using backward loop instead of slice(-10).reverse()
                const recentEvents = [];
                for (let i = capturedText.length - 1; i >= Math.max(0, capturedText.length - 10); i--) {
                  recentEvents.push(capturedText[i]);
                }
                return recentEvents.map((event) => (
                  <div key={event.id} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                    <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-[var(--t3)]">
                      <span>{event.kind} / {event.source}</span>
                      <span>{event.time}</span>
                    </div>
                    <div className="line-clamp-2 text-sm text-slate-200">{event.text}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-slate-500">
                      <span>{event.zoneName || 'sem zona'}</span>
                      {typeof event.metadata?.confidence === 'number' && (
                        <span>{Math.round(event.metadata.confidence * 100)}% conf.</span>
                      )}
                      {event.metadata?.backendIngested === true && <span>backend</span>}
                    </div>
                  </div>
                ));
              })()}
              {!capturedText.length && <div className="text-sm text-slate-500">Nenhum evento capturado.</div>}
            </div>
          </div>
        </div>
      </section>

      <aside className="min-h-[320px] overflow-y-auto rounded-[28px] border border-white/10 bg-[#101114] p-4">
        <div className="flex items-center gap-2">
          <SectionTitle icon={<ListVideo />} title="Timeline backend" />
          <Button variant="secondary" onClick={runtime.exportSession}>
            <Download className="h-4 w-4" />
            JSON
          </Button>
        </div>
        <div className="mt-4 space-y-2 pr-1">
          {logs.map((entry, index) => (
            <div key={`${entry.timestamp}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <Badge variant={entry.stage === 'EXECUTOR' ? 'success' : entry.stage === 'FILTER' ? 'warning' : 'lavender'}>
                  {entry.stage}
                </Badge>
                <span className="text-[10px] text-slate-500">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="text-sm text-slate-200">{entry.message}</div>
              {entry.data && (
                <pre className="mt-2 max-h-24 overflow-auto rounded-xl bg-black/35 p-2 text-[10px] text-slate-400">
                  {JSON.stringify(entry.data, null, 2)}
                </pre>
              )}
            </div>
          ))}
          {!logs.length && <div className="text-sm text-slate-500">Sem logs do backend ainda.</div>}
        </div>
      </aside>
    </div>
  );
}
