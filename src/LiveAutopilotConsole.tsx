import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Gauge,
  Gift,
  Layers,
  MessageSquare,
  Mic2,
  Pause,
  Play,
  RadioTower,
  RefreshCcw,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  SplitSquareHorizontal,
  Square,
  Volume2,
  VolumeX,
  Wand2,
  Zap,
} from 'lucide-react';
import { apiUrl } from './lib/api';
import {
  loadMemory, addTurn, buildMemoryContext, type ConversationTurn,
  loadUserProfiles, trackUserInteraction, buildUserContext, type UserProfileMap,
} from './lib/memory';
import { cn } from './lib/utils';
import type {
  AutopilotAction,
  AutopilotActionType,
  CapturedMessage,
  LiveEvent,
  LiveEventKind,
  PersonaDecision,
} from './types';

interface LiveAutopilotConsoleProps {
  capturedText: CapturedMessage[];
  setCapturedText: Dispatch<SetStateAction<CapturedMessage[]>>;
}

interface BackendHealth {
  status: string;
  ocr: string;
  gemini_configured: boolean;
  openai_tts_configured: boolean;
}

type CycleStage = 'capturado' | 'interpretado' | 'decidido' | 'executando' | 'concluido' | 'erro';

interface CycleLog {
  id: string;
  time: string;
  label: string;
  status: 'done' | 'running' | 'error';
}

interface AutopilotCycle {
  id: string;
  event: LiveEvent;
  stage: CycleStage;
  decision?: PersonaDecision;
  actions: AutopilotAction[];
  logs: CycleLog[];
  createdAt: string;
  completedAt?: string;
  error?: string;
}

const PERSONA_AUTOPILOT_PROMPT = `Voce e a Juju, uma streamer gamer com autonomia operacional na live.
Sua funcao e decidir a proxima fala e as proximas acoes da transmissao com base nos eventos recebidos.
Seja breve, natural, segura e carismatica.
Quando for presente, agradeca. Quando for moderacao, priorize seguranca. Quando for cena/OBS, explique o comando planejado.
Nunca afirme que uma acao externa real foi executada se ela estiver em modo simulado.`;

const TEST_EVENTS: Array<{
  kind: LiveEventKind;
  label: string;
  text: string;
  icon: typeof MessageSquare;
}> = [
  {
    kind: 'chat',
    label: 'Chat',
    text: '@Lucas: Juju, manda um salve e pergunta como esta a live!',
    icon: MessageSquare,
  },
  {
    kind: 'gift',
    label: 'Presente',
    text: 'Ana enviou Rosa x5 e entrou no top apoiadores.',
    icon: Gift,
  },
  {
    kind: 'moderation',
    label: 'Moderacao',
    text: 'Mensagem suspeita no chat pedindo link externo e spam repetido.',
    icon: ShieldAlert,
  },
  {
    kind: 'scene',
    label: 'Cena OBS',
    text: 'Trocar para cena Gameplay Focus porque a partida comecou.',
    icon: SplitSquareHorizontal,
  },
  {
    kind: 'alert',
    label: 'Alerta',
    text: 'Novo seguidor: Mari entrou na live agora.',
    icon: RadioTower,
  },
];

const ACTION_LABELS: Record<AutopilotActionType, string> = {
  speak: 'Falar via TTS',
  chat_reply: 'Resposta no chat',
  ack_gift: 'Agradecer presente',
  moderate_message: 'Moderar mensagem',
  switch_scene: 'Trocar cena',
  show_overlay: 'Exibir overlay',
  log_event: 'Registrar evento',
};

