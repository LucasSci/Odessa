import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Bot,
  CheckCircle2,
  Download,
  Gauge,
  Gift,
  Layers,
  MessageSquare,
  Music,
  Pause,
  Play,
  RadioTower,
  RefreshCcw,
  RotateCcw,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  SplitSquareHorizontal,
  Square,
  Volume2,
  VolumeX,
  Wand2,
  Zap,
} from 'lucide-react';
import { actionSummary } from './core/actionExecutor';
import type { AutopilotRuntimeState } from './core/useAutopilotRuntime';
import {
  createScenarioQueue,
  EVENT_TYPE_COLORS,
  EVENT_TYPE_ICONS,
  generateEventBatch,
  SIM_SPEEDS,
  type SimulatedEvent,
  type SimSpeed,
} from './lib/simulation';
import { cn } from './lib/utils';
import type {
  AutopilotAction,
  CapturedMessage,
  CycleStage,
  LiveEvent,
  LiveEventKind,
} from './types';

interface LiveAutopilotConsoleProps {
  capturedText: CapturedMessage[];
  runtime: AutopilotRuntimeState;
}

const TEST_EVENTS: Array<{
  kind: LiveEventKind;
  label: string;
  text: string;
  icon: typeof MessageSquare;
}> = [
  {
    kind: 'chat',
    label: 'Chat',
    text: 'Ana disse oi e perguntou como esta a live.',
    icon: MessageSquare,
  },
  {
    kind: 'gift',
    label: 'Rosa x5',
    text: 'Ana enviou Rosa x5.',
    icon: Gift,
  },
  {
    kind: 'gift',
    label: 'Resgate cena',
    text: 'Lucas resgatou Trocar Cena: Gameplay Focus.',
    icon: SplitSquareHorizontal,
  },
  {
    kind: 'gift',
    label: 'Musica',
    text: 'Lucas resgatou Escolher musica: synthwave neon.',
    icon: Music,
  },
  {
    kind: 'system',
    label: 'Chat quieto',
    text: 'Assunto atual acabou / chat quieto. Puxar novo topico.',
    icon: RadioTower,
  },
  {
    kind: 'moderation',
    label: 'Moderacao',
    text: 'Mensagem suspeita no chat pedindo link externo e spam repetido.',
    icon: ShieldAlert,
  },
];

type SimLogItem = {
  id: string;
  event: SimulatedEvent;
  time: string;
};

function statusTone(stage: CycleStage) {
  if (stage === 'concluido') return 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30';
  if (stage === 'erro') return 'text-rose-200 bg-rose-500/10 border-rose-400/30';
  if (stage === 'executando') return 'text-amber-200 bg-amber-500/10 border-amber-400/30';
  return 'text-sky-200 bg-sky-500/10 border-sky-400/30';
}

function actionTone(status: AutopilotAction['status']) {
  if (status === 'done') return 'bg-emerald-500/10 text-emerald-300';
  if (status === 'n8n_dispatched') return 'bg-cyan-500/10 text-cyan-300';
  if (status === 'simulated') return 'bg-sky-500/10 text-sky-300';
  if (status === 'error' || status === 'blocked') return 'bg-rose-500/10 text-rose-300';
  if (status === 'approval_required') return 'bg-violet-500/10 text-violet-300';
  if (status === 'running') return 'bg-amber-500/10 text-amber-300';
  return 'bg-slate-800 text-slate-400';
}

function StepPill({ stage, active }: { key?: string; stage: CycleStage; active: boolean }) {
  return (
    <span
      className={cn(
        'rounded-md border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide',
        active ? statusTone(stage) : 'border-slate-800 bg-slate-950/50 text-slate-600',
      )}
    >
      {stage}
    </span>
  );
}

function metadataPreview(event: LiveEvent) {
  const metadata = event.metadata || {};
  const keys = [
    'user',
    'giftName',
    'quantity',
    'redeemable',
    'mappedAction',
    'requestedScene',
    'requestedTrack',
  ];
  const parts = keys
    .filter((key) => metadata[key] !== undefined)
    .map((key) => `${key}: ${String(metadata[key])}`);
  return parts.join(' | ');
}

