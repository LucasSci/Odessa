import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  Brain,
  ClipboardCheck,
  FastForward,
  Film,
  History,
  Link2,
  ListVideo,
  MessageCircle,
  Maximize2,
  Pause,
  Play,
  RadioTower,
  RefreshCw,
  Rewind,
  Settings,
  Scissors,
  Stethoscope,
  Trash2,
  Upload,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { emitEvent } from './core/eventBus';
import { registerFrameCapture, unregisterFrameCapture, captureVideoFrame } from './core/frameCapture';
import { apiUrl } from './lib/api';
import { getPersonaTransmission, listPersonas } from './core/personaManager';
import { VIDEO_ROTEIRO, categorizeVideo } from './core/videoRoteiro';
import {
  routeSetupLiveScene,
  routeStartTransmission,
  routeSwitchScene,
  type CommandResult,
} from './lib/obsCommandRouter';
import { cn } from './lib/utils';
import type { AutopilotRuntimeState } from './core/useAutopilotRuntime';
import type { CapturedMessage } from './types';
import { Badge, Button, Card, ConfirmButton, Tabs } from './components/ui';
import { useToast } from './components/Toast';
import { clampFadeMs, clipProgress, effectiveSegments, segmentSpeed } from './core/playback/clipTimeline';
import { publishProgress } from './core/playback/progressStore';
import { ClipDeck, deckOrder, groupDeckVideos } from './components/stage/ClipDeck';
import { ClipProgress } from './components/stage/ClipProgress';
import { EventRadio } from './components/stage/EventRadio';
import { SignalStrip, type Signal } from './components/stage/SignalStrip';
import { AiConfigPanel } from './components/AiConfigPanel';
import { SettingsPanel } from './components/SettingsPanel';
import TopPersonaSelector from './components/TopPersonaSelector';
import { PersonasPanel } from './components/PersonasPanel';
import { AdminPanel } from './components/AdminPanel';
import { PersonaChatLab } from './components/PersonaChatLab';
import { TangoChatPanel } from './components/TangoChatPanel';
import { SessionHistoryPanel } from './components/SessionHistoryPanel';
import VideoEditor from './components/VideoEditor';

import { applyVideoEdit, getVideoEdit, hasVideoEdit, saveVideoEdit, defaultVideoEdit, type VideoSegment } from './core/videoEdits';
import { getAiConfig, hasActiveGeminiKey, type AiAutonomyLevel } from './core/aiConfig';

const ReactiveFlowBoard = lazy(() => import('./ReactiveFlowBoard'));
const PlanningCanvas = lazy(() => import('./PlanningCanvas'));
const ReactiveFlowLogLab = lazy(() => import('./components/ReactiveFlowLogLab'));
// VideoEditor é importado de forma normal (não-lazy): no Palco o stream de vídeo
// ao vivo segura conexões HTTP/1.1 e o chunk lazy ficava "pending" para sempre.

// ─── Gift detection ───────────────────────────────────────────────────────────
// isGiftEvent is imported from ocrPipeline — single source of truth.

export type AdvancedPanel =
  | 'overview'
  | 'persona'
  | 'content'
  | 'runtime'
  | 'settings'
  | 'overlay'
  | 'canvas'
  | 'admin';

export type LiveConfig = {
  voiceEnabled?: boolean;
  enableChat?: boolean;
  prepareObs?: boolean;
  showStage?: boolean;
  startAutomation?: boolean;
  startCapture?: boolean;
  startTransmission?: boolean;
  actionMode?: 'simulated' | 'approval_required' | 'real';
};

interface OdessaLiveCenterProps {
  capturedText: CapturedMessage[];
  setCapturedText: Dispatch<SetStateAction<CapturedMessage[]>>;
  runtime: AutopilotRuntimeState;
  requestedPanel: AdvancedPanel;
  liveConfig?: LiveConfig;
  liveConfigOpen?: boolean;
  liveStartError?: string | null;
  onLiveConfigOpenChange?: Dispatch<SetStateAction<boolean>>;
  onLiveConfigChange?: Dispatch<SetStateAction<LiveConfig>>;
  onActiveTabChange?: (tab: TabKey) => void;
  onStartLive?: () => void | Promise<void>;
  onEndLive?: () => void;
  obsSettingsFromApp?: Record<string, unknown> | null;
  onObsSettingsChanged?: (settings: Record<string, unknown>) => void;
}

type TabKey =
  | 'live'
  | 'conversation'
  | 'library'
  | 'flow'
  | 'history'
  | 'personas'
  | 'admin'
  | 'settings'
  | 'home'
  | 'stage'
  | 'ai'
  | 'chat'
  | 'canvas'
  | 'logs';

type VideoEntry = {
  id: string;
  label?: string;
  group?: string;
  description?: string;
  loop?: boolean;
  tags?: string[];
  src?: string;
  url?: string;
  title?: string;
  /** Só presente quando o vídeo vem de GET /video/library (modo "todas as personas"). */
  personaId?: string;
  personaName?: string;
};

type PlaybackSettings = {
  startSec: number;
  endSec: number | null;
  transitionMs: number;
};

type ConnectionSettings = {
  transitionMs?: number;
  fadeMode?: 'cut' | 'fade' | 'crossfade';
  previewTailSec?: number;
  previewHeadSec?: number;
};

type ClipAudioSettings = {
  mode?: 'muted' | 'original' | 'track';
  volume?: number;
  trackId?: string;
  trackUrl?: string;
  trackLoop?: boolean;
};

type FlowNode = {
  nodeId: string;
  videoId: string;
  label?: string;
  position?: { x: number; y: number };
  playback: PlaybackSettings;
  audio?: ClipAudioSettings;
};

type VideoClip = {
  nodeId?: string | null;
  videoId: string;
  label?: string;
  startSec: number;
  endSec: number | null;
  transitionMs: number;
  returnToIdle?: boolean;
  loop?: boolean;
  playback?: PlaybackSettings;
  audio?: ClipAudioSettings;
  /** Cortes (Fase 4): trechos a tocar em ordem. Ausente/vazio = trim simples start/end. */
  segments?: VideoSegment[];
};

type TriggerEntry = {
  id: string;
  name: string;
  enabled: boolean;
  eventType: string;
  conditions?: { giftKey?: string; keyword?: string };
  actions?: Array<{
    type: string;
    capability?: string;
    videoId?: string;
    payload?: { videoId?: string; sceneName?: string; webhookId?: string };
  }>;
};

type PersonaConfig = {
  videos: VideoEntry[];
  triggers: TriggerEntry[];
  idleVideoId?: string;
  action_map?: Record<string, string[]>;
  flowNodes?: FlowNode[];
  flowConnections?: Array<{
    id: string;
    fromNodeId?: string;
    toNodeId?: string;
    fromVideoId: string;
    toVideoId: string;
    triggerId: string;
    returnToIdle?: boolean;
    connectionSettings?: ConnectionSettings;
  }>;
};

export type VideoState = {
  current_video_id?: string;
  state?: string;
  queue_len?: number;
  update_ts?: number;
  start_ts?: number;
  server_time?: number;
  currentClip?: VideoClip | null;
  nextClip?: VideoClip | null;
  upcoming?: VideoClip[];
  activeNodeId?: string | null;
  activeConnectionId?: string | null;
  nextConnectionIds?: string[];
  blockedConnectionIds?: string[];
  executionMode?: 'live' | 'test' | 'dry-run' | 'editing';
  lastTransitionAt?: number | null;
};

export type LivePlanStep = {
  id: string;
  label: string;
  enabled: boolean;
  mode: 'simulated' | 'approval_required' | 'real';
  description?: string;
  status?: 'ready' | 'blocked' | 'warning';
};

export type LivePlan = {
  ok?: boolean;
  dryRun?: boolean;
  actionMode?: LiveConfig['actionMode'];
  settings?: Record<string, unknown>;
  steps?: LivePlanStep[];
  risks?: string[];
  health?: ObsHealthResult | null;
  error?: string | null;
};

export type AutomationLogEntry = {
  timestamp: string;
  stage: string;
  message: string;
  data?: Record<string, unknown>;
};

type AutomationTestResponse = {
  status: string;
  text?: string;
  events?: Array<Record<string, unknown>>;
  matchedTriggers?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
  queuedActions?: Array<Record<string, unknown>>;
  logs?: AutomationLogEntry[];
  queue?: Array<Record<string, unknown>>;
};

type AutomationExecutionResponse = {
  status: string;
  action?: Record<string, unknown>;
  result?: Record<string, unknown>;
  videoState?: VideoState;
};

export type ObsSettings = {
  enabled: boolean;
  websocketUrl: string;
  websocketPassword?: string;
  passwordConfigured?: boolean;
  ocrSourceName: string;
  chatSourceName: string;
  stageSourceName: string;
  stageUrl: string;
  startupSceneName: string;
  liveSceneName: string;
  transmissionMode: 'stream' | 'virtual_camera' | 'none';
  canvasWidth: number;
  canvasHeight: number;
  sceneWhitelist: string[];
  allowedScenes: string[];
};

export type ObsConnectionFields = {
  host: string;
  port: string;
  authenticationEnabled: boolean;
};

export type WorkspaceSettings = {
  apiBudgetMode: 'economico' | 'normal' | 'agressivo';
  automationMode: 'manual' | 'assistido' | 'automatico';
  errorReports: boolean;
  telemetry: boolean;
};

export type ObsHealthResult = {
  ok?: boolean;
  connected?: boolean;
  sourceReady?: boolean;
  sourceName?: string;
  currentScene?: string | null;
  screenshotReady?: boolean;
  sceneSwitchReady?: boolean;
  availableScenes?: string[];
  allowedScenes?: string[];
  imageWidth?: number | null;
  imageHeight?: number | null;
  layout?: Partial<ObsSettings>;
  chatSourceReady?: boolean;
  stageSourceReady?: boolean;
  startupSceneReady?: boolean;
  liveSceneReady?: boolean;
  transmission?: {
    ok?: boolean;
    mode?: string;
    streamActive?: boolean;
    virtualCameraActive?: boolean;
    error?: string | null;
  } | null;
  error?: string | null;
};