function formatClock(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function statusTone(stage: CycleStage) {
  if (stage === 'concluido') return 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30';
  if (stage === 'erro') return 'text-rose-200 bg-rose-500/10 border-rose-400/30';
  if (stage === 'executando') return 'text-amber-200 bg-amber-500/10 border-amber-400/30';
  return 'text-sky-200 bg-sky-500/10 border-sky-400/30';
}

function createLiveEvent(kind: LiveEventKind, text: string, source: LiveEvent['source']): LiveEvent {
  const time = formatClock();
  return {
    id: makeId('event'),
    source,
    zoneName: source === 'test' ? 'Injetor de teste' : 'Controle Live',
    text,
    kind,
    createdAt: new Date().toISOString(),
    time,
  };
}

function normalizeAction(action: Partial<AutopilotAction>, index: number): AutopilotAction {
  const type = action.type || 'log_event';
  return {
    id: action.id || makeId(`action-${index}`),
    type,
    label: action.label || ACTION_LABELS[type],
    payload: action.payload || {},
    simulated: action.simulated ?? type !== 'speak',
    status: 'queued',
  };
}

function normalizeDecision(raw: Partial<PersonaDecision>): PersonaDecision {
  const actions = Array.isArray(raw.actions) ? raw.actions : [];
  return {
    speech: raw.speech || 'Vou acompanhar isso com cuidado na live.',
    intent: raw.intent || 'respond_live_event',
    confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0.7))),
    reason: raw.reason || 'Decisao gerada a partir do evento atual.',
    priority: raw.priority || 'normal',
    actions: actions.map(normalizeAction),
  };
}