function simulatedKind(type: SimulatedEvent['type']): LiveEventKind {
  if (type === 'gift' || type === 'redeem_scene' || type === 'redeem_music') return 'gift';
  if (type === 'quiet_moment') return 'system';
  if (type === 'follow' || type === 'alert') return 'alert';
  if (type === 'moderation') return 'moderation';
  return 'chat';
}

export default function LiveAutopilotConsole({ capturedText, runtime }: LiveAutopilotConsoleProps) {
  const injectRuntimeEvent = runtime.injectEvent;
  const startRuntime = runtime.start;
  const testModeEnabled = runtime.testMode;
  const [manualText, setManualText] = useState('');
  const [simActive, setSimActive] = useState(false);
  const [simSpeed, setSimSpeed] = useState<SimSpeed>('normal');
  const [simLog, setSimLog] = useState<SimLogItem[]>([]);
  const simScenarioQueueRef = useRef<SimulatedEvent[]>([]);
  const simTimerRef = useRef<number | null>(null);

  const injectEvent = (kind: LiveEventKind, text: string) => {
    injectRuntimeEvent(kind, text);
  };

  const injectManualEvent = () => {
    if (!manualText.trim()) return;
    injectEvent('chat', manualText.trim());
    setManualText('');
  };

  const runFullFlowTest = () => {
    startRuntime();
    TEST_EVENTS.forEach((event, index) => {
      window.setTimeout(() => injectRuntimeEvent(event.kind, event.text, 'test'), index * 120);
    });
  };

  const startSimulation = () => {
    if (!testModeEnabled) return;
    simScenarioQueueRef.current = createScenarioQueue();
    setSimLog([]);
    setSimActive(true);
    startRuntime();
  };

  const stopSimulation = () => {
    setSimActive(false);
    if (simTimerRef.current) {
      window.clearTimeout(simTimerRef.current);
      simTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!simActive || !testModeEnabled) return;

    const speedCfg = SIM_SPEEDS[simSpeed];
    const tick = () => {
      const count =
        speedCfg.eventsPerTick[Math.floor(Math.random() * speedCfg.eventsPerTick.length)];
      const scriptedEvents = simScenarioQueueRef.current.splice(0, count);
      const randomEvents =
        scriptedEvents.length < count ? generateEventBatch(count - scriptedEvents.length) : [];
      const events = [...scriptedEvents, ...randomEvents];
      const time = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      events.forEach((event) => {
        injectRuntimeEvent(simulatedKind(event.type), event.text, 'test');
      });
      setSimLog((current) =>
        [
          ...current,
          ...events.map((event) => ({
            id: crypto.randomUUID(),
            event,
            time,
          })),
        ].slice(-80),
      );

      const delay = speedCfg.minMs + Math.random() * (speedCfg.maxMs - speedCfg.minMs);
      simTimerRef.current = window.setTimeout(tick, delay);
    };

    tick();
    return () => {
      if (simTimerRef.current) window.clearTimeout(simTimerRef.current);
      simTimerRef.current = null;
    };
  }, [injectRuntimeEvent, testModeEnabled, simActive, simSpeed]);

  useEffect(() => {
    if (testModeEnabled || !simActive) return;
    const timer = window.setTimeout(() => setSimActive(false), 0);
    return () => window.clearTimeout(timer);
  }, [testModeEnabled, simActive]);

  const stages: CycleStage[] = ['capturado', 'interpretado', 'decidido', 'executando', 'concluido'];
  const {
    actionQueue,
    autopilotEnabled,
    averageConfidence,
    completedCycles,
    currentRoundEvents,
    cycles,
    failedCycles,
    health,
    healthCheckedAt,
    healthError,
    isProcessing,
    lastError,
    latestCycle,
    latestDecision,
    memoryCount,
    recognizedUsersCount,
    pendingEvents,
    rules,
    roundCollectionMs,
    speechCooldownMs,
    testMode,
    tools,
    voiceEnabled,
  } = runtime;
  // ⚡ Bolt: Memoize array filtering to prevent recalculation on every render
  const activeTools = useMemo(() => tools.filter((tool) => tool.enabled).length, [tools]);
  const activeRules = useMemo(() => rules.filter((rule) => rule.enabled).length, [rules]);

  // ⚡ Bolt: Memoize slicing and reversing of the high-frequency event array
  const recentEvents = useMemo(() => capturedText.slice(-10).reverse(), [capturedText]);
  const n8nStatus = health?.n8n?.online
    ? 'online'
    : health?.n8n?.configured
      ? 'configurado'
      : 'off';
  const n8nTone = health?.n8n?.online
    ? 'text-cyan-300'
    : health?.n8n?.configured
      ? 'text-amber-300'
      : 'text-slate-500';
  const flowSteps = [
    {
      label: 'Entrada',
      ok: capturedText.length > 0 || pendingEvents.length > 0,
      detail: `${capturedText.length} evento(s) no Event Bus`,
    },
    {
      label: 'Classificacao',
      ok: Boolean(latestCycle?.event.metadata?.classifiedAt),
      detail: latestCycle?.event.kind || 'aguardando',
    },
    {
      label: 'Conteudo',
      ok: Boolean(latestCycle?.contentUsed?.length),
      detail: `${latestCycle?.contentUsed?.length || 0} item(ns) usado(s)`,
    },
    {
      label: 'Regras',
      ok: Boolean(latestCycle?.matchedRules.length),
      detail: `${latestCycle?.matchedRules.length || 0} regra(s)`,
    },
    {
      label: 'IA',
      ok: Boolean(latestDecision),
      detail: latestDecision?.intent || 'sem decisao',
    },
    {
      label: 'Acoes',
      ok: Boolean(latestCycle?.actions.length),
      detail: `${latestCycle?.actions.length || 0} acao(oes)`,
    },
    {
      label: 'TTS/chat',
      ok: Boolean(
        latestCycle?.actions.some(
          (action) => action.type === 'speak' || action.type === 'chat_reply',
        ),
      ),
      detail: latestCycle?.actions.find((action) => action.type === 'speak')?.status || 'pendente',
    },
    {
      label: 'Auditoria',
      ok: Boolean(latestCycle?.completedAt),
      detail: latestCycle?.completedAt ? 'registrada' : 'aguardando',
    },
  ];

  return (
    <main className="flex-1 overflow-y-auto bg-[var(--odessa-bg)] text-slate-100">
      <div className="grid min-h-full grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)_400px]">
        <aside className="border-b border-[var(--odessa-border)] bg-[var(--odessa-surface)] p-4 xl:border-b-0 xl:border-r">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                Persona Runtime
              </p>
              <h2 className="mt-1 text-lg font-black text-white">Controle Live</h2>
            </div>
            <span
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide',
                autopilotEnabled
                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-700 bg-slate-950 text-slate-400',
              )}
            >
              {autopilotEnabled ? 'Autopilot' : 'Pausado'}
            </span>
          </div>

          <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={runtime.start}
                disabled={autopilotEnabled}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-4 w-4 fill-current" />
                Iniciar
              </button>
              <button
                onClick={runtime.pause}
                disabled={!autopilotEnabled}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-xs font-black text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Pause className="h-4 w-4" />
                Pausar
              </button>
              <button
                onClick={runtime.toggleTestMode}
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-black transition',
                  testMode
                    ? 'border-sky-400/30 bg-sky-500/10 text-sky-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white',
                )}
              >
                <Wand2 className="h-4 w-4" />
                Modo teste
              </button>
              <button
                onClick={runtime.clearSession}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-black text-slate-300 transition hover:bg-slate-800"
                title="Resetar runtime local sem apagar persona ou memoria"
              >
                <RotateCcw className="h-4 w-4" />
                Resetar
              </button>
            </div>
            <button
              onClick={runtime.toggleVoice}
              className={cn(
                'mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-black transition',
                voiceEnabled
                  ? 'border-amber-400/30 bg-amber-500/10 text-amber-200'
                  : 'border-slate-800 bg-slate-950 text-slate-500 hover:text-slate-300',
              )}
            >
              {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              {voiceEnabled ? 'TTS real ligado' : 'TTS mutado'}
            </button>
          </section>

          <section className="mt-4 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Modo teste
              </h3>
              <span className="text-[11px] font-bold text-slate-500">
                {pendingEvents.length} pendentes
              </span>
            </div>
            <div className="mb-3 rounded-md border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-2 flex flex-wrap gap-1">
                {(Object.keys(SIM_SPEEDS) as SimSpeed[]).map((speed) => (
                  <button
                    key={speed}
                    onClick={() => setSimSpeed(speed)}
                    disabled={!testMode || simActive}
                    className={cn(
                      'rounded border px-2 py-1 text-[10px] font-black uppercase transition disabled:cursor-not-allowed disabled:opacity-40',
                      simSpeed === speed
                        ? 'border-sky-400/40 bg-sky-500/10 text-sky-200'
                        : 'border-slate-800 text-slate-500 hover:text-white',
                    )}
                  >
                    {SIM_SPEEDS[speed].label}
                  </button>
                ))}
              </div>
              <button
                onClick={simActive ? stopSimulation : startSimulation}
                disabled={!testMode}
                className={cn(
                  'inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-40',
                  simActive
                    ? 'border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                    : 'bg-sky-500 text-slate-950 hover:bg-sky-300',
                )}
              >
                {simActive ? (
                  <Square className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
                {simActive ? 'Parar simulacao' : 'Rodar cenario'}
              </button>
              <button
                onClick={runFullFlowTest}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-200 transition hover:bg-emerald-500/20"
              >
                <CheckCircle2 className="h-4 w-4" />
                Teste de fluxo completo
              </button>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                Use apenas para teste. Rodadas coletam {Math.round(roundCollectionMs / 1000)}s e
                respeitam {Math.round(speechCooldownMs / 1000)}s entre falas.
              </p>
            </div>
            <div className="space-y-2">
              {TEST_EVENTS.map((event) => {
                const Icon = event.icon;
                return (
                  <button
                    key={event.label}
                    onClick={() => injectEvent(event.kind, event.text)}
                    disabled={!testMode}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/50 p-3 text-left transition hover:border-sky-400/50 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 flex-shrink-0 text-sky-300" />
                      <span className="truncate text-sm font-black text-white">{event.label}</span>
                    </span>
                    <Send className="h-3.5 w-3.5 text-slate-500" />
                  </button>
                );
              })}
            </div>
            {simLog.length > 0 && (
              <div className="mt-3 max-h-44 space-y-1 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/60 p-2">
                {simLog
                  .slice(-18)
                  .reverse()
                  .map((item) => (
                    <div key={item.id} className="flex items-start gap-2 text-[11px] leading-4">
                      <span className="mt-0.5 flex-shrink-0">
                        {EVENT_TYPE_ICONS[item.event.type]}
                      </span>
                      <span
                        className={cn(
                          'min-w-[74px] flex-shrink-0 font-black',
                          EVENT_TYPE_COLORS[item.event.type],
                        )}
                      >
                        @{item.event.username}
                      </span>
                      <span className="min-w-0 flex-1 text-slate-400">
                        {item.event.displayText}
                      </span>
                      <span className="flex-shrink-0 text-slate-600">{item.time}</span>
                    </div>
                  ))}
              </div>
            )}
          </section>

          <section className="mt-4 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">
              Evento manual
            </h3>
            <textarea
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              className="h-24 w-full resize-none rounded-md border border-slate-800 bg-slate-950 p-3 text-sm leading-5 text-white outline-none focus:border-sky-400"
              placeholder="@viewer: pergunta, presente, alerta ou pedido de cena..."
            />
            <button
              onClick={injectManualEvent}
              disabled={!manualText.trim()}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
              Injetar no fluxo
            </button>
          </section>
        </aside>

        <section className="flex min-h-[760px] flex-col xl:min-h-0">
          <div className="border-b border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {stages.map((stage) => (
                <StepPill key={stage} stage={stage} active={latestCycle?.stage === stage} />
              ))}
              <button
                onClick={runtime.exportSession}
                className="ml-auto inline-flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:border-emerald-400/40 hover:text-white"
              >
                <Download className="h-3.5 w-3.5" />
                Exportar JSON
              </button>
              <span className="inline-flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs font-bold text-slate-300">
                {isProcessing ? (
                  <>
                    <Activity className="h-3.5 w-3.5 animate-pulse text-emerald-300" />
                    Processando rodada ({currentRoundEvents.length || 1})
                  </>
                ) : (
                  <>
                    <Square className="h-3.5 w-3.5 text-slate-500" />
                    Agrupando eventos
                  </>
                )}
              </span>
            </div>
          </div>

          <div className="grid gap-px bg-slate-800 sm:grid-cols-6">
            {[
              ['Ciclos OK', completedCycles, CheckCircle2],
              ['Erros', failedCycles, AlertTriangle],
              ['Confianca', `${averageConfidence}%`, Gauge],
              ['Rodada', currentRoundEvents.length || pendingEvents.length, Layers],
              ['Tools', activeTools, SlidersHorizontal],
              ['Regras', activeRules, Zap],
            ].map(([label, value, Icon]) => {
              const IconComp = Icon as React.ElementType;
              return (
                <div key={String(label)} className="bg-[#0B1018] p-4">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                    <IconComp className="h-4 w-4" />
                    {label as React.ReactNode}
                  </div>
                  <p className="mt-2 font-mono text-lg font-black text-white">{value as React.ReactNode}</p>
                </div>
              );
            })}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="min-h-0 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface)]">
              <div className="border-b border-slate-800 px-4 py-3">
                <h3 className="text-sm font-black text-white">Timeline auditavel</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Entrada, interpretacao, decisao, acoes e resultado.
                </p>
              </div>
              <div className="max-h-[640px] space-y-3 overflow-y-auto p-4">
                {cycles.length === 0 ? (
                  <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center text-slate-600">
                    <Bot className="h-12 w-12" />
                    <p className="text-sm">
                      Inicie o Autopilot e injete um evento para ver o ciclo completo.
                    </p>
                  </div>
                ) : (
                  cycles
                    .slice()
                    .reverse()
                    .map((cycle) => (
                      <article
                        key={cycle.id}
                        className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  'rounded-md border px-2 py-1 text-[11px] font-black uppercase',
                                  statusTone(cycle.stage),
                                )}
                              >
                                {cycle.stage}
                              </span>
                              <span className="rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-slate-400">
                                {cycle.event.kind}
                              </span>
                              <span className="text-xs text-slate-500">{cycle.event.time}</span>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-slate-200">
                              {cycle.event.text}
                            </p>
                            {(cycle.events?.length || 1) > 1 && (
                              <div className="mt-3 rounded-md border border-sky-400/20 bg-sky-500/10 p-2">
                                <p className="text-[11px] font-black uppercase tracking-wide text-sky-300">
                                  Rodada com {cycle.events.length} eventos agrupados
                                </p>
                                <div className="mt-2 space-y-1">
                                  {cycle.events.slice(0, 5).map((event) => (
                                    <p
                                      key={event.id}
                                      className="truncate text-[11px] text-slate-400"
                                    >
                                      [{event.kind}] {event.text}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            )}
                            {metadataPreview(cycle.event) && (
                              <p className="mt-2 rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-500">
                                {metadataPreview(cycle.event)}
                              </p>
                            )}
                            {cycle.matchedRules.length > 0 && (
                              <p className="mt-2 text-[11px] font-bold text-amber-300">
                                Regras: {cycle.matchedRules.join(', ')}
                              </p>
                            )}
                            {Boolean(cycle.contentUsed?.length) && (
                              <div className="mt-3 rounded-md border border-cyan-400/20 bg-cyan-500/10 p-2">
                                <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-cyan-300">
                                  <BookOpen className="h-3.5 w-3.5" />
                                  Conteudo usado
                                </p>
                                <div className="mt-2 space-y-1">
                                  {cycle.contentUsed?.slice(0, 4).map((item) => (
                                    <p
                                      key={item.id}
                                      className="text-[11px] leading-4 text-cyan-50/80"
                                    >
                                      <span className="font-bold text-cyan-200">{item.title}</span>
                                      <span className="text-cyan-200/50"> / {item.reason}</span>
                                    </p>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          {cycle.decision && (
                            <div className="rounded-md border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-right">
                              <p className="text-[11px] font-bold uppercase text-violet-300">
                                {cycle.decision.intent}
                              </p>
                              <p className="mt-1 font-mono text-lg font-black text-white">
                                {Math.round(cycle.decision.confidence * 100)}%
                              </p>
                            </div>
                          )}
                        </div>

                        {cycle.decision && (
                          <div className="mt-4 rounded-md border border-emerald-400/20 bg-emerald-500/10 p-3">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">
                              Fala planejada
                            </p>
                            <p className="mt-2 text-sm font-semibold leading-6 text-emerald-50">
                              {cycle.decision.speech}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-emerald-200/70">
                              {cycle.decision.reason}
                            </p>
                          </div>
                        )}

                        {cycle.actions.length > 0 && (
                          <div className="mt-4 grid gap-2 md:grid-cols-2">
                            {cycle.actions.map((action) => (
                              <div
                                key={action.id}
                                className="rounded-md border border-slate-800 bg-slate-950/60 p-3"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-black text-white">
                                    {action.label}
                                  </span>
                                  <span
                                    className={cn(
                                      'rounded px-2 py-0.5 text-[10px] font-black uppercase',
                                      actionTone(action.status),
                                    )}
                                  >
                                    {action.status}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  {action.capability}
                                </p>
                                <p className="mt-2 text-xs leading-5 text-slate-400">
                                  {action.result || actionSummary(action)}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-4 grid gap-2 md:grid-cols-2">
                          {cycle.logs.map((entry) => (
                            <div
                              key={entry.id}
                              className={cn(
                                'rounded-md border px-3 py-2 text-xs',
                                entry.status === 'error'
                                  ? 'border-rose-400/30 bg-rose-500/10 text-rose-200'
                                  : entry.status === 'running'
                                    ? 'border-amber-400/30 bg-amber-500/10 text-amber-200'
                                    : 'border-slate-800 bg-slate-950/60 text-slate-300',
                              )}
                            >
                              <span className="font-mono text-[10px] text-slate-500">
                                {entry.time}
                              </span>
                              <p className="mt-1">{entry.label}</p>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))
                )}
              </div>
            </section>

            <aside className="space-y-4">
              <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface)]">
                <div className="border-b border-slate-800 px-4 py-3">
                  <h3 className="text-sm font-black text-white">Fluxo conectado</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Entrada ate auditoria da rodada atual.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 p-4">
                  {flowSteps.map((step) => (
                    <div
                      key={step.label}
                      className={cn(
                        'rounded-md border p-3',
                        step.ok
                          ? 'border-emerald-400/20 bg-emerald-500/10'
                          : 'border-slate-800 bg-slate-950/60',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full',
                            step.ok ? 'bg-emerald-400' : 'bg-slate-600',
                          )}
                        />
                        <p className="text-[11px] font-black uppercase tracking-wide text-slate-300">
                          {step.label}
                        </p>
                      </div>
                      <p className="mt-2 truncate text-[11px] text-slate-500">{step.detail}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface)]">
                <div className="border-b border-slate-800 px-4 py-3">
                  <h3 className="text-sm font-black text-white">Proxima acao</h3>
                  <p className="mt-1 text-xs text-slate-500">Decisao mais recente da Persona.</p>
                </div>
                <div className="p-4">
                  {latestDecision ? (
                    <div className="space-y-3">
                      <div className="rounded-md border border-violet-400/20 bg-violet-500/10 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-violet-300">
                          {latestDecision.priority} / {latestDecision.intent}
                        </p>
                        <p className="mt-2 text-sm font-semibold leading-6 text-white">
                          {latestDecision.speech}
                        </p>
                      </div>
                      <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs leading-5 text-slate-400">
                        {latestDecision.reason}
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-slate-800 p-5 text-center text-sm text-slate-600">
                      Nenhuma decisao gerada ainda.
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface)]">
                <div className="border-b border-slate-800 px-4 py-3">
                  <h3 className="text-sm font-black text-white">Fila de acoes</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Real, simulado, bloqueado ou aguardando aprovacao.
                  </p>
                </div>
                <div className="max-h-[360px] space-y-2 overflow-y-auto p-4">
                  {actionQueue.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-600">Sem acoes na fila.</p>
                  ) : (
                    actionQueue
                      .slice()
                      .reverse()
                      .map((action) => (
                        <div
                          key={action.id}
                          className="rounded-md border border-slate-800 bg-slate-950/60 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black text-white">{action.label}</span>
                            <span
                              className={cn(
                                'rounded px-2 py-0.5 text-[10px] font-black uppercase',
                                actionTone(action.status),
                              )}
                            >
                              {action.status}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">{action.capability}</p>
                          <p className="mt-2 text-xs leading-5 text-slate-500">
                            {action.result || actionSummary(action)}
                          </p>
                        </div>
                      ))
                  )}
                </div>
              </section>
            </aside>
          </div>
        </section>

        <aside className="border-t border-[var(--odessa-border)] bg-[var(--odessa-surface)] p-4 xl:border-l xl:border-t-0">
          <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-white">Saude do sistema</h3>
                <p className="mt-1 text-xs text-slate-500">Verificado as {healthCheckedAt}</p>
              </div>
              <button
                onClick={runtime.refreshHealth}
                className="rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
              >
                <RefreshCcw className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-500">Backend</p>
                <p className="mt-1 text-sm font-black text-white">{health?.status || 'offline'}</p>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-500">OCR</p>
                <p className="mt-1 text-sm font-black text-white">{health?.ocr || '-'}</p>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-500">IA</p>
                <p className="mt-1 text-sm font-black text-white">
                  {health?.gemini_configured
                    ? 'Gemini'
                    : health?.openai_ai_configured
                      ? 'OpenAI'
                      : '-'}
                </p>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-500">
                  Usuarios reconhecidos
                </p>
                <p className="mt-1 text-sm font-black text-white">{recognizedUsersCount}</p>
                <p className="mt-1 text-[10px] text-slate-600">local: {memoryCount}</p>
              </div>
              <div className="col-span-2 rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">
                      OBS real via n8n
                    </p>
                    <p className="mt-1 text-sm font-black text-white">
                      {runtime.currentObsScene || `${runtime.obsScenes.length} cena(s) carregadas`}
                    </p>
                  </div>
                  <button
                    onClick={runtime.refreshObsScenes}
                    className="rounded-md border border-slate-800 px-2 py-1 text-[10px] font-bold text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-200"
                  >
                    Atualizar
                  </button>
                </div>
                {runtime.obsError && (
                  <p className="mt-2 truncate text-[11px] text-amber-300">{runtime.obsError}</p>
                )}
              </div>
              <div className="col-span-2 rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">n8n bridge</p>
                    <p className={cn('mt-1 text-sm font-black', n8nTone)}>{n8nStatus}</p>
                  </div>
                  <div className="text-right text-[10px] font-bold uppercase leading-4 text-slate-600">
                    <p>{health?.n8n?.action_webhook_configured ? 'actions on' : 'actions off'}</p>
                    <p>{health?.n8n?.audit_webhook_configured ? 'audit on' : 'audit off'}</p>
                  </div>
                </div>
                {health?.n8n?.error && (
                  <p className="mt-2 truncate text-[11px] text-amber-300">{health.n8n.error}</p>
                )}
              </div>
            </div>
            {healthError && (
              <p className="mt-3 rounded-md border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                {healthError}
              </p>
            )}
            {lastError && (
              <p className="mt-3 rounded-md border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                Runtime: {lastError}
              </p>
            )}
          </section>

          <section className="mt-4 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]">
            <div className="border-b border-slate-800 px-4 py-3">
              <h3 className="text-sm font-black text-white">Ferramentas</h3>
              <p className="mt-1 text-xs text-slate-500">Registry de capacidades acionaveis.</p>
            </div>
            <div className="max-h-[300px] space-y-2 overflow-y-auto p-4">
              {tools.map((tool) => (
                <div
                  key={tool.id}
                  className="rounded-md border border-slate-800 bg-slate-950/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black text-white">{tool.label}</p>
                      <p className="mt-1 truncate text-[11px] text-slate-500">{tool.capability}</p>
                    </div>
                    <button
                      onClick={() =>
                        runtime.toggleTool(tool.capability, { enabled: !tool.enabled })
                      }
                      className={cn(
                        'rounded px-2 py-1 text-[10px] font-black uppercase',
                        tool.enabled
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-slate-800 text-slate-500',
                      )}
                    >
                      {tool.enabled ? 'on' : 'off'}
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() =>
                        runtime.toggleTool(tool.capability, { simulated: !tool.simulated })
                      }
                      disabled={tool.capability === 'tts.speak'}
                      className="rounded border border-slate-800 px-2 py-1 text-[10px] font-bold text-slate-400 disabled:opacity-40"
                    >
                      {tool.simulated ? 'simulado' : 'real'}
                    </button>
                    <button
                      onClick={() =>
                        runtime.toggleTool(tool.capability, {
                          requiresApproval: !tool.requiresApproval,
                        })
                      }
                      className="rounded border border-slate-800 px-2 py-1 text-[10px] font-bold text-slate-400"
                    >
                      {tool.requiresApproval ? 'aprovacao' : 'auto'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]">
            <div className="border-b border-slate-800 px-4 py-3">
              <h3 className="text-sm font-black text-white">Regras ativas</h3>
              <p className="mt-1 text-xs text-slate-500">
                Automacoes previsiveis antes da IA complementar.
              </p>
            </div>
            <div className="max-h-[260px] space-y-2 overflow-y-auto p-4">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/60 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black text-white">{rule.label}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {rule.actions.length} acao(oes)
                    </p>
                  </div>
                  <button
                    onClick={() => runtime.toggleRule(rule.id, !rule.enabled)}
                    className={cn(
                      'rounded px-2 py-1 text-[10px] font-black uppercase',
                      rule.enabled
                        ? 'bg-amber-500/10 text-amber-300'
                        : 'bg-slate-800 text-slate-500',
                    )}
                  >
                    {rule.enabled ? 'ativa' : 'off'}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]">
            <div className="border-b border-slate-800 px-4 py-3">
              <h3 className="text-sm font-black text-white">Entradas recentes</h3>
              <p className="mt-1 text-xs text-slate-500">
                {capturedText.length} eventos no barramento
              </p>
            </div>
            <div className="max-h-[300px] space-y-2 overflow-y-auto p-4">
              {recentEvents.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-600">Sem eventos ainda.</p>
              ) : (
                recentEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-md border border-slate-800 bg-slate-950/60 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-black uppercase text-sky-300">
                          {event.kind}
                        </span>
                        <span className="text-[10px] text-slate-500">{event.time}</span>
                      </div>
                      <p className="text-xs leading-5 text-slate-300">{event.text}</p>
                      {metadataPreview(event) && (
                        <p className="mt-2 text-[11px] text-slate-500">{metadataPreview(event)}</p>
                      )}
                    </div>
                  ))
              )}
            </div>
          </section>

          <section className="mt-4 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-4">
            <div className="flex items-center gap-2 text-xs leading-5 text-slate-500">
              <Zap className="h-4 w-4 flex-shrink-0 text-amber-300" />
              OBS, chat, overlay, media e moderacao podem ser enviados ao n8n; sem webhook, seguem
              simulados localmente.
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