export type WebhookConfig = {
  id: string;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  enabled: boolean;
  timeoutMs: number;
  bodyTemplate: string;
};

export type WebhookDraft = Omit<WebhookConfig, 'id'> & { id?: string };

export type ReactiveRunResult = {
  input: string;
  source: string;
  createdAt: string;
  test: AutomationTestResponse;
  executions: AutomationExecutionResponse[];
};

function tabFromPanel(panel: AdvancedPanel): TabKey {
  if (panel === 'content') return 'library';
  if (panel === 'runtime') return 'flow';
  if (panel === 'settings') return 'settings';
  if (panel === 'canvas') return 'settings';
  if (panel === 'persona') return 'personas';
  return 'live';
}

function videoLabel(video?: VideoEntry) {
  if (!video) return 'Nenhum video';
  return (
    video.label ||
    video.id
      .replace(/^grok-/, '')
      .replace(/-/g, ' ')
      .slice(0, 42)
  );
}

export default function OdessaLiveCenter({
  capturedText,
  setCapturedText,
  runtime,
  requestedPanel,
  liveConfig = { voiceEnabled: false, enableChat: false },
  liveStartError = null,
  onLiveConfigOpenChange,
  onLiveConfigChange,
  onActiveTabChange,
  onStartLive,
  onEndLive,
  obsSettingsFromApp = null,
  onObsSettingsChanged,
}: OdessaLiveCenterProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(() => tabFromPanel(requestedPanel));

  useEffect(() => {
    onActiveTabChange?.(activeTab);
    // onActiveTabChange de propósito fora das deps: no App.tsx é uma arrow
    // function inline, recriada a cada render — incluí-la aqui disparava o
    // efeito (e o setState correspondente) em cascata a cada render do App,
    // não só quando a aba realmente muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const [settingsSubTab, setSettingsSubTab] = useState<'general' | 'ai' | 'canvas'>('general');
  const [flowSubTab, setFlowSubTab] = useState<'board' | 'logs'>('board');
  const [liveMode, setLiveMode] = useState<'central' | 'stage'>('stage');
  // Editor de vídeo canônico (Fase 5b) — um único modal, aberto de qualquer
  // aba (Palco ou Biblioteca), em vez de duas instâncias/UIs separadas.
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const [editingVideoLabel, setEditingVideoLabel] = useState<string | undefined>(undefined);
  const openVideoEditor = useCallback((videoId: string, label?: string) => {
    setEditingVideoId(videoId);
    setEditingVideoLabel(label);
  }, []);
  const [config, setConfig] = useState<PersonaConfig | null>(null);
  const [videoState, setVideoState] = useState<VideoState | null>(null);
  const [, setConfigError] = useState<string | null>(null);
  const [automationLogs, setAutomationLogs] = useState<AutomationLogEntry[]>([]);
  const [latestReactiveRun, setLatestReactiveRun] = useState<ReactiveRunResult | null>(null);
  const [reactiveError, setReactiveError] = useState<string | null>(null);
  const [reactiveBusy, setReactiveBusy] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/video/config'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as PersonaConfig;
      setConfig(data);
      console.log('[VIDEO_DEBUG] config_loaded', {
        videoCount: data?.videos?.length || 0,
        idleVideoId: data?.idleVideoId,
        availableVideos: data?.videos?.map((video) => video.id),
      });
      if (!data?.videos?.length) {
        // Persona nova/vazia é normal, não um erro — não poluir o console.
        console.debug('[VIDEO_DEBUG] no_videos_found_in_library');
      }
      setConfigError(null);
    } catch (err) {
      console.error('[VIDEO_ERROR] backend_offline_or_invalid_config', err);
      setConfigError(err instanceof Error ? err.message : 'Backend indisponivel');
    }
  }, []);

  // Cenas/sources do OBS são configuradas por persona (aba Personas >
  // Configuração de Transmissão), mas o "Iniciar live" e os botões de OBS
  // usam obsSettingsFromApp — que só carregava a config GLOBAL de
  // /obs/settings. Sem isto, trocar de persona nunca atualizava cena/source
  // no OBS, misturando o conteúdo de uma persona com a live da outra.
  const refreshObsSettingsForPersona = useCallback(
    async (personaId: string) => {
      try {
        const { transmissionConfig } = await getPersonaTransmission(personaId);
        onObsSettingsChanged?.({ ...(obsSettingsFromApp ?? {}), ...transmissionConfig });
      } catch {
        // Melhor esforço — a live continua usável com a config anterior.
      }
    },
    [obsSettingsFromApp, onObsSettingsChanged],
  );

  const refreshVideoState = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/video/state'));
      if (!response.ok) return;
      const next = (await response.json()) as VideoState;
      // Only update when something visible changed — the response includes a
      // volatile server_time that would otherwise re-render every poll.
      setVideoState((prev) => {
        const sig = (s: VideoState | null) =>
          s
            ? `${s.current_video_id || ''}|${s.state || ''}|${s.activeNodeId || ''}|${s.activeConnectionId || ''}|${JSON.stringify(s.currentClip || null)}`
            : '';
        return sig(prev) === sig(next) ? prev : next;
      });
    } catch {
      // The shell keeps working when the backend is offline.
    }
  }, []);

  const refreshAutomationLogs = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/automation/logs'));
      if (!response.ok) return;
      const data = (await response.json()) as { logs?: AutomationLogEntry[] };
      setAutomationLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch {
      // Logs are diagnostic; the main controls stay usable if polling fails.
    }
  }, []);

  const processedGiftIdsRef = useRef<Set<string> | null>(null);
  if (processedGiftIdsRef.current === null) {
    // ⚡ Bolt: Lazily initialize the Set to avoid O(N) memory allocation and iteration on every render.
    processedGiftIdsRef.current = new Set(capturedText.map((event) => event.id));
  }

  const drainReactiveQueue = useCallback(async () => {
    const executions: AutomationExecutionResponse[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await fetch(apiUrl('/api/automation/next-action'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as AutomationExecutionResponse;
      if (payload.status === 'empty') break;
      executions.push(payload);
      if (payload.videoState) setVideoState(payload.videoState);
    }
    return executions;
  }, []);

  const runReactiveFlow = useCallback(
    async (text: string, source = 'manual') => {
      const cleanText = text.trim();
      if (!cleanText) return null;

      setReactiveBusy(true);
      setReactiveError(null);
      try {
        if (source === 'manual' || source === 'test') {
          const emitted = emitEvent({
            id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            source: source === 'test' ? 'test' : 'manual',
            zoneName: 'Teste manual',
            text: cleanText,
            kind: 'chat',
            createdAt: new Date().toISOString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            metadata: { triggerTest: true },
          });
          processedGiftIdsRef.current!.add(emitted.id);
          setCapturedText((current) => [...current.filter((event) => event.id !== emitted.id), emitted].slice(-100));
        }

        const response = await fetch(apiUrl('/api/automation/ingest'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText,
            source,
            zoneName: source === 'test' ? 'Teste manual' : 'Entrada manual',
            kind: 'chat',
            execute: true,
            maxActions: 6,
          }),
        });
        const ingest = (await response.json()) as {
          summary?: AutomationTestResponse;
          executions?: AutomationExecutionResponse[];
        };
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const test = ingest.summary || {
          status: 'processed',
          text: cleanText,
          events: [],
          matchedTriggers: [],
          actions: [],
          queuedActions: [],
          logs: [],
        };
        const executions = Array.isArray(ingest.executions)
          ? ingest.executions
          : await drainReactiveQueue();
        const run = {
          input: cleanText,
          source,
          createdAt: new Date().toISOString(),
          test,
          executions,
        };
        setLatestReactiveRun(run);
        await refreshAutomationLogs();
        await refreshVideoState();
        return run;
      } catch (err) {
        setReactiveError(err instanceof Error ? err.message : 'Falha no fluxo reativo');
        return null;
      } finally {
        setReactiveBusy(false);
      }
    },
    [drainReactiveQueue, refreshAutomationLogs, refreshVideoState, setCapturedText],
  );

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => {
      void loadConfig();
      void refreshVideoState();
      void refreshAutomationLogs();
    }, 0);

    // Poll video state continuously, on every tab, so Início, Palco e Fluxo
    // Reativo refletem a mesma reproducao em tempo real.
    const videoTimer = window.setInterval(() => {
      void refreshVideoState();
    }, 600);
    const logsTimer =
      activeTab === 'logs'
        ? window.setInterval(() => {
            void refreshAutomationLogs();
          }, 5000)
        : null;

    return () => {
      window.clearTimeout(initialLoadTimer);
      window.clearInterval(videoTimer);
      if (logsTimer !== null) window.clearInterval(logsTimer);
    };
  }, [activeTab, loadConfig, refreshAutomationLogs, refreshVideoState]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const target = tabFromPanel(requestedPanel);
      setActiveTab(target);
      if (requestedPanel === 'canvas') setSettingsSubTab('canvas');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [requestedPanel]);

  /**
   * playVideoById — the SINGLE reliable function to play a video.
   * Validates video exists, logs steps, and calls backend.
   */
  const playVideoById = async (videoId: string, reason = 'unknown') => {
    console.log('[VIDEO_PLAY] requested', { videoId, reason });
    if (reason === 'manual_click') {
      console.log('[VIDEO_DEBUG] manual_click_received');
    }

    const video = config?.videos.find((item) => item.id === videoId);
    if (!video) {
      console.error('[VIDEO_ERROR] video_not_found', { videoId });
      return { ok: false, reason: 'video_not_found' };
    }

    const src = video.src || video.url || apiUrl(`/api/video/play/${video.id}`);
    console.log('[VIDEO_DEBUG] selectedVideoId:', videoId);
    console.log('[VIDEO_DEBUG] video_found: true');
    console.log('[VIDEO_DEBUG] video_src:', src);
    console.log('[VIDEO_DEBUG] setCurrentVideo_called');

    try {
      const response = await fetch(apiUrl('/api/video/force'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, state: 'ACTION' }),
      });

      if (!response.ok) {
        console.error('[VIDEO_ERROR] playback_failed - HTTP', response.status);
        return { ok: false, reason: 'playback_failed' };
      }

      console.log('[VIDEO_PLAY] current_video_set', {
        videoId: video.id,
        title: video.title || video.id,
        src,
        reason,
      });
      console.log('[VIDEO_DEBUG] play_attempted');
      console.log('[VIDEO_DEBUG] play_success');
      refreshVideoState();
      return { ok: true, video };
    } catch (err) {
      // Falha já tratada acima (retorno { ok: false }) — o chamador decide o
      // que fazer, então isto não é uma quebra não-tratada.
      console.warn('[VIDEO_WARN] playback_failed', err);
      return { ok: false, reason: 'exception' };
    }
  };

  const view = useMemo(() => {
    const videos = config?.videos || [];
    const triggers = config?.triggers || [];
    const idleVideoId =
      config?.idleVideoId ||
      config?.action_map?.idle?.[0] ||
      videos.find((item) => item.loop)?.id ||
      '';
    const currentVideo = videos.find((item) => item.id === videoState?.current_video_id);
    const idleVideo = videos.find((item) => item.id === idleVideoId);
    const activeTriggers = triggers.filter((item) => item.enabled);
    const connections = config?.flowConnections || [];
    const flowNodes = config?.flowNodes || [];
    // ⚡ Bolt: Using a backward for-loop to prevent O(N) memory allocation and iteration on every render.
    let lastOcr;
    for (let i = capturedText.length - 1; i >= 0; i--) {
      if (capturedText[i].source === 'ocr') {
        lastOcr = capturedText[i];
        break;
      }
    }
    return {
      videos,
      triggers,
      activeTriggers,
      connections,
      flowNodes,
      idleVideoId,
      idleVideo,
      currentVideo,
      lastOcr,
      isLive: runtime.autopilotEnabled,
      readyScore: [
        runtime.health?.status === 'ok',
        Boolean(idleVideoId),
        activeTriggers.length > 0,
      ].filter(Boolean).length,
    };
  }, [
    capturedText,
    config,
    runtime.autopilotEnabled,
    runtime.health?.status,
    videoState?.current_video_id,
  ]);

  return (
    <main className="odessa-shell odsa-v2 flex h-screen w-screen min-h-0 overflow-hidden text-[var(--t1)]">
      {/* Sidebar (desktop) — navegação agrupada + card fixo da Diretora */}
      <aside className="odsa-sidebar hidden lg:flex">
        <div className="odsa-brand">
          <span className="odsa-brand-mark">
            <svg viewBox="0 0 1024 1024" aria-label="Odessa" style={{ width: 28, height: 28 }}>
              <defs>
                <linearGradient id="oring" x1="256" y1="208" x2="792" y2="832" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#f8fafc"/>
                  <stop offset="0.38" stopColor="#93c5fd"/>
                  <stop offset="0.72" stopColor="#22d3ee"/>
                  <stop offset="1" stopColor="#38bdf8"/>
                </linearGradient>
              </defs>
              <circle cx="512" cy="512" r="326" fill="none" stroke="#0f172a" strokeWidth="46"/>
              <circle cx="512" cy="512" r="278" fill="none" stroke="url(#oring)" strokeWidth="118"/>
              <circle cx="512" cy="512" r="168" fill="#07111f"/>
              <path d="M704 286c36 26 66 59 88 98" fill="none" stroke="#e0f2fe" strokeWidth="34" strokeLinecap="round" opacity="0.86"/>
              <circle cx="742" cy="284" r="34" fill="#67e8f9"/>
              <circle cx="742" cy="284" r="58" fill="none" stroke="#22d3ee" strokeWidth="14" opacity="0.35"/>
            </svg>
          </span>
          <div className="odsa-brand-text">
            <div className="odsa-brand-name">Odessa</div>
            <div className="odsa-brand-sub">Studio</div>
          </div>
        </div>

        <nav className="odsa-side-nav">
          <div className="odsa-nav-group">
            <span className="odsa-nav-label">Estúdio</span>
            <div className="anim-slide-in anim-stagger-1">
            <SideNavButton
              icon={<RadioTower />}
              label="Ao Vivo"
              active={activeTab === 'live' || activeTab === 'chat' || activeTab === 'home' || activeTab === 'stage'}
              onClick={() => setActiveTab('live')}
            />
            </div>
            <div className="anim-slide-in anim-stagger-2">
            <SideNavButton
              icon={<Film />}
              label="Biblioteca"
              active={activeTab === 'library'}
              onClick={() => setActiveTab('library')}
            />
            </div>
            <div className="anim-slide-in anim-stagger-3">
            <SideNavButton
              icon={<Link2 />}
              label="Automações"
              active={activeTab === 'flow' || activeTab === 'logs'}
              onClick={() => setActiveTab('flow')}
            />
            </div>
            <div className="anim-slide-in anim-stagger-4">
            <SideNavButton
              icon={<MessageCircle />}
              label="Conversar"
              active={activeTab === 'conversation'}
              onClick={() => setActiveTab('conversation')}
            />
            </div>
            <div className="anim-slide-in anim-stagger-4">
            <SideNavButton
              icon={<Users />}
              label="Personas"
              active={activeTab === 'personas'}
              onClick={() => setActiveTab('personas')}
            />
            </div>
            <div className="anim-slide-in anim-stagger-5">
            <SideNavButton
              icon={<History />}
              label="Histórico"
              active={activeTab === 'history'}
              onClick={() => setActiveTab('history')}
            />
            </div>
            <div className="anim-slide-in anim-stagger-6">
            <SideNavButton
              icon={<Settings />}
              label="Configurações"
              active={activeTab === 'settings' || activeTab === 'ai' || activeTab === 'canvas'}
              onClick={() => setActiveTab('settings')}
            />
            </div>
            <div className="anim-slide-in anim-stagger-6">
            <SideNavButton
              icon={<Stethoscope />}
              label="Diagnóstico"
              active={activeTab === 'admin'}
              onClick={() => setActiveTab('admin')}
            />
            </div>
          </div>
        </nav>

        <DirectorStatusCard runtime={runtime} onOpen={() => { setActiveTab('personas'); }} />
      </aside>

      {/* Coluna principal: topbar + conteúdo */}
      <div className="odsa-main flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="odsa-topbar">
          <div className="odsa-topbar-title">
            <span className="odsa-crumb">{TAB_META[activeTab].group}</span>
            <h1>{TAB_META[activeTab].title}</h1>
          </div>

        {/* Right side: persona selector + status + CTA */}
        <div className="odsa-header-end">
          {/* Seletor de persona ativa — cada persona carrega sua própria config de transmissão */}
          <TopPersonaSelector
            onPersonaChanged={(personaId) => {
              void loadConfig();
              void refreshVideoState();
              void refreshObsSettingsForPersona(personaId);
            }}
          />

          {/* Live / Pronta pill */}
          <span className={cn('odsa-live-pill hidden sm:inline-flex', runtime.autopilotEnabled && 'is-on')}>
            <span className="d" />
            {runtime.autopilotEnabled ? 'AO VIVO' : 'PRONTA'}
          </span>

          {/* Settings icon button */}
          <button
            className="odsa-btn odsa-btn-secondary odsa-btn-md odsa-btn-icon"
            onClick={() => { onLiveConfigOpenChange?.(false); setActiveTab('settings'); }}
            title="Configurações"
          >
            <Settings style={{ width: 16, height: 16 }} />
          </button>

          {/* Primary CTA */}
          <button
            className={cn('odsa-btn odsa-btn-md', runtime.autopilotEnabled ? 'odsa-btn-secondary' : 'odsa-btn-primary')}
            onClick={() => {
              if (runtime.autopilotEnabled) { onEndLive?.(); return; }
              if (onStartLive) { void onStartLive(); return; }
              runtime.start();
            }}
          >
            {runtime.autopilotEnabled
              ? <Pause style={{ width: 15, height: 15 }} />
              : <Play  style={{ width: 15, height: 15 }} />}
            {runtime.autopilotEnabled ? 'Pausar live' : 'Iniciar live'}
          </button>
        </div>

        {liveStartError && (
          <div className="odsa-toast anim-scale-in">
            {liveStartError}
          </div>
        )}
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-1.5 lg:hidden" style={{ background: 'rgba(6,7,10,0.86)', backdropFilter: 'blur(20px)' }}>
        {([
          { id: 'live', label: 'Ao Vivo' },
          { id: 'library', label: 'Biblioteca' },
          { id: 'flow', label: 'Automações' },
          { id: 'personas', label: 'Personas' },
          { id: 'history', label: 'Histórico' },
          { id: 'admin', label: 'Diagnóstico' },
          { id: 'settings', label: 'Configurações' },
        ] as { id: TabKey; label: string }[]).map(({ id, label }) => {
          const isActive =
            activeTab === id ||
            (id === 'live' && (activeTab === 'chat' || activeTab === 'home' || activeTab === 'stage')) ||
            (id === 'flow' && activeTab === 'logs') ||
            (id === 'settings' && (activeTab === 'ai' || activeTab === 'canvas'));
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn('od-tab od-tab-sm shrink-0', isActive && 'is-active')}
              style={{ height: 28, fontSize: 11.5, padding: '0 10px' }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <section key={activeTab} className="anim-tab-enter flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 1. AO VIVO (Palco + Central da Live) */}
        {(activeTab === 'live' || activeTab === 'chat' || activeTab === 'home' || activeTab === 'stage') && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/5 bg-black/40 px-4 py-1.5 text-xs">
              <Tabs
                size="sm"
                value={liveMode}
                onChange={(id) => setLiveMode(id as 'central' | 'stage')}
                items={[
                  { id: 'stage', label: 'Palco' },
                  { id: 'central', label: 'Central da Live' },
                ]}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
              {liveMode === 'central' && (
                <TangoChatPanel
                  capturedText={capturedText}
                  runtime={runtime}
                  videoState={videoState}
                  onEndLive={onEndLive}
                  obsSettings={obsSettingsFromApp}
                />
              )}
              {liveMode === 'stage' && (
                <StagePanel
                  runtime={runtime}
                  capturedText={capturedText}
                  view={view}
                  videoState={videoState}
                  obsSettingsFromApp={obsSettingsFromApp}
                  onRefresh={refreshVideoState}
                  onPlayVideoById={playVideoById}
                  onOpenEditor={openVideoEditor}
                />
              )}
            </div>
          </div>
        )}

        {/* 2. BIBLIOTECA */}
        {activeTab === 'library' && (
          <VideoLibraryPanel config={config} onChanged={loadConfig} onOpenEditor={openVideoEditor} />
        )}

        {/* 3. AUTOMAÇÕES (Fluxo Reativo + Logs) */}
        {(activeTab === 'flow' || activeTab === 'logs') && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/5 bg-black/40 px-4 py-1.5 text-xs">
              <Tabs
                size="sm"
                value={flowSubTab}
                onChange={(id) => setFlowSubTab(id as 'board' | 'logs')}
                items={[
                  { id: 'board', label: 'Fluxo Reativo' },
                  { id: 'logs', label: 'Logs de Automação' },
                ]}
              />
            </div>
            {flowSubTab === 'board' ? (
              <Suspense fallback={<PanelLoading label="Carregando fluxo reativo" />}>
                <ReactiveFlowBoard
                  onSaved={() => {
                    loadConfig();
                    refreshVideoState();
                  }}
                />
              </Suspense>
            ) : (
              <PageSurface
                icon={<ListVideo className="h-4 w-4" />}
                title="Logs da operacao"
                description="Teste o caminho real: chat/OCR, gatilho salvo no fluxo, fila e video."
              >
                <Suspense fallback={<PanelLoading label="Carregando logs de automação" />}>
                  <ReactiveFlowLogLab
                    capturedText={capturedText}
                    logs={automationLogs}
                    latestRun={latestReactiveRun}
                    error={reactiveError}
                    busy={reactiveBusy}
                    videoState={videoState}
                    runtime={runtime}
                    onRefreshLogs={refreshAutomationLogs}
                    onRun={runReactiveFlow}
                  />
                </Suspense>
              </PageSurface>
            )}
          </div>
        )}

        {/* 4. PERSONAS */}
        {activeTab === 'personas' && <PersonasPanel />}

        {/* 5. CONVERSA LOCAL */}
        {activeTab === 'conversation' && <PersonaChatLab />}

        {activeTab === 'admin' && <AdminPanel />}

        {/* 6. HISTÓRICO */}
        {activeTab === 'history' && (
          <PageSurface
            icon={<History className="h-4 w-4" />}
            title="Histórico da Live"
            description="Registro consolidado de eventos, mensagens recebidas, presentes e respostas de IA."
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
              <SessionHistoryPanel active={activeTab === 'history'} />
            </div>
          </PageSurface>
        )}

        {/* 5. CONFIGURAÇÕES (OBS, IA, Mural) */}
        {(activeTab === 'settings' || activeTab === 'ai' || activeTab === 'canvas') && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-1.5 border-b border-white/5 bg-black/40 px-4 py-2 text-xs">
              <Tabs
                size="sm"
                value={settingsSubTab}
                onChange={(id) => setSettingsSubTab(id as 'general' | 'ai' | 'canvas')}
                items={[
                  { id: 'general', label: 'OBS & Webhooks', icon: <Settings style={{ width: 13, height: 13 }} /> },
                  { id: 'ai', label: 'Diretora IA', icon: <Brain style={{ width: 13, height: 13 }} /> },
                  { id: 'canvas', label: 'Mural de Planejamento', icon: <ClipboardCheck style={{ width: 13, height: 13 }} /> },
                ]}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {settingsSubTab === 'general' && (
                <SettingsPanel
                  health={runtime.health}
                  onRefreshHealth={runtime.refreshHealth}
                  liveConfig={liveConfig}
                  onLiveConfigChange={onLiveConfigChange}
                  onObsSettingsChanged={onObsSettingsChanged}
                  onSaved={() => {
                    void runtime.refreshObsScenes();
                  }}
                />
              )}
              {settingsSubTab === 'ai' && (
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <AiConfigPanel />
                </div>
              )}
              {settingsSubTab === 'canvas' && (
                <Suspense fallback={<PanelLoading label="Carregando mural de planejamento" />}>
                  <div className="flex-1 min-h-0 h-full overflow-hidden p-2">
                    <PlanningCanvas />
                  </div>
                </Suspense>
              )}
            </div>
          </div>
        )}

      </section>
      </div>

      {/* Editor de vídeo canônico (Fase 5b) — aberto do Palco ou da Biblioteca */}
      {editingVideoId && (
        <Suspense fallback={null}>
          <VideoEditor
            videoId={editingVideoId}
            label={editingVideoLabel}
            onClose={() => setEditingVideoId(null)}
          />
        </Suspense>
      )}
    </main>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center bg-[#07080a] text-sm font-semibold text-slate-400">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin text-[var(--gold)]" />
      {label}
    </div>
  );
}