function actionSummary(action: AutopilotAction) {
  const detail =
    typeof action.payload.text === 'string'
      ? action.payload.text
      : typeof action.payload.scene === 'string'
        ? action.payload.scene
        : typeof action.payload.message === 'string'
          ? action.payload.message
          : '';
  return detail ? `${action.label}: ${detail}` : action.label;
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

export default function LiveAutopilotConsole({
  capturedText,
  setCapturedText,
}: LiveAutopilotConsoleProps) {
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [pendingEvents, setPendingEvents] = useState<LiveEvent[]>([]);
  const [cycles, setCycles] = useState<AutopilotCycle[]>([]);
  const [actionQueue, setActionQueue] = useState<AutopilotAction[]>([]);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthCheckedAt, setHealthCheckedAt] = useState('Nunca');
  const [isProcessing, setIsProcessing] = useState(false);
  const [manualText, setManualText] = useState('');
  const processedIdsRef = useRef<Set<string>>(new Set());
  const audioUrlsRef = useRef<string[]>([]);
  const memoryRef = useRef<ConversationTurn[]>(loadMemory());
  const [memoryCount, setMemoryCount] = useState(() => loadMemory().length);

  const latestCycle = cycles[cycles.length - 1];
  const latestDecision = latestCycle?.decision;
  const completedCycles = cycles.filter((cycle) => cycle.stage === 'concluido').length;
  const failedCycles = cycles.filter((cycle) => cycle.stage === 'erro').length;
  const averageConfidence = useMemo(() => {
    const decisions = cycles.map((cycle) => cycle.decision).filter(Boolean) as PersonaDecision[];
    if (!decisions.length) return 0;
    return Math.round(
      (decisions.reduce((sum, decision) => sum + decision.confidence, 0) / decisions.length) * 100,
    );
  }, [cycles]);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/health'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as BackendHealth;
      setHealth(data);
      setHealthError(null);
      setHealthCheckedAt(formatClock());
    } catch (err) {
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : 'Backend indisponivel');
      setHealthCheckedAt(formatClock());
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    const interval = window.setInterval(refreshHealth, 15000);
    return () => window.clearInterval(interval);
  }, [refreshHealth]);

  useEffect(() => {
    return () => {
      audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const enqueueEvent = useCallback((event: LiveEvent) => {
    if (processedIdsRef.current.has(event.id)) return;
    processedIdsRef.current.add(event.id);
    setPendingEvents((current) => [...current, event].slice(-40));
  }, []);

  useEffect(() => {
    if (!autopilotEnabled) return;
    capturedText.forEach(enqueueEvent);
  }, [autopilotEnabled, capturedText, enqueueEvent]);

  const updateCycle = useCallback((cycleId: string, patch: Partial<AutopilotCycle>) => {
    setCycles((current) =>
      current.map((cycle) => (cycle.id === cycleId ? { ...cycle, ...patch } : cycle)),
    );
  }, []);

  const appendCycleLog = useCallback((cycleId: string, label: string, status: CycleLog['status']) => {
    setCycles((current) =>
      current.map((cycle) =>
        cycle.id === cycleId
          ? {
              ...cycle,
              logs: [
                ...cycle.logs,
                {
                  id: makeId('log'),
                  time: formatClock(),
                  label,
                  status,
                },
              ],
            }
          : cycle,
      ),
    );
  }, []);

  const requestDecision = useCallback(async (event: LiveEvent) => {
    const currentMemory = loadMemory();
    const memoryBlock = buildMemoryContext(currentMemory);
    const currentProfiles = loadUserProfiles();
    const usersBlock = buildUserContext(currentProfiles);

    const contextParts: string[] = [PERSONA_AUTOPILOT_PROMPT];
    if (usersBlock) contextParts.push(`\n\n[PERFIS DE USUARIOS CONHECIDOS - use para personalizar respostas, lembrar presentes e historico]:\n${usersBlock}`);
    if (memoryBlock) contextParts.push(`\n\n[HISTORICO RECENTE DE FALAS - mantenha coerencia e nao repita]:\n${memoryBlock}`);
    const promptWithContext = contextParts.join('');

    const response = await fetch(apiUrl('/ai/decide'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        persona_prompt: promptWithContext,
        events: [event],
        mode: 'autopilot_audited',
        temperature: 0.72,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || 'Falha ao decidir proxima acao');
    }
    return normalizeDecision(data);
  }, []);

  const executeSpeak = useCallback(
    async (text: string) => {
      if (!voiceEnabled) return 'Voz desativada: fala registrada sem audio.';

      const response = await fetch(apiUrl('/tts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'pt-BR-FranciscaNeural' }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || 'Falha no TTS');
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      audioUrlsRef.current.push(audioUrl);
      const audio = new Audio(audioUrl);
      audio.onended = () => URL.revokeObjectURL(audioUrl);
      await audio.play();
      return 'Audio enviado ao player local.';
    },
    [voiceEnabled],
  );

  const executeAction = useCallback(
    async (action: AutopilotAction, decision: PersonaDecision) => {
      if (action.type === 'speak') {
        const text =
          typeof action.payload.text === 'string' && action.payload.text.trim()
            ? action.payload.text
            : decision.speech;
        return executeSpeak(text);
      }

      await new Promise((resolve) => window.setTimeout(resolve, 350));
      return `Simulado: ${actionSummary(action)}`;
    },
    [executeSpeak],
  );

  const processEvent = useCallback(
    async (event: LiveEvent) => {
      const cycleId = makeId('cycle');
      const cycle: AutopilotCycle = {
        id: cycleId,
        event,
        stage: 'capturado',
        actions: [],
        logs: [
          {
            id: makeId('log'),
            time: formatClock(),
            label: `Evento recebido de ${event.source}: ${event.kind}`,
            status: 'done',
          },
        ],
        createdAt: new Date().toISOString(),
      };

      setCycles((current) => [...current, cycle].slice(-30));
      setIsProcessing(true);

      try {
        updateCycle(cycleId, { stage: 'interpretado' });
        appendCycleLog(cycleId, 'Evento interpretado e normalizado para a Persona', 'done');

        const decision = await requestDecision(event);
        updateCycle(cycleId, {
          stage: 'decidido',
          decision,
          actions: decision.actions,
        });
        appendCycleLog(
          cycleId,
          `Decisao: ${decision.intent} (${Math.round(decision.confidence * 100)}%)`,
          'done',
        );

        updateCycle(cycleId, { stage: 'executando' });
        appendCycleLog(cycleId, 'Executando fila auditavel de acoes', 'running');

        const executedActions: AutopilotAction[] = [];
        for (const action of decision.actions) {
          const runningAction = { ...action, status: 'running' as const };
          setActionQueue((current) => [...current, runningAction].slice(-80));
          try {
            const result = await executeAction(runningAction, decision);
            executedActions.push({ ...runningAction, status: 'done', result });
            setActionQueue((current) =>
              current.map((item) =>
                item.id === runningAction.id ? { ...runningAction, status: 'done', result } : item,
              ),
            );
            appendCycleLog(cycleId, result, 'done');
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Falha ao executar acao';
            executedActions.push({ ...runningAction, status: 'error', result: message });
            setActionQueue((current) =>
              current.map((item) =>
                item.id === runningAction.id
                  ? { ...runningAction, status: 'error', result: message }
                  : item,
              ),
            );
            appendCycleLog(cycleId, message, 'error');
          }
        }

        updateCycle(cycleId, {
          stage: 'concluido',
          actions: executedActions,
          completedAt: new Date().toISOString(),
        });
        appendCycleLog(cycleId, 'Ciclo concluido e registrado', 'done');
        memoryRef.current = addTurn(memoryRef.current, event.text, decision.speech, 'autopilot');
        setMemoryCount(memoryRef.current.length);
        // Track user interaction
        const currentProfiles = loadUserProfiles();
        trackUserInteraction(currentProfiles, event.text);
        await refreshHealth();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro desconhecido';
        updateCycle(cycleId, {
          stage: 'erro',
          error: message,
          completedAt: new Date().toISOString(),
        });
        appendCycleLog(cycleId, message, 'error');
        setAutopilotEnabled(false);
      } finally {
        setIsProcessing(false);
      }
    },
    [appendCycleLog, executeAction, refreshHealth, requestDecision, updateCycle],
  );

  useEffect(() => {
    if (!autopilotEnabled || isProcessing || pendingEvents.length === 0) return;

    const [nextEvent, ...remaining] = pendingEvents;
    setPendingEvents(remaining);
    processEvent(nextEvent);
  }, [autopilotEnabled, isProcessing, pendingEvents, processEvent]);

  const injectEvent = (kind: LiveEventKind, text: string) => {
    const event = createLiveEvent(kind, text, testMode ? 'test' : 'manual');
    setCapturedText((current) => [...current, event].slice(-100));
    enqueueEvent(event);
  };

  const injectManualEvent = () => {
    if (!manualText.trim()) return;
    injectEvent('chat', manualText.trim());
    setManualText('');
  };

  const clearSession = () => {
    setPendingEvents([]);
    setCycles([]);
    setActionQueue([]);
    processedIdsRef.current.clear();
  };

  const stages: CycleStage[] = ['capturado', 'interpretado', 'decidido', 'executando', 'concluido'];

  return (
    <main className="flex-1 overflow-y-auto bg-[#070A0F] text-slate-100">
      <div className="grid min-h-full grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <aside className="border-b border-slate-800 bg-[#111722] p-4 xl:border-b-0 xl:border-r">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                Live Control Loop
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

          <section className="rounded-lg border border-slate-800 bg-[#0B1018] p-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setAutopilotEnabled(true)}
                disabled={autopilotEnabled}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-4 w-4 fill-current" />
                Iniciar
              </button>
              <button
                onClick={() => setAutopilotEnabled(false)}
                disabled={!autopilotEnabled}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-xs font-black text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Pause className="h-4 w-4" />
                Pausar
              </button>
              <button
                onClick={() => setTestMode((value) => !value)}
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
                onClick={clearSession}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-black text-slate-300 transition hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" />
                Limpar
              </button>
            </div>
            <button
              onClick={() => setVoiceEnabled((value) => !value)}
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

          <section className="mt-4 rounded-lg border border-slate-800 bg-[#0B1018] p-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Eventos de teste
              </h3>
              <span className="text-[11px] font-bold text-slate-500">{pendingEvents.length} pendentes</span>
            </div>
            <div className="space-y-2">
              {TEST_EVENTS.map((event) => {
                const Icon = event.icon;
                return (
                  <button
                    key={event.kind}
                    onClick={() => injectEvent(event.kind, event.text)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/50 p-3 text-left transition hover:border-sky-400/50 hover:bg-sky-500/10"
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
          </section>

          <section className="mt-4 rounded-lg border border-slate-800 bg-[#0B1018] p-3">
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
          <div className="border-b border-slate-800 bg-[#0B1018] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {stages.map((stage) => (
                <StepPill key={stage} stage={stage} active={latestCycle?.stage === stage} />
              ))}
              <span className="ml-auto inline-flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-xs font-bold text-slate-300">
                {isProcessing ? (
                  <>
                    <Activity className="h-3.5 w-3.5 animate-pulse text-emerald-300" />
                    Processando ciclo
                  </>
                ) : (
                  <>
                    <Square className="h-3.5 w-3.5 text-slate-500" />
                    Aguardando evento
                  </>
                )}
              </span>
            </div>
          </div>

          <div className="grid gap-px bg-slate-800 sm:grid-cols-5">
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <CheckCircle2 className="h-4 w-4" />
                Ciclos OK
              </div>
              <p className="mt-2 font-mono text-lg font-black text-white">{completedCycles}</p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <AlertTriangle className="h-4 w-4" />
                Erros
              </div>
              <p className="mt-2 font-mono text-lg font-black text-white">{failedCycles}</p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Gauge className="h-4 w-4" />
                Confianca
              </div>
              <p className="mt-2 font-mono text-lg font-black text-white">{averageConfidence}%</p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Layers className="h-4 w-4" />
                Acoes
              </div>
              <p className="mt-2 font-mono text-lg font-black text-white">{actionQueue.length}</p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Bot className="h-4 w-4" />
                Memoria
              </div>
              <p className="mt-2 font-mono text-lg font-black text-purple-300">{memoryCount}</p>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="min-h-0 rounded-lg border border-slate-800 bg-[#111722]">
              <div className="border-b border-slate-800 px-4 py-3">
                <h3 className="text-sm font-black text-white">Timeline auditavel</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Cada ciclo mostra entrada, decisao, acoes e resultado.
                </p>
              </div>
              <div className="max-h-[620px] space-y-3 overflow-y-auto p-4">
                {cycles.length === 0 ? (
                  <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center text-slate-600">
                    <Bot className="h-12 w-12" />
                    <p className="text-sm">Inicie o Autopilot e injete um evento para ver o ciclo completo.</p>
                  </div>
                ) : (
                  cycles
                    .slice()
                    .reverse()
                    .map((cycle) => (
                      <article key={cycle.id} className="rounded-lg border border-slate-800 bg-[#0B1018] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn('rounded-md border px-2 py-1 text-[11px] font-black uppercase', statusTone(cycle.stage))}>
                                {cycle.stage}
                              </span>
                              <span className="rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-slate-400">
                                {cycle.event.kind}
                              </span>
                              <span className="text-xs text-slate-500">{cycle.event.time}</span>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-slate-200">{cycle.event.text}</p>
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
                            <p className="mt-2 text-xs leading-5 text-emerald-200/70">{cycle.decision.reason}</p>
                          </div>
                        )}

                        <div className="mt-4 grid gap-2 md:grid-cols-2">
                          {cycle.logs.map((log) => (
                            <div
                              key={log.id}
                              className={cn(
                                'rounded-md border px-3 py-2 text-xs',
                                log.status === 'error'
                                  ? 'border-rose-400/30 bg-rose-500/10 text-rose-200'
                                  : log.status === 'running'
                                    ? 'border-amber-400/30 bg-amber-500/10 text-amber-200'
                                    : 'border-slate-800 bg-slate-950/60 text-slate-300',
                              )}
                            >
                              <span className="font-mono text-[10px] text-slate-500">{log.time}</span>
                              <p className="mt-1">{log.label}</p>
                            </div>
                          ))}
                        </div>

                        {cycle.error && (
                          <p className="mt-3 rounded-md border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                            {cycle.error}
                          </p>
                        )}
                      </article>
                    ))
                )}
              </div>
            </section>

            <aside className="space-y-4">
              <section className="rounded-lg border border-slate-800 bg-[#111722]">
                <div className="border-b border-slate-800 px-4 py-3">
                  <h3 className="text-sm font-black text-white">Proxima acao da Persona</h3>
                  <p className="mt-1 text-xs text-slate-500">Decisao mais recente pronta para auditoria.</p>
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
                      <div className="space-y-2">
                        {latestDecision.actions.map((action) => (
                          <div key={action.id} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-black text-white">{action.label}</span>
                              <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-400">
                                {action.simulated ? 'simulado' : 'real'}
                              </span>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">{actionSummary(action)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-slate-800 p-5 text-center text-sm text-slate-600">
                      Nenhuma decisao gerada ainda.
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-slate-800 bg-[#111722]">
                <div className="border-b border-slate-800 px-4 py-3">
                  <h3 className="text-sm font-black text-white">Fila de acoes</h3>
                  <p className="mt-1 text-xs text-slate-500">Execucao real somente para TTS.</p>
                </div>
                <div className="max-h-[360px] space-y-2 overflow-y-auto p-4">
                  {actionQueue.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-600">Sem acoes na fila.</p>
                  ) : (
                    actionQueue
                      .slice()
                      .reverse()
                      .map((action) => (
                        <div key={action.id} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black text-white">{action.label}</span>
                            <span
                              className={cn(
                                'rounded px-2 py-0.5 text-[10px] font-black uppercase',
                                action.status === 'done'
                                  ? 'bg-emerald-500/10 text-emerald-300'
                                  : action.status === 'error'
                                    ? 'bg-rose-500/10 text-rose-300'
                                    : action.status === 'running'
                                      ? 'bg-amber-500/10 text-amber-300'
                                      : 'bg-slate-800 text-slate-400',
                              )}
                            >
                              {action.status}
                            </span>
                          </div>
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

        <aside className="border-t border-slate-800 bg-[#111722] p-4 xl:border-l xl:border-t-0">
          <section className="rounded-lg border border-slate-800 bg-[#0B1018] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-white">Saude do sistema</h3>
                <p className="mt-1 text-xs text-slate-500">Verificado as {healthCheckedAt}</p>
              </div>
              <button
                onClick={refreshHealth}
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
                <p className="text-[10px] font-bold uppercase text-slate-500">Gemini</p>
                <p className="mt-1 text-sm font-black text-white">
                  {health?.gemini_configured ? 'ok' : '-'}
                </p>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[10px] font-bold uppercase text-slate-500">TTS</p>
                <p className="mt-1 text-sm font-black text-white">Edge</p>
              </div>
            </div>
            {healthError && (
              <p className="mt-3 rounded-md border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                {healthError}
              </p>
            )}
          </section>

          <section className="mt-4 rounded-lg border border-slate-800 bg-[#0B1018]">
            <div className="border-b border-slate-800 px-4 py-3">
              <h3 className="text-sm font-black text-white">Entradas recentes</h3>
              <p className="mt-1 text-xs text-slate-500">{capturedText.length} eventos disponiveis</p>
            </div>
            <div className="max-h-[360px] space-y-2 overflow-y-auto p-4">
              {capturedText.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-600">Sem capturas ainda.</p>
              ) : (
                capturedText
                  .slice(-12)
                  .reverse()
                  .map((event) => (
                    <div key={event.id} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-black uppercase text-sky-300">{event.kind}</span>
                        <span className="text-[10px] text-slate-500">{event.time}</span>
                      </div>
                      <p className="text-xs leading-5 text-slate-300">{event.text}</p>
                    </div>
                  ))
              )}
            </div>
          </section>

          <section className="mt-4 rounded-lg border border-slate-800 bg-[#0B1018] p-4">
            <div className="flex items-center gap-2 text-xs leading-5 text-slate-500">
              <Zap className="h-4 w-4 flex-shrink-0 text-amber-300" />
              Acoes externas ficam simuladas ate existirem adaptadores reais para OBS, chat,
              overlays e moderacao.
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