function PageSurface({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4 lg:p-5">
      <div className="anim-header-in mb-4 shrink-0 rounded-[34px] border border-white/10 bg-[#101114] p-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-sky-200/70">
          {icon}
          Odessa console
        </div>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-white">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">{description}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[34px] border border-white/10 bg-[#07080a]">
        {children}
      </div>
    </div>
  );
}

export const DEFAULT_OBS_SETTINGS: ObsSettings = {
  enabled: true,
  websocketUrl: 'ws://localhost:4455',
  websocketPassword: '',
  passwordConfigured: false,
  ocrSourceName: 'Odessa Chat OCR',
  chatSourceName: 'Odessa Chat OCR',
  stageSourceName: 'Odessa Stage Overlay',
  stageUrl: 'http://localhost:3000/#overlay',
  startupSceneName: 'Odessa START',
  liveSceneName: 'Odessa LIVE',
  transmissionMode: 'stream',
  canvasWidth: 1080,
  canvasHeight: 1920,
  sceneWhitelist: [],
  allowedScenes: [],
};

export const WORKSPACE_SETTINGS_KEY = 'odessa:workspace-settings:v1';

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  apiBudgetMode: 'normal',
  automationMode: 'assistido',
  errorReports: true,
  telemetry: false,
};

export function normalizeObsSettings(settings?: Partial<ObsSettings>): ObsSettings {
  const rawWhitelist = settings?.allowedScenes || settings?.sceneWhitelist;
  const scenes = Array.isArray(rawWhitelist)
    ? rawWhitelist.map((scene) => String(scene).trim()).filter(Boolean)
    : [];
  return {
    ...DEFAULT_OBS_SETTINGS,
    ...settings,
    ocrSourceName: settings?.ocrSourceName || settings?.chatSourceName || DEFAULT_OBS_SETTINGS.ocrSourceName,
    chatSourceName: settings?.chatSourceName || settings?.ocrSourceName || DEFAULT_OBS_SETTINGS.chatSourceName,
    transmissionMode:
      settings?.transmissionMode === 'virtual_camera' || settings?.transmissionMode === 'none'
        ? settings.transmissionMode
        : 'stream',
    canvasWidth: Math.max(1, Number(settings?.canvasWidth || DEFAULT_OBS_SETTINGS.canvasWidth)),
    canvasHeight: Math.max(1, Number(settings?.canvasHeight || DEFAULT_OBS_SETTINGS.canvasHeight)),
    sceneWhitelist: scenes,
    allowedScenes: scenes,
  };
}

export function loadWorkspaceSettings(): WorkspaceSettings {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_SETTINGS;
  try {
    const stored = window.localStorage.getItem(WORKSPACE_SETTINGS_KEY);
    if (!stored) return DEFAULT_WORKSPACE_SETTINGS;
    return { ...DEFAULT_WORKSPACE_SETTINGS, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_WORKSPACE_SETTINGS;
  }
}

export function parseObsConnection(settings: ObsSettings): ObsConnectionFields {
  try {
    const url = new URL(settings.websocketUrl || DEFAULT_OBS_SETTINGS.websocketUrl);
    return {
      host: url.hostname || 'localhost',
      port: url.port || '4455',
      authenticationEnabled: Boolean(settings.passwordConfigured || settings.websocketPassword),
    };
  } catch {
    const withoutProtocol = (settings.websocketUrl || DEFAULT_OBS_SETTINGS.websocketUrl)
      .replace(/^wss?:\/\//i, '')
      .replace(/\/.*$/, '');
    const [host, port] = withoutProtocol.split(':');
    return {
      host: host || 'localhost',
      port: port || '4455',
      authenticationEnabled: Boolean(settings.passwordConfigured || settings.websocketPassword),
    };
  }
}

export function buildObsWebsocketUrl(connection: ObsConnectionFields) {
  const host = connection.host.trim().replace(/^wss?:\/\//i, '').replace(/\/.*$/, '') || 'localhost';
  const port = String(connection.port || '4455').replace(/\D/g, '') || '4455';
  return `ws://${host}:${port}`;
}

export const EMPTY_WEBHOOK_DRAFT: WebhookDraft = {
  name: 'Novo webhook',
  url: '',
  method: 'POST',
  headers: {},
  enabled: true,
  timeoutMs: 2500,
  bodyTemplate:
    '{\n  "product": "Odessa",\n  "event": "{event.text}",\n  "action": "{action.type}"\n}',
};

export function headersToText(headers: Record<string, string>) {
  return Object.entries(headers || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

export function parseHeadersText(value: string) {
  return Object.fromEntries(
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split(':');
        return [key.trim(), rest.join(':').trim()];
      })
      .filter(([key]) => Boolean(key)),
  );
}

// Metadados de cada aba para o cabeçalho/sidebar (redesign Studio 2.0).
const TAB_META: Record<TabKey, { group: string; title: string }> = {
  live:     { group: 'Operação', title: 'Ao Vivo' },
  conversation: { group: 'Laboratório', title: 'Conversa com Personas' },
  library:  { group: 'Conteúdo', title: 'Biblioteca' },
  flow:     { group: 'Operação', title: 'Automações' },
  personas: { group: 'Conteúdo', title: 'Personas de IA' },
  history:  { group: 'Operação', title: 'Histórico da Live' },
  settings: { group: 'Sistema',  title: 'Configurações' },
  admin:    { group: 'Sistema',  title: 'Diagnóstico do Sistema' },
  home:     { group: 'Operação', title: 'Central da Live' },
  stage:    { group: 'Operação', title: 'Palco' },
  ai:       { group: 'Configuração', title: 'Diretora IA' },
  chat:     { group: 'Operação', title: 'Central da Live' },
  canvas:   { group: 'Conteúdo', title: 'Mural de Planejamento' },
  logs:     { group: 'Sistema',  title: 'Logs' },
};

function SideNavButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void; }) {
  return (
    <button onClick={onClick} className={cn('odsa-side-item', active && 'is-active')}>
      <span className="odsa-side-ico [&_svg]:h-[17px] [&_svg]:w-[17px] [&_svg]:stroke-[1.75]">{icon}</span>
      {label}
    </button>
  );
}

const AUTONOMY_LABEL: Record<AiAutonomyLevel, string> = { manual: 'Manual', assistido: 'Assistido', auto: 'Autônomo' };

/** Card fixo da Diretora na sidebar — estado ao vivo, provedor e autonomia. */
function DirectorStatusCard({ runtime, onOpen }: { runtime: AutopilotRuntimeState; onOpen: () => void; }) {
  const provider = getAiConfig().provider;
  const live = runtime.autopilotEnabled;
  const mode = provider === 'mock' ? 'mock' : hasActiveGeminiKey() ? 'gemini' : 'nokey';
  const providerPill = mode === 'gemini' ? 'Gemini' : mode === 'mock' ? 'Mock' : 'Sem chave';
  const meta = live
    ? 'No ar · conduzindo a live.'
    : mode === 'gemini' ? 'Pronta · IA real (Gemini).'
    : mode === 'mock' ? 'Conduzindo por regras locais.'
    : 'Sem chave — regras locais.';
  return (
    <div className="odsa-director-card" onClick={onOpen} role="button" tabIndex={0}>
      <div className="odsa-dc-top">
        <span className={cn('odsa-dc-dot', live ? 'is-live' : 'is-warn')} />
        <span className="odsa-dc-title">Diretora</span>
        <span className={cn('odsa-dc-pill', mode === 'gemini' ? 'is-violet' : 'is-gold')}>{providerPill}</span>
      </div>
      <div className="odsa-dc-meta">{meta}</div>
      <div className="odsa-dc-row">
        <span className="odsa-dc-pill is-violet">{AUTONOMY_LABEL[runtime.autonomyLevel]}</span>
        <button
          className="odsa-dc-btn"
          onClick={(e) => { e.stopPropagation(); if (live) runtime.pause(); else runtime.start(); }}
        >
          {live ? <Pause style={{ width: 12, height: 12 }} /> : <Play style={{ width: 12, height: 12 }} />}
          {live ? 'Pausar' : 'Iniciar'}
        </button>
      </div>
    </div>
  );
}

type HomeViewData = {
  videos: VideoEntry[];
  triggers: TriggerEntry[];
  activeTriggers: TriggerEntry[];
  flowNodes: FlowNode[];
  connections: Array<{
    id: string;
    fromNodeId?: string;
    toNodeId?: string;
    fromVideoId: string;
    toVideoId: string;
    triggerId: string;
    returnToIdle?: boolean;
    connectionSettings?: ConnectionSettings;
  }>;
  idleVideoId: string;
  idleVideo?: VideoEntry;
  currentVideo?: VideoEntry;
  lastOcr?: CapturedMessage;
};

function clipFromVideoId(videoId: string, videos: VideoEntry[] = []): VideoClip {
  const video = videos.find((item) => item.id === videoId);
  // applyVideoEdit mescla a edição por vídeo (cortes/volume/áudio) salva no
  // editor — assim vídeos forçados pela Diretora honram a edição sem mexer no
  // servidor (o player já respeita startSec/endSec/segments/audio).
  return applyVideoEdit({
    nodeId: null,
    videoId,
    label: videoLabel(video),
    startSec: 0,
    endSec: null,
    transitionMs: 220,
    returnToIdle: false,
    playback: { startSec: 0, endSec: null, transitionMs: 220 },
  });
}

function segmentsKey(segments?: VideoSegment[]) {
  if (!segments?.length) return '';
  return '|seg:' + segments.map((s) => `${s.startSec}-${s.endSec}`).join(',');
}

function clipKey(clip?: VideoClip | null) {
  if (!clip) return 'none';
  // Identity only — nodeId + video + trimmed range (+ segments). transitionMs is
  // a transition setting, not part of the clip's identity, so it is excluded
  // (it differs between currentClip and the preloaded nextClip).
  return `${clip.nodeId || 'video'}:${clip.videoId}:${clip.startSec}:${clip.endSec ?? 'end'}${segmentsKey(clip.segments)}`;
}

/**
 * Reports that the active clip ended so the backend advances the reactive
 * flow to the next node. Idempotent on the server via fromNodeId/fromVideoId,
 * so several players can call it for the same clip without double-advancing.
 */
async function advanceReactiveFlow(state: VideoState | null): Promise<void> {
  await fetch(apiUrl('/api/video/advance'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromNodeId: state?.activeNodeId || state?.currentClip?.nodeId || null,
      fromVideoId: state?.current_video_id || null,
    }),
  }).catch(() => undefined);
}

function clipDisplayName(clip: VideoClip, videos: VideoEntry[]) {
  const video = videos.find((item) => item.id === clip.videoId);
  return clip.label || videoLabel(video);
}

function formatClipTime(value: number | null | undefined) {
  if (value === null || value === undefined) return 'fim';
  return `${Number(value).toFixed(1)}s`;
}

export function ContinuityPlayer({
  clip,
  nextClip = null,
  videos,
  onEnded,
  className,
  fit = 'cover',
  showLabel = true,
  publishProgress: shouldPublishProgress = false,
}: {
  clip: VideoClip | null;
  nextClip?: VideoClip | null;
  videos: VideoEntry[];
  onEnded: () => Promise<void>;
  className?: string;
  fit?: 'cover' | 'contain';
  showLabel?: boolean;
  /** Publica o progresso do clip ativo no store global (só o player principal do Palco). */
  publishProgress?: boolean;
}) {
  const firstVideoRef = useRef<HTMLVideoElement>(null);
  const secondVideoRef = useRef<HTMLVideoElement>(null);
  const refs = useMemo(() => [firstVideoRef, secondVideoRef] as const, []);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const activeSlotRef = useRef<0 | 1>(0);
  // Duração do crossfade de entrada do clip que acabou de assumir (transitionMs).
  const [fadeMs, setFadeMs] = useState(0);
  // Which clip each <video> slot currently holds. A ref (not state) because
  // playback is driven imperatively for frame-accurate, gap-free cuts.
  const slotClipRef = useRef<[VideoClip | null, VideoClip | null]>([null, null]);
  // Índice do segmento atual em cada slot (Fase 4: cortes multi-segmento).
  const slotSegmentRef = useRef<[number, number]>([0, 0]);
  // Trilha/efeito sonoro do clipe ativo (Fase 4: audio.mode === 'track').
  const trackAudioRef = useRef<HTMLAudioElement>(null);
  const endedRef = useRef('');

  // Switch the active slot. activeSlotRef MUST update synchronously here —
  // a deferred (useEffect) update lets a preload effect compute the wrong
  // idle slot and overwrite the src of the video that just started playing.
  const activateSlot = useCallback((slot: 0 | 1, incoming?: VideoClip | null) => {
    // Só há fade quando um clip está de fato substituindo outro; a primeira
    // carga (mesmo slot, nada por baixo) entra direto.
    const previous = activeSlotRef.current;
    const switching = previous !== slot;
    activeSlotRef.current = slot;
    if (switching) {
      const fade = clampFadeMs(incoming?.transitionMs);
      setFadeMs(fade);
      // O clip que saiu segue tocando por baixo durante o fade; depois dele,
      // pausa (senão continua decodificando e, com áudio original, soaria junto).
      window.setTimeout(() => {
        if (activeSlotRef.current !== previous) refs[previous].current?.pause();
      }, fade + 60);
    }
    setActiveSlot(slot);
  }, [refs]);

  const primeElement = useCallback((element: HTMLVideoElement, slotClip: VideoClip, slot: 0 | 1) => {
    element.muted = (slotClip.audio?.mode || 'muted') !== 'original';
    element.volume = Math.max(0, Math.min(1, slotClip.audio?.volume ?? 1));
    // Reinicia no primeiro segmento (cortes multi-segmento da Fase 4).
    slotSegmentRef.current[slot] = 0;
    const segs = effectiveSegments(slotClip);
    const start = segs.length ? segs[0].startSec : Math.max(0, slotClip.startSec || 0);
    element.playbackRate = segmentSpeed(segs[0]);
    try {
      if (Math.abs(element.currentTime - start) > 0.25) element.currentTime = start;
    } catch {
      // Seeking can fail before metadata is ready — handled on loadedmetadata.
    }
  }, []);

  // Load a clip into a slot. autoplay=true plays + activates it; autoplay=false
  // just buffers it (first frame decoded, paused) so a later cut is instant.
  const loadSlot = useCallback(
    (slot: 0 | 1, slotClip: VideoClip, autoplay: boolean) => {
      const element = refs[slot].current;
      if (!element) return;
      // videoId obsoleto (vídeo removido da Biblioteca, config desatualizada
      // etc.) nunca deve gerar uma requisição de rede — o backend devolveria
      // 404 e o navegador logaria isso por conta própria, sem o app poder
      // evitar. Recusar aqui evita tanto o erro de rede quanto o log.
      const knownVideo = videos.some((v) => v.id === slotClip.videoId);
      if (!knownVideo) {
        console.debug('[VIDEO_DEBUG] skip_unknown_video_id', { videoId: slotClip.videoId, slot });
        return;
      }
      const alreadyLoaded = clipKey(slotClipRef.current[slot]) === clipKey(slotClip);
      if (!alreadyLoaded) {
        slotClipRef.current[slot] = slotClip;
        // Loop ONLY when the clip is explicitly a looping clip (the idle).
        // returnToIdle is a flow setting ("go back to idle after"), not a
        // loop flag — using it here made sequence clips loop forever.
        element.loop = !slotClip.endSec && slotClip.loop === true;
        element.src = apiUrl(`/api/video/play/${slotClip.videoId}`);
        element.load();
      }
      const ready = () => {
        if (autoplay) {
          primeElement(element, slotClip, slot);
          void element.play().catch(() => undefined);
          activateSlot(slot, slotClip);
          return;
        }
        // Preload only. But metadata loads asynchronously — if a cut promoted
        // this slot to active while we waited, it is now playing the clip and
        // must NOT be paused or re-seeked, or the flow freezes.
        if (activeSlotRef.current === slot) return;
        primeElement(element, slotClip, slot);
        element.pause();
      };
      if (element.readyState >= 1) ready();
      else element.addEventListener('loadedmetadata', ready, { once: true });
    },
    [activateSlot, primeElement, refs, videos],
  );

  // Instant hard-cut to a slot whose clip is already buffered. No fade.
  const cutToSlot = useCallback(
    (slot: 0 | 1) => {
      // Cutting to the slot that is already active would re-seek a video
      // mid-playback and visibly restart/jump it — never do that.
      if (activeSlotRef.current === slot) return;
      const element = refs[slot].current;
      const slotClip = slotClipRef.current[slot];
      if (!element || !slotClip) return;
      primeElement(element, slotClip, slot);
      void element.play().catch(() => undefined);
      const other = refs[slot === 0 ? 1 : 0].current;
      if (other) other.pause();
      activateSlot(slot, slotClip);
    },
    [activateSlot, primeElement, refs],
  );

  // Keep the active slot playing the current clip.
  useEffect(() => {
    if (!clip) return;
    endedRef.current = '';
    const active = activeSlotRef.current;
    const idle: 0 | 1 = active === 0 ? 1 : 0;
    if (clipKey(slotClipRef.current[active]) === clipKey(clip)) return; // already playing
    if (clipKey(slotClipRef.current[idle]) === clipKey(clip)) {
      cutToSlot(idle); // preloaded in the idle slot → seamless cut
      return;
    }
    // Not loaded anywhere — use the active slot on first run, otherwise the
    // idle slot (the old video stays visible until the new one can play).
    loadSlot(slotClipRef.current[active] ? idle : active, clip, true);
  }, [clip, cutToSlot, loadSlot]);

  // Preload the next clip into the idle slot so the end-of-video cut is gapless.
  useEffect(() => {
    if (!nextClip) return;
    const idle: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
    if (clipKey(slotClipRef.current[idle]) === clipKey(nextClip)) return;
    if (clipKey(slotClipRef.current[idle]) === clipKey(clip)) return; // idle is mid-cut
    loadSlot(idle, nextClip, false);
  }, [nextClip, clip, loadSlot]);

  // The active clip ended → instantly cut to the preloaded next slot, advance.
  const handleClipEnd = useCallback(
    (endedClip: VideoClip | null) => {
      if (!endedClip) return;
      const key = clipKey(endedClip);
      if (endedRef.current === key) return;
      endedRef.current = key;
      const idle: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
      if (slotClipRef.current[idle]) cutToSlot(idle);
      void onEnded();
    },
    [cutToSlot, onEnded],
  );

  const handleProgress = (slot: 0 | 1, element: HTMLVideoElement) => {
    const slotClip = slotClipRef.current[slot];
    if (!slotClip) return;
    if (shouldPublishProgress && slot === activeSlotRef.current) {
      const progress = clipProgress(slotClip, slotSegmentRef.current[slot], element.currentTime, element.duration);
      if (progress) publishProgress({ videoId: slotClip.videoId, ...progress });
    }
    const segs = effectiveSegments(slotClip);
    if (!segs.length) return; // vídeo inteiro → encerra pelo evento 'ended' nativo
    let idx = slotSegmentRef.current[slot];
    if (idx >= segs.length) idx = segs.length - 1;
    const seg = segs[idx];
    if (element.currentTime < seg.endSec) return;
    if (idx + 1 < segs.length) {
      // Próximo corte: pula para o início do segmento seguinte (mesma fonte).
      slotSegmentRef.current[slot] = idx + 1;
      element.playbackRate = segmentSpeed(segs[idx + 1]);
      try {
        element.currentTime = segs[idx + 1].startSec;
      } catch {
        /* seek pode falhar momentaneamente — re-tenta no próximo timeupdate */
      }
    } else {
      handleClipEnd(slotClip); // último segmento → cut p/ próximo clipe + avança fluxo
    }
  };

  // Watchdog — recover a stalled active video (e.g. inside OBS Browser Source).
  useEffect(() => {
    const interval = window.setInterval(() => {
      const element = refs[activeSlotRef.current].current;
      if (element && element.paused && !element.ended && element.readyState >= 2) {
        void element.play().catch(() => undefined);
      }
    }, 1500);
    return () => window.clearInterval(interval);
  }, [refs]);

  // Trilha/efeito sonoro do clipe ativo (Fase 4). Assinatura estável evita
  // reiniciar o áudio a cada render (o clip é recriado por applyVideoEdit).
  const trackSig = clip
    ? `${clipKey(clip)}|${clip.audio?.mode ?? ''}|${clip.audio?.trackUrl ?? ''}|${clip.audio?.trackLoop ? 1 : 0}|${clip.audio?.volume ?? 1}`
    : 'none';
  useEffect(() => {
    const a = trackAudioRef.current;
    if (!a) return;
    const mode = clip?.audio?.mode;
    const url = clip?.audio?.trackUrl;
    if (clip && mode === 'track' && url) {
      if (a.getAttribute('src') !== url) a.src = url;
      a.loop = Boolean(clip.audio?.trackLoop);
      a.volume = Math.max(0, Math.min(1, clip.audio?.volume ?? 1));
      try { a.currentTime = 0; } catch { /* pré-metadata */ }
      void a.play().catch(() => undefined);
    } else {
      a.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSig]);

  // Limpa o progresso publicado ao desmontar / quando este player deixa de ser o principal.
  useEffect(() => {
    if (!shouldPublishProgress) return;
    return () => publishProgress(null);
  }, [shouldPublishProgress]);

  // Pausa a trilha ao desmontar o player.
  useEffect(() => () => trackAudioRef.current?.pause(), []);

  // Registra a captura do frame ativo para o pipeline de geração de vídeo.
  useEffect(() => {
    registerFrameCapture(() => {
      const element = refs[activeSlotRef.current].current;
      return Promise.resolve(captureVideoFrame(element));
    });
    return () => unregisterFrameCapture();
  }, [refs]);

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-black', className)}>
      {/* Trilha/efeito sonoro do clipe (Fase 4) — fora da tela, áudio apenas. */}
      <audio ref={trackAudioRef} preload="auto" />
      {[0, 1].map((index) => (
        <video
          key={index}
          ref={refs[index]}
          muted
          playsInline
          disablePictureInPicture
          preload="auto"
          onTimeUpdate={(event) => handleProgress(index as 0 | 1, event.currentTarget)}
          onEnded={(event) => {
            if (!event.currentTarget.loop) handleClipEnd(slotClipRef.current[index]);
          }}
          onError={() => {
            // O erro nativo já foi suprimido do console pelo guard em
            // loadSlot pra IDs desconhecidos; isto cobre o caso de um ID
            // válido cujo arquivo sumiu do disco no backend.
            console.debug('[VIDEO_DEBUG] video_element_error', {
              slot: index,
              clip: slotClipRef.current[index]?.videoId,
            });
          }}
          // Crossfade: o clip que entra sobe por cima (z-2) e faz fade-in; o que
          // sai fica opaco por baixo e só some depois do fade (delay = fadeMs).
          style={{
            opacity: activeSlot === index ? 1 : 0,
            zIndex: activeSlot === index ? 2 : 1,
            transition:
              activeSlot === index
                ? `opacity ${fadeMs}ms ease-in-out`
                : `opacity 0ms linear ${fadeMs}ms`,
          }}
          className={cn(
            'absolute inset-0 h-full w-full',
            fit === 'contain' ? 'object-contain' : 'object-cover',
          )}
        />
      ))}
      {!clip && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-500">
          <Play className="mb-3 h-12 w-12 opacity-20" />
          <p className="text-sm font-medium uppercase tracking-widest">Sem sinal de video</p>
          <p className="mt-1 text-xs opacity-50">Aguardando configuracao ou backend</p>
        </div>
      )}
      {showLabel && clip && (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg bg-black/60 px-2 py-1 text-[10px] font-mono text-white/45">
          {clipDisplayName(clip, videos)} | {formatClipTime(clip.startSec)} {'->'} {formatClipTime(clip.endSec)}
        </div>
      )}
    </div>
  );
}

function StagePanel({
  runtime,
  capturedText,
  view,
  videoState,
  obsSettingsFromApp,
  onRefresh,
  onPlayVideoById,
  onOpenEditor,
}: {
  runtime: AutopilotRuntimeState;
  capturedText: CapturedMessage[];
  view: HomeViewData;
  videoState: VideoState | null;
  obsSettingsFromApp?: Record<string, unknown> | null;
  onRefresh: () => void;
  onPlayVideoById: (videoId: string, reason?: string) => Promise<unknown>;
  onOpenEditor: (videoId: string, label?: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [triggering, setTriggering] = useState(false);
  const [obsBusy, setObsBusy] = useState('');
  const toast = useToast();
  const [isFullscreen, setIsFullscreen] = useState(false);

  const runRoutedCommand = async (label: string, fn: () => Promise<CommandResult>) => {
    setObsBusy(label);
    try {
      const result = await fn();
      if (result.ok) toast.success(`${label}: concluído`);
      else toast.error(`${label}: ${result.error}`);
      onRefresh();
    } catch (err) {
      toast.error(`${label}: ${err instanceof Error ? err.message : 'falha'}`);
    } finally {
      setObsBusy('');
    }
  };

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const forceVideo = useCallback(
    async (videoId: string, label?: string) => {
      if (!videoId) return;
      setTriggering(true);
      try {
        await onPlayVideoById(videoId, 'manual_click');
        toast.info(`No ar: ${label || videoId}`);
      } catch (err) {
        toast.error(`Não foi possível colocar no ar: ${err instanceof Error ? err.message : 'falha'}`);
      } finally {
        setTriggering(false);
      }
    },
    [onPlayVideoById, toast],
  );

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await stageRef.current?.requestFullscreen();
    } catch (err) {
      toast.error(`Tela cheia: ${err instanceof Error ? err.message : 'falha'}`);
    }
  };

  const activeClip =
    (videoState?.currentClip ? applyVideoEdit(videoState.currentClip) : null) ||
    (videoState?.current_video_id
      ? clipFromVideoId(videoState.current_video_id, view.videos)
      : view.idleVideoId
        ? clipFromVideoId(view.idleVideoId, view.videos)
        : null);
  const upcomingClips = Array.isArray(videoState?.upcoming) ? videoState.upcoming : [];
  const activeClipLabel = activeClip ? clipDisplayName(activeClip, view.videos) : 'Sem video selecionado';

  const advanceVideo = async () => {
    await advanceReactiveFlow(videoState ?? null);
    onRefresh();
  };

  const deckGroups = useMemo(
    () =>
      groupDeckVideos(
        view.videos.map((video) => ({
          id: video.id,
          label: videoLabel(video),
          loop: video.loop,
          thumbSrc: video.src || video.url || apiUrl(`/api/video/play/${video.id}`),
          edited: hasVideoEdit(video.id),
        })),
      ),
    [view.videos],
  );
  const deckFlat = useMemo(() => deckOrder(deckGroups), [deckGroups]);

  const backToIdle = useCallback(() => {
    if (!view.idleVideoId) {
      toast.warning('Esta persona não tem um vídeo idle definido.');
      return;
    }
    void forceVideo(view.idleVideoId, 'Idle');
  }, [view.idleVideoId, forceVideo, toast]);

  // Atalhos: 1-9 = pad do deck, Esc Esc = voltar ao idle, F = tela cheia.
  const lastEscRef = useRef(0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^[1-9]$/.test(event.key)) {
        const video = deckFlat[Number(event.key) - 1];
        if (video) void forceVideo(video.id, video.label);
        return;
      }
      if (event.key === 'Escape') {
        const now = Date.now();
        if (now - lastEscRef.current < 600) backToIdle();
        lastEscRef.current = now;
        return;
      }
      if (event.key.toLowerCase() === 'f') void toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckFlat, forceVideo, backToIdle]);

  const signals: Signal[] = [
    {
      id: 'obs',
      label: 'OBS',
      status: runtime.obsError ? 'error' : runtime.currentObsScene ? 'online' : 'warn',
      detail: runtime.obsError || runtime.currentObsScene || 'sem cena',
    },
    {
      id: 'video',
      label: 'Vídeo',
      status: runtime.videoMonitor.error ? 'error' : videoState ? 'online' : 'warn',
      detail: runtime.videoMonitor.error || `${videoState?.queue_len ?? 0} na fila`,
    },
    {
      id: 'ia',
      label: 'IA',
      status: runtime.health ? (runtime.lastError ? 'warn' : 'online') : 'warn',
      detail: runtime.lastError || undefined,
    },
    {
      id: 'diretora',
      label: 'Diretora',
      status: runtime.autopilotEnabled ? 'online' : 'idle',
      detail: runtime.autopilotEnabled ? runtime.autonomyLevel : 'pausada',
    },
    {
      id: 'voz',
      label: 'Voz',
      status: runtime.voiceEnabled ? 'online' : 'idle',
      detail: runtime.voiceEnabled ? 'ligada' : 'desligada',
    },
  ];

  if (isFullscreen) {
    return (
      <div ref={stageRef} className="flex h-screen w-screen items-center justify-center overflow-hidden bg-black">
        <div className="relative aspect-[9/16] h-full max-h-screen max-w-full bg-black">
          <ContinuityPlayer
            clip={activeClip}
            nextClip={videoState?.nextClip ? applyVideoEdit(videoState.nextClip) : null}
            videos={view.videos}
            onEnded={advanceVideo}
            fit="contain"
            showLabel={false}
            className="h-full w-full"
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={stageRef} className="odsa-stage2 flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-1">
      {/* Sinais vitais + comandos de transmissão */}
      <div className="odessa-panel-surface flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <SignalStrip signals={signals} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {runtime.obsScenes.length > 0 && (
            <select
              aria-label="Cena do OBS"
              value={runtime.currentObsScene ?? ''}
              disabled={!!obsBusy}
              onChange={(e) => void runRoutedCommand(`Cena ${e.target.value}`, () => routeSwitchScene(e.target.value))}
              className="h-8 rounded-full border border-[var(--border2)] bg-[var(--bg3)] px-3 text-xs text-[var(--t1)] outline-none focus:border-[var(--sky)]"
            >
              {!runtime.currentObsScene && <option value="">Cena…</option>}
              {runtime.obsScenes.map((scene) => (
                <option key={scene} value={scene}>{scene}</option>
              ))}
            </select>
          )}
          <Button size="sm" variant={runtime.voiceEnabled ? 'success' : 'secondary'} onClick={runtime.toggleVoice} aria-pressed={runtime.voiceEnabled}>
            {runtime.voiceEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            Voz {runtime.voiceEnabled ? 'ligada' : 'off'}
          </Button>
          <Button size="sm" variant="secondary" disabled={!!obsBusy} onClick={() => void runRoutedCommand('Preparar mesa OBS', () => routeSetupLiveScene(obsSettingsFromApp as never))}>
            <Upload className="h-3.5 w-3.5" /> Preparar OBS
          </Button>
          <ConfirmButton size="sm" variant="primary" confirmLabel="Confirmar transmissão?" disabled={!!obsBusy} onConfirm={() => runRoutedCommand('Iniciar transmissão', () => routeStartTransmission(obsSettingsFromApp as never))}>
            <RadioTower className="h-3.5 w-3.5" /> Transmitir
          </ConfirmButton>
          <Button size="sm" variant="secondary" onClick={() => void toggleFullscreen()} title="Tela cheia (F)" aria-label="Tela cheia">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)_minmax(260px,320px)]">
        {/* Programa */}
        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-2xl border border-[var(--sky)]/40 bg-black shadow-[var(--shadow-live)]" style={{ aspectRatio: '9 / 16', maxHeight: 560 }}>
            <ContinuityPlayer clip={activeClip} nextClip={videoState?.nextClip ? applyVideoEdit(videoState.nextClip) : null} videos={view.videos} onEnded={advanceVideo} fit="contain" className="h-full w-full" publishProgress />
            <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
              <span className={cn('h-1.5 w-1.5 rounded-full', runtime.autopilotEnabled ? 'animate-pulse bg-red-500' : 'bg-[var(--t3)]')} />
              No ar
            </div>
          </div>

          <div className="odessa-panel-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--t1)]">{activeClipLabel}</div>
                <div className="truncate text-[11px] text-[var(--t3)]">
                  {(activeClip?.segments?.length || 0) > 0 ? `${activeClip?.segments?.length} cortes` : 'sem corte'} · áudio {activeClip?.audio?.mode || 'mudo'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="icon" variant="secondary" title="Repetir" aria-label="Repetir clip" onClick={() => { if (activeClip?.videoId) void forceVideo(activeClip.videoId, activeClipLabel); }}>
                  <Rewind className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="secondary" title="Próximo" aria-label="Próximo clip" onClick={() => void advanceVideo()}>
                  <FastForward className="h-3.5 w-3.5" />
                </Button>
                {activeClip?.videoId && (
                  <Button size="icon" variant="secondary" title="Editar cortes" aria-label="Editar cortes" onClick={() => onOpenEditor(activeClip.videoId, activeClipLabel)}>
                    <Scissors className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <ClipProgress
              videoId={activeClip?.videoId}
              nextLabel={upcomingClips[0] ? clipDisplayName(upcomingClips[0], view.videos) : null}
            />
            <div className="mt-3 flex items-center gap-2">
              <VolumeX className="h-3.5 w-3.5 shrink-0 text-[var(--t3)]" />
              <input
                type="range"
                min={0}
                max={100}
                aria-label="Volume do clip no ar"
                value={Math.round((activeClip?.audio?.volume ?? 1) * 100)}
                onChange={(e) => {
                  if (!activeClip?.videoId) return;
                  const cur = getVideoEdit(activeClip.videoId) ?? defaultVideoEdit(activeClip.videoId);
                  saveVideoEdit({ ...cur, volume: Number(e.target.value) / 100 });
                  onRefresh();
                }}
                className="flex-1 accent-[var(--sky)]"
              />
              <span className="w-9 shrink-0 text-right font-mono text-[11px] text-[var(--t3)]">{Math.round((activeClip?.audio?.volume ?? 1) * 100)}%</span>
            </div>
            <Button size="sm" variant="danger" className="mt-3 w-full" onClick={backToIdle} title="Esc duas vezes">
              Voltar ao Idle
            </Button>
          </div>
        </div>

        {/* Deck de clips */}
        <div className="odessa-panel-surface min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--t3)]">Deck de clips</div>
            <div className="text-[10px] text-[var(--t3)]">
              clique ou teclas <kbd className="rounded bg-[var(--bg4)] px-1 font-mono">1</kbd>–<kbd className="rounded bg-[var(--bg4)] px-1 font-mono">9</kbd> = no ar
            </div>
          </div>
          <ClipDeck
            groups={deckGroups}
            activeVideoId={activeClip?.videoId}
            busy={triggering}
            onPlay={(id) => {
              const video = deckFlat.find((item) => item.id === id);
              void forceVideo(id, video?.label);
            }}
            onEdit={onOpenEditor}
          />
        </div>

        {/* Fila + rádio de eventos */}
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2 xl:col-span-1">
          <div className="odessa-panel-surface p-4">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--t3)]">A seguir na fila</div>
            {upcomingClips.length === 0 ? (
              <div className="text-xs text-[var(--t3)]">Nada enfileirado. A Diretora enfileira reações automaticamente.</div>
            ) : (
              <ol className="space-y-2">
                {upcomingClips.slice(0, 5).map((clip, i) => (
                  <li key={`${clip.videoId}-${i}`} className="flex items-center gap-2.5 text-xs">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[var(--bg4)] font-mono text-[10px] text-[var(--t2)]">{i + 1}</span>
                    <span className="truncate text-[var(--t1)]">{clipDisplayName(clip, view.videos)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="odessa-panel-surface min-h-0 flex-1 p-4">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--t3)]">Eventos ao vivo</div>
            <div className="max-h-[420px] overflow-y-auto pr-1">
              <EventRadio events={capturedText} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VideoLibraryPanel({
  config,
  onChanged,
  onOpenEditor,
}: {
  config: PersonaConfig | null;
  onChanged: () => void;
  onOpenEditor: (videoId: string, label?: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadBatch, setUploadBatch] = useState<
    Array<{ name: string; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string }>
  >([]);
  const videos = config?.videos || [];

  // Filtro por persona (ativa/todas) e por categoria (roteiro de vídeos). O
  // modo padrão ("ativa") continua usando exatamente `config.videos` de
  // hoje — só "todas" busca o agregador novo, pra não arriscar regressão.
  const [personaFilter, setPersonaFilter] = useState<'active' | 'all'>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [libraryVideos, setLibraryVideos] = useState<VideoEntry[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  useEffect(() => {
    listPersonas()
      .then((res) => setActivePersonaId(res.activePersonaId))
      .catch(() => undefined);
  }, []);

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const res = await fetch(apiUrl('/video/library'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { videos?: VideoEntry[] };
      setLibraryVideos(Array.isArray(data.videos) ? data.videos : []);
    } catch {
      setLibraryVideos([]);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (personaFilter === 'all') void refreshLibrary();
  }, [personaFilter, refreshLibrary]);

  const sourceVideos = personaFilter === 'all' ? libraryVideos : videos;
  const displayedVideos =
    categoryFilter === 'all' ? sourceVideos : sourceVideos.filter((v) => categorizeVideo(v) === categoryFilter);

  const uploadSummary = useMemo(
    () =>
      uploadBatch.reduce(
        (acc, item) => {
          if (item.status === 'done') acc.sent++;
          else if (item.status === 'error') acc.failed++;
          else if (item.status === 'pending' || item.status === 'uploading') acc.pending++;
          return acc;
        },
        { sent: 0, failed: 0, pending: 0 },
      ),
    [uploadBatch],
  );

  const uploadOne = (file: File, index: number, total: number) =>
    new Promise<void>((resolve, reject) => {
      const body = new FormData();
      body.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl('/video/upload'));
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const fileProgress = event.loaded / event.total;
        setUploadProgress(Math.round(((index + fileProgress) / total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        reject(new Error(`HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Falha de rede'));
      xhr.send(body);
    });

  const upload = async (fileList?: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadBatch(files.map((file) => ({ name: file.name, status: 'pending' })));
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadBatch((current) =>
          current.map((item) =>
            item.name === file.name ? { ...item, status: 'uploading' } : item,
          ),
        );
        try {
          await uploadOne(file, index, files.length);
          setUploadBatch((current) =>
            current.map((item) => (item.name === file.name ? { ...item, status: 'done' } : item)),
          );
        } catch (err) {
          setUploadBatch((current) =>
            current.map((item) =>
              item.name === file.name
                ? {
                    ...item,
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Falha no upload',
                  }
                : item,
            ),
          );
        }
      }
      setUploadProgress(100);
      onChanged();
      if (personaFilter === 'all') void refreshLibrary();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const forceVideo = async (videoId: string) => {
    await fetch(apiUrl('/video/force'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    }).catch(() => undefined);
  };

  const archiveVideo = async (videoId: string) => {
    await fetch(apiUrl(`/video/${encodeURIComponent(videoId)}/archive`), { method: 'POST' }).catch(() => undefined);
    onChanged();
    if (personaFilter === 'all') void refreshLibrary();
  };

  const setIdle = async (videoId: string) => {
    if (!config) return;
    const nextConfig = {
      ...config,
      idleVideoId: videoId,
      videos: config.videos.map((video) => ({
        ...video,
        loop: video.id === videoId ? true : video.loop,
      })),
      action_map: { ...(config.action_map || {}), idle: [videoId] },
    };
    await fetch(apiUrl('/video/config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextConfig),
    });
    onChanged();
    if (personaFilter === 'all') void refreshLibrary();
  };

  return (
    <div className="h-full overflow-y-auto p-5 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 rounded-[34px] border border-white/10 bg-[#101114] p-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-200/70">
            Biblioteca
          </div>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-white">
            Videos da mesa de direcao
          </h1>
          <p className="mt-1 text-sm text-[var(--t3)]">
            Clipes usados pelo Idle, reacoes, loops e gatilhos OCR.
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm"
            multiple
            className="hidden"
            onChange={(event) => upload(event.target.files)}
          />
          <Button variant="primary" loading={uploading} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" />
            Adicionar videos
          </Button>
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-3 rounded-[28px] border border-white/10 bg-[#101114] p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-[var(--t3)]" />
          <Tabs
            size="sm"
            value={personaFilter}
            onChange={(id) => setPersonaFilter(id as 'active' | 'all')}
            items={[
              { id: 'active', label: 'Persona ativa' },
              { id: 'all', label: 'Todas as personas' },
            ]}
          />
          {personaFilter === 'all' && libraryLoading && (
            <span className="text-[11px] text-[var(--t3)]">Carregando...</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition',
              categoryFilter === 'all'
                ? 'border-sky-300/40 bg-sky-300/15 text-sky-200'
                : 'border-white/10 text-[var(--t3)] hover:text-white',
            )}
          >
            Todas categorias
          </button>
          {VIDEO_ROTEIRO.map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setCategoryFilter(cat.key)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition',
                categoryFilter === cat.key
                  ? 'border-sky-300/40 bg-sky-300/15 text-sky-200'
                  : 'border-white/10 text-[var(--t3)] hover:text-white',
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {uploading || uploadBatch.length > 0 ? (
        <div className="mb-5 rounded-[28px] border border-sky-200/20 bg-sky-300/10 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">
                {uploading ? 'Enviando videos' : 'Upload concluido'}
              </div>
              <div className="text-xs text-slate-400">
                {uploadSummary.sent} enviados, {uploadSummary.failed} falharam,{' '}
                {uploadSummary.pending} pendentes
              </div>
            </div>
            <Badge variant={uploadSummary.failed > 0 ? 'warning' : 'gold'}>{uploadProgress}%</Badge>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/45">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-300 to-lime-300 transition-all"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {uploadBatch.map((item) => (
              <div
                key={item.name}
                className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-white">{item.name}</span>
                  <span
                    className={cn(
                      'text-[10px] font-semibold uppercase tracking-widest',
                      item.status === 'done' && 'text-lime-300',
                      item.status === 'uploading' && 'text-sky-300',
                      item.status === 'error' && 'text-rose-300',
                      item.status === 'pending' && 'text-slate-500',
                    )}
                  >
                    {item.status}
                  </span>
                </div>
                {item.error && (
                  <div className="mt-1 truncate text-[10px] text-rose-300">{item.error}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {displayedVideos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Film className="mb-4 h-12 w-12 text-[var(--t3)]" />
          <p className="text-sm font-semibold text-[var(--t1)]">Nenhum video encontrado</p>
          <p className="mt-1 text-xs text-[var(--t3)]">
            {personaFilter === 'all' || categoryFilter !== 'all'
              ? 'Ajuste os filtros de persona/categoria acima.'
              : 'Clique em "Adicionar videos" para fazer upload'}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {displayedVideos.map((video) => {
          // No modo "todas as personas", Preview/Idle/Excluir escrevem no
          // config da PERSONA ATIVA — errado pra um vídeo de outra persona.
          // "Editar" fica sempre liberado: é 100% localStorage, sem essa
          // amarração (ver videoEdits.ts).
          const isForeign =
            personaFilter === 'all' && Boolean(video.personaId) && video.personaId !== activePersonaId;
          return (
            <Card key={`${video.personaId || 'active'}-${video.id}`} className="overflow-hidden bg-[#101114]">
              <div className="aspect-video bg-black">
                <video
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-contain"
                  src={apiUrl(`/api/video/play/${video.id}`)}
                  onError={() => console.debug('[VIDEO_DEBUG] thumbnail_error', { videoId: video.id })}
                />
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{videoLabel(video)}</div>
                    <div className="truncate text-xs text-[var(--t3)]">{video.group || video.id}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {video.loop && <Badge variant="gold">Idle</Badge>}
                    {personaFilter === 'all' && video.personaName && (
                      <Badge variant={isForeign ? 'default' : 'success'}>{video.personaName}</Badge>
                    )}
                  </div>
                </div>
                <div className="mt-3 line-clamp-2 text-xs text-[var(--t3)]">
                  {video.description || 'Video registrado na Odessa.'}
                </div>
                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isForeign}
                    title={isForeign ? 'Só disponível pra persona ativa' : undefined}
                    onClick={() => forceVideo(video.id)}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Preview
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => onOpenEditor(video.id, videoLabel(video))}>
                    <Scissors className="h-3.5 w-3.5" />
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isForeign}
                    title={isForeign ? 'Só disponível pra persona ativa' : undefined}
                    onClick={() => setIdle(video.id)}
                  >
                    Idle
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={isForeign}
                    title={isForeign ? 'Só disponível pra persona ativa' : undefined}
                    onClick={() => archiveVideo(video.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

