import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  Brain,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  FastForward,
  Film,
  History,
  Link2,
  ListVideo,
  Maximize2,
  Pause,
  Play,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Rewind,
  Save,
  Settings,
  ShieldAlert,
  Scissors,
  Trash2,
  Upload,
  VolumeX,
} from 'lucide-react';
import { emitEvent } from './core/eventBus';
import { registerFrameCapture, unregisterFrameCapture, captureVideoFrame } from './core/frameCapture';
import { apiUrl } from './lib/api';
import {
  routeSetupLiveScene,
  routeStartTransmission,
  type CommandResult,
} from './lib/obsCommandRouter';
import { cn } from './lib/utils';
import type { AutopilotRuntimeState } from './core/useAutopilotRuntime';
import type { AuditTimelineEntry, AutopilotCycle, CapturedMessage } from './types';
import { Badge, Button, Card, Input, StatusDot } from './components/ui';
import { AiConfigPanel } from './components/AiConfigPanel';
import PersonaSelector from './components/PersonaSelector';
import { TangoChatPanel } from './components/TangoChatPanel';
import { SessionHistoryPanel } from './components/SessionHistoryPanel';
import VideoEditor from './components/VideoEditor';
import { StatusBadge, deriveStageStatus } from './components/StatusBadge';

import { applyVideoEdit, getVideoEdit, saveVideoEdit, defaultVideoEdit, type VideoSegment } from './core/videoEdits';
import { getAiConfig, hasActiveGeminiKey, type AiAutonomyLevel } from './core/aiConfig';
import { globalMoodEngine } from './core/moodEngine';

const CaptureStudio = lazy(() => import('./CaptureStudio'));
const ReactiveFlowBoard = lazy(() => import('./ReactiveFlowBoard'));
const PlanningCanvas = lazy(() => import('./PlanningCanvas'));
// VideoEditor é importado de forma normal (não-lazy): no Palco o stream de vídeo
// ao vivo segura conexões HTTP/1.1 e o chunk lazy ficava "pending" para sempre.

// ─── Gift detection ───────────────────────────────────────────────────────────
// isGiftEvent is imported from ocrPipeline — single source of truth.

export type AdvancedPanel =
  | 'overview'
  | 'capture'
  | 'persona'
  | 'content'
  | 'runtime'
  | 'settings'
  | 'overlay'
  | 'canvas';

type LiveConfig = {
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
  onStartLive?: () => void | Promise<void>;
  obsSettingsFromApp?: Record<string, unknown> | null;
  onObsSettingsChanged?: (settings: Record<string, unknown>) => void;
}

type TabKey =
  | 'live'
  | 'library'
  | 'flow'
  | 'history'
  | 'settings'
  | 'home'
  | 'stage'
  | 'ai'
  | 'chat'
  | 'canvas'
  | 'sources'
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

type VideoState = {
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

type LivePlanStep = {
  id: string;
  label: string;
  enabled: boolean;
  mode: 'simulated' | 'approval_required' | 'real';
  description?: string;
  status?: 'ready' | 'blocked' | 'warning';
};

type LivePlan = {
  ok?: boolean;
  dryRun?: boolean;
  actionMode?: LiveConfig['actionMode'];
  settings?: Record<string, unknown>;
  steps?: LivePlanStep[];
  risks?: string[];
  health?: ObsHealthResult | null;
  error?: string | null;
};

type AutomationLogEntry = {
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

type ObsSettings = {
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

type ObsConnectionFields = {
  host: string;
  port: string;
  authenticationEnabled: boolean;
};

type WorkspaceSettings = {
  apiBudgetMode: 'economico' | 'normal' | 'agressivo';
  automationMode: 'manual' | 'assistido' | 'automatico';
  errorReports: boolean;
  telemetry: boolean;
};

type ObsHealthResult = {
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

type WebhookConfig = {
  id: string;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  enabled: boolean;
  timeoutMs: number;
  bodyTemplate: string;
};

type WebhookDraft = Omit<WebhookConfig, 'id'> & { id?: string };

type ReactiveRunResult = {
  input: string;
  source: string;
  createdAt: string;
  test: AutomationTestResponse;
  executions: AutomationExecutionResponse[];
};

function tabFromPanel(panel: AdvancedPanel): TabKey {
  if (panel === 'capture') return 'settings';
  if (panel === 'content') return 'library';
  if (panel === 'runtime') return 'flow';
  if (panel === 'settings') return 'settings';
  if (panel === 'canvas') return 'settings';
  if (panel === 'persona') return 'settings';
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

function textValue(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
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
  onStartLive,
  obsSettingsFromApp = null,
  onObsSettingsChanged,
}: OdessaLiveCenterProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(() => tabFromPanel(requestedPanel));
  const [settingsSubTab, setSettingsSubTab] = useState<'general' | 'ai' | 'ocr' | 'canvas'>('general');
  const [flowSubTab, setFlowSubTab] = useState<'board' | 'logs'>('board');
  const [liveMode, setLiveMode] = useState<'central' | 'stage' | 'overview'>('central');
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
        console.warn('[VIDEO_ERROR] no_videos_found_in_library');
      }
      setConfigError(null);
    } catch (err) {
      console.error('[VIDEO_ERROR] backend_offline_or_invalid_config', err);
      setConfigError(err instanceof Error ? err.message : 'Backend indisponivel');
    }
  }, []);

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
      else if (requestedPanel === 'capture') setSettingsSubTab('ocr');
      else if (requestedPanel === 'persona') setSettingsSubTab('ai');
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
      console.error('[VIDEO_ERROR] playback_failed', err);
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
            <SideNavButton
              icon={<RadioTower />}
              label="Ao Vivo"
              active={activeTab === 'live' || activeTab === 'chat' || activeTab === 'home' || activeTab === 'stage'}
              onClick={() => setActiveTab('live')}
            />
            <SideNavButton
              icon={<Film />}
              label="Biblioteca"
              active={activeTab === 'library'}
              onClick={() => setActiveTab('library')}
            />
            <SideNavButton
              icon={<Link2 />}
              label="Automações"
              active={activeTab === 'flow' || activeTab === 'logs'}
              onClick={() => setActiveTab('flow')}
            />
            <SideNavButton
              icon={<History />}
              label="Histórico"
              active={activeTab === 'history'}
              onClick={() => setActiveTab('history')}
            />
            <SideNavButton
              icon={<Settings />}
              label="Configurações"
              active={activeTab === 'settings' || activeTab === 'ai' || activeTab === 'canvas' || activeTab === 'sources'}
              onClick={() => setActiveTab('settings')}
            />
          </div>
        </nav>

        <DirectorStatusCard runtime={runtime} onOpen={() => { setActiveTab('settings'); setSettingsSubTab('ai'); }} />
      </aside>

      {/* Coluna principal: topbar + conteúdo */}
      <div className="odsa-main flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="odsa-topbar">
          <div className="odsa-topbar-title">
            <span className="odsa-crumb">{TAB_META[activeTab].group}</span>
            <h1>{TAB_META[activeTab].title}</h1>
          </div>

        {/* Right side: status + CTA */}
        <div className="odsa-header-end">
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
              if (runtime.autopilotEnabled) { runtime.pause(); return; }
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
          <div className="odsa-toast">
            {liveStartError}
          </div>
        )}
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-1.5 lg:hidden" style={{ background: 'rgba(6,7,10,0.86)', backdropFilter: 'blur(20px)' }}>
        {([
          { id: 'live', label: 'Ao Vivo' },
          { id: 'library', label: 'Biblioteca' },
          { id: 'flow', label: 'Automações' },
          { id: 'history', label: 'Histórico' },
          { id: 'settings', label: 'Configurações' },
        ] as { id: TabKey; label: string }[]).map(({ id, label }) => {
          const isActive =
            activeTab === id ||
            (id === 'live' && (activeTab === 'chat' || activeTab === 'home' || activeTab === 'stage')) ||
            (id === 'flow' && activeTab === 'logs') ||
            (id === 'settings' && (activeTab === 'ai' || activeTab === 'canvas' || activeTab === 'sources'));
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

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 1. AO VIVO (Central da Live + Palco / Visão Geral) */}
        {(activeTab === 'live' || activeTab === 'chat' || activeTab === 'home' || activeTab === 'stage') && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/5 bg-black/40 px-4 py-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setLiveMode('central')}
                  className={cn('rounded-lg px-2.5 py-1 font-semibold transition', liveMode === 'central' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white')}
                >
                  Central da Live
                </button>
                <button
                  onClick={() => setLiveMode('stage')}
                  className={cn('rounded-lg px-2.5 py-1 font-semibold transition', liveMode === 'stage' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white')}
                >
                  Palco OBS
                </button>
                <button
                  onClick={() => setLiveMode('overview')}
                  className={cn('rounded-lg px-2.5 py-1 font-semibold transition', liveMode === 'overview' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white')}
                >
                  Visão Geral
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
              {liveMode === 'central' && (
                <TangoChatPanel
                  capturedText={capturedText}
                  runtime={runtime}
                  videoState={videoState}
                  onStartLive={onStartLive}
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
                />
              )}
              {liveMode === 'overview' && (
                <HomeDashboard
                  capturedText={capturedText}
                  runtime={runtime}
                  videoState={videoState}
                  view={view}
                  go={(tab) => {
                    if (tab === 'chat' || tab === 'stage' || tab === 'home' || tab === 'live') {
                      setActiveTab('live');
                      setLiveMode(tab === 'stage' ? 'stage' : 'central');
                    } else {
                      setActiveTab(tab);
                    }
                  }}
                  onRefresh={refreshVideoState}
                />
              )}
            </div>
          </div>
        )}

        {/* 2. BIBLIOTECA */}
        {activeTab === 'library' && <VideoLibraryPanel config={config} onChanged={loadConfig} />}

        {/* 3. AUTOMAÇÕES (Fluxo Reativo + Logs) */}
        {(activeTab === 'flow' || activeTab === 'logs') && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/5 bg-black/40 px-4 py-1.5 text-xs">
              <button
                onClick={() => setFlowSubTab('board')}
                className={cn('rounded-lg px-2.5 py-1 font-semibold transition', flowSubTab === 'board' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white')}
              >
                Fluxo Reativo
              </button>
              <button
                onClick={() => setFlowSubTab('logs')}
                className={cn('rounded-lg px-2.5 py-1 font-semibold transition', flowSubTab === 'logs' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white')}
              >
                Logs de Automação
              </button>
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
              </PageSurface>
            )}
          </div>
        )}

        {/* 4. HISTÓRICO */}
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

        {/* 5. CONFIGURAÇÕES (OBS, IA, Mural, OCR) */}
        {(activeTab === 'settings' || activeTab === 'ai' || activeTab === 'canvas' || activeTab === 'sources') && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/5 bg-black/40 px-4 py-1.5 text-xs">
              <button
                onClick={() => setSettingsSubTab('general')}
                className={cn('rounded-lg px-2.5 py-1 font-semibold transition', settingsSubTab === 'general' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white')}
              >
                OBS & Webhooks
              </button>
              <button
                onClick={() => setSettingsSubTab('ai')}
                className={cn('rounded-lg px-2.5 py-1 font-semibold transition', settingsSubTab === 'ai' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white')}
              >
                Diretora IA & Persona
              </button>
              <button
                onClick={() => setSettingsSubTab('canvas')}
                className={cn('rounded-lg px-2.5 py-1 font-semibold transition', settingsSubTab === 'canvas' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white')}
              >
                Mural de Planejamento
              </button>
              <button
                onClick={() => setSettingsSubTab('ocr')}
                className={cn('rounded-lg px-2.5 py-1 font-semibold transition', settingsSubTab === 'ocr' ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white')}
              >
                Fontes & OCR
              </button>
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
                  <PersonaSelector />
                  <div className="mt-4">
                    <AiConfigPanel />
                  </div>
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

        {/*
          CaptureStudio stays mounted on every tab so screen capture / OCR
          keeps running when the user navigates away from "Fontes / OCR".
          When inactive it is moved off-screen (NOT display:none) so the
          <video> element keeps decoding frames for the OCR pipeline.
        */}
        <div
          className={cn(
            'flex min-h-0 flex-col',
            (activeTab === 'sources' || (activeTab === 'settings' && settingsSubTab === 'ocr'))
              ? 'flex-1'
              : 'pointer-events-none fixed -left-[9999px] top-0 h-px w-px overflow-hidden opacity-0',
          )}
          aria-hidden={!(activeTab === 'sources' || (activeTab === 'settings' && settingsSubTab === 'ocr'))}
        >
          <PageSurface
            icon={<Camera className="h-4 w-4" />}
            title="Fontes e OCR"
            description="Calibre captura, texto bruto, eventos parseados e testes manuais no mesmo console visual."
          >
            <Suspense fallback={<PanelLoading label="Carregando fontes OCR" />}>
              <CaptureStudio
                capturedText={capturedText}
                setCapturedText={setCapturedText}
                autopilotEnabled={runtime.autopilotEnabled}
                pendingAutopilotEvents={runtime.pendingEvents.length}
                latestAutopilotActionStatus={runtime.latestAction?.status}
                onStartAutopilot={runtime.start}
              />
            </Suspense>
          </PageSurface>
        </div>
      </section>
      </div>
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
      <div className="mb-4 shrink-0 rounded-[34px] border border-white/10 bg-[#101114] p-5">
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

const DEFAULT_OBS_SETTINGS: ObsSettings = {
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

const WORKSPACE_SETTINGS_KEY = 'odessa:workspace-settings:v1';

const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  apiBudgetMode: 'normal',
  automationMode: 'assistido',
  errorReports: true,
  telemetry: false,
};

function normalizeObsSettings(settings?: Partial<ObsSettings>): ObsSettings {
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

function loadWorkspaceSettings(): WorkspaceSettings {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_SETTINGS;
  try {
    const stored = window.localStorage.getItem(WORKSPACE_SETTINGS_KEY);
    if (!stored) return DEFAULT_WORKSPACE_SETTINGS;
    return { ...DEFAULT_WORKSPACE_SETTINGS, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_WORKSPACE_SETTINGS;
  }
}

function parseObsConnection(settings: ObsSettings): ObsConnectionFields {
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

function buildObsWebsocketUrl(connection: ObsConnectionFields) {
  const host = connection.host.trim().replace(/^wss?:\/\//i, '').replace(/\/.*$/, '') || 'localhost';
  const port = String(connection.port || '4455').replace(/\D/g, '') || '4455';
  return `ws://${host}:${port}`;
}

const EMPTY_WEBHOOK_DRAFT: WebhookDraft = {
  name: 'Novo webhook',
  url: '',
  method: 'POST',
  headers: {},
  enabled: true,
  timeoutMs: 2500,
  bodyTemplate:
    '{\n  "product": "Odessa",\n  "event": "{event.text}",\n  "action": "{action.type}"\n}',
};

function headersToText(headers: Record<string, string>) {
  return Object.entries(headers || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function parseHeadersText(value: string) {
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

function SettingsPanel({
  health,
  onRefreshHealth,
  liveConfig,
  onLiveConfigChange,
  onSaved,
  onObsSettingsChanged,
}: {
  health: AutopilotRuntimeState['health'];
  onRefreshHealth: () => Promise<void>;
  liveConfig: LiveConfig;
  onLiveConfigChange?: Dispatch<SetStateAction<LiveConfig>>;
  onSaved: () => void;
  onObsSettingsChanged?: (settings: Record<string, unknown>) => void;
}) {
  const [obsSettings, setObsSettings] = useState<ObsSettings>(DEFAULT_OBS_SETTINGS);
  const [obsConnection, setObsConnection] = useState<ObsConnectionFields>(() =>
    parseObsConnection(DEFAULT_OBS_SETTINGS),
  );
  const [workspace, setWorkspace] = useState<WorkspaceSettings>(() => loadWorkspaceSettings());
  const [passwordInput, setPasswordInput] = useState('');
  const [obsHealth, setObsHealth] = useState<ObsHealthResult | null>(null);
  const [availableScenes, setAvailableScenes] = useState<string[]>([]);
  const [selectedSceneTest, setSelectedSceneTest] = useState('');
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [webhookDraft, setWebhookDraft] = useState<WebhookDraft>(EMPTY_WEBHOOK_DRAFT);
  const [webhookHeaderText, setWebhookHeaderText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sceneTesting, setSceneTesting] = useState(false);
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [webhookMessage, setWebhookMessage] = useState<string | null>(null);
  const [livePlan, setLivePlan] = useState<LivePlan | null>(null);
  const [livePlanLoading, setLivePlanLoading] = useState(false);
  const [livePlanMessage, setLivePlanMessage] = useState<string | null>(null);
  const [obsProfiles, setObsProfiles] = useState<Array<{ id: string; name: string; updatedAt?: string }>>([]);
  const [obsProfileName, setObsProfileName] = useState('');
  const [activeObsProfileId, setActiveObsProfileId] = useState('');

  const loadObsSettings = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl('/obs/settings'));
      const data = (await response.json()) as {
        ok?: boolean;
        settings?: Partial<ObsSettings>;
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const normalized = normalizeObsSettings(data.settings);
      setObsSettings(normalized);
      setObsConnection(parseObsConnection(normalized));
      setSelectedSceneTest((current) => current || normalized.allowedScenes[0] || '');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao carregar configuracoes do OBS');
    } finally {
      setLoading(false);
    }
  }, []);

  // OBS profiles persisted in localStorage (per-device).
  const OBS_PROFILES_KEY = 'odessa:obs-profiles:v1';

  const readObsProfilesFromStorage = () => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(OBS_PROFILES_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };

  const writeObsProfilesToStorage = (list: typeof obsProfiles) => {
    try { if (typeof window !== 'undefined') window.localStorage.setItem(OBS_PROFILES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  };

  const loadObsProfiles = useCallback(async () => {
    setObsProfiles(readObsProfilesFromStorage());
  }, []);

  const saveObsProfile = async (name: string) => {
    if (!name.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      // Build the snapshot from the LIVE form state (obsConnection holds the
      // host/port the user typed; passwordInput holds a freshly typed password).
      // obsSettings.websocketUrl can be stale until "Salvar OBS" is clicked.
      const snapshot: ObsSettings = {
        ...obsSettings,
        websocketUrl: buildObsWebsocketUrl(obsConnection),
        passwordConfigured: obsConnection.authenticationEnabled,
        websocketPassword: passwordInput.trim() || obsSettings.websocketPassword || '',
      };
      const existing = readObsProfilesFromStorage();
      const existingIdx = existing.findIndex((p) => p.name === name);
      const profile = {
        id: existingIdx >= 0 ? existing[existingIdx].id : `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        settings: snapshot,
        createdAt: existingIdx >= 0 ? existing[existingIdx].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const next = existingIdx >= 0 ? existing.map((p, i) => i === existingIdx ? profile : p) : [...existing, profile];
      writeObsProfilesToStorage(next);
      setObsProfiles(next);
      setActiveObsProfileId(profile.id);
      setObsProfileName('');
      const hasPwd = Boolean(snapshot.websocketPassword);
      setMessage(
        snapshot.passwordConfigured && !hasPwd
          ? `Perfil "${name}" salvo. Dica: digite a senha do OBS antes de salvar para guarda-la no perfil.`
          : `Perfil "${name}" salvo (local).`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao salvar perfil');
    } finally {
      setSaving(false);
    }
  };

  const applyObsProfile = async (id: string) => {
    const profile = readObsProfilesFromStorage().find((p) => p.id === id);
    if (!profile?.settings) {
      setMessage('Perfil nao encontrado.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      // Only fill the form — never reconnect here. Reconnecting with a profile
      // that has no stored password would drop the OBS connection. The user
      // reviews the form and clicks "Salvar OBS" to apply + reconnect safely.
      const normalized = normalizeObsSettings(profile.settings);
      setObsSettings(normalized);
      setObsConnection(parseObsConnection(normalized));
      setActiveObsProfileId(id);
      const storedPwd = (profile.settings as Partial<ObsSettings>).websocketPassword || '';
      if (storedPwd) setPasswordInput(storedPwd);
      setMessage(
        storedPwd
          ? `Perfil "${profile.name}" carregado. Clique em "Salvar OBS" para conectar.`
          : `Perfil "${profile.name}" carregado. Confira a senha do OBS e clique em "Salvar OBS".`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao aplicar perfil');
    } finally {
      setSaving(false);
    }
  };

  const deleteObsProfile = async (id: string) => {
    try {
      const next = readObsProfilesFromStorage().filter((p) => p.id !== id);
      writeObsProfilesToStorage(next);
      setObsProfiles(next);
      if (activeObsProfileId === id) setActiveObsProfileId('');
    } catch { /* ignore */ }
  };

  const loadWebhooks = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/webhooks'));
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        webhooks?: WebhookConfig[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhooks(Array.isArray(data.webhooks) ? data.webhooks : []);
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao carregar webhooks');
    }
  }, []);

  const testObs = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({
        sourceName: obsSettings.chatSourceName || obsSettings.ocrSourceName,
      });
      const response = await fetch(apiUrl(`/obs/health?${query.toString()}`));
      const data = (await response.json()) as ObsHealthResult;
      setObsHealth(data);
      setAvailableScenes(Array.isArray(data.availableScenes) ? data.availableScenes : []);
      if (Array.isArray(data.allowedScenes)) {
        setObsSettings((current) => ({
          ...current,
          sceneWhitelist: data.allowedScenes || current.sceneWhitelist,
          allowedScenes: data.allowedScenes || current.allowedScenes,
        }));
      }
      if (!response.ok || !data.ok) {
        setMessage(data.error || 'OBS/source ainda nao esta pronto para iniciar a live');
        return;
      }
      setMessage('OBS pronto para captura OCR persistente.');
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Falha ao testar OBS';
      setObsHealth({ ok: false, connected: false, sourceReady: false, screenshotReady: false, error });
      setMessage(error);
    } finally {
      setLoading(false);
    }
  }, [obsSettings.chatSourceName, obsSettings.ocrSourceName]);

  const loadLivePlan = useCallback(async () => {
    setLivePlanLoading(true);
    setLivePlanMessage(null);
    try {
      const query = new URLSearchParams({
        voiceEnabled: String(!!liveConfig.voiceEnabled),
        enableChat: String(!!liveConfig.enableChat),
        prepareObs: String(liveConfig.prepareObs !== false),
        showStage: String(liveConfig.showStage !== false),
        startAutomation: String(liveConfig.startAutomation !== false),
        startCapture: String(!!liveConfig.startCapture),
        startTransmission: String(!!liveConfig.startTransmission),
        actionMode: liveConfig.actionMode || 'simulated',
      });
      const response = await fetch(apiUrl(`/obs/live-plan?${query.toString()}`));
      const data = (await response.json().catch(() => ({}))) as LivePlan;
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setLivePlan(data);
    } catch (err) {
      setLivePlanMessage(err instanceof Error ? err.message : 'Falha ao carregar plano da live');
    } finally {
      setLivePlanLoading(false);
    }
  }, [liveConfig]);

  const simulateLiveStart = async () => {
    setLivePlanLoading(true);
    setLivePlanMessage(null);
    try {
      const response = await fetch(apiUrl('/obs/start-live/dry-run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(liveConfig),
      });
      const data = (await response.json().catch(() => ({}))) as LivePlan;
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setLivePlan(data);
      setLivePlanMessage('Simulacao concluida sem afetar OBS, chat, TTS ou transmissao.');
    } catch (err) {
      setLivePlanMessage(err instanceof Error ? err.message : 'Falha ao simular Iniciar Live');
    } finally {
      setLivePlanLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadObsSettings();
      void loadObsProfiles();
      void loadWebhooks();
      void loadLivePlan();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLivePlan, loadObsSettings, loadWebhooks]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify(workspace));
  }, [workspace]);

  const saveObsSettings = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Partial<ObsSettings> = {
        enabled: obsSettings.enabled,
        websocketUrl: buildObsWebsocketUrl(obsConnection),
        ocrSourceName: obsSettings.chatSourceName || obsSettings.ocrSourceName,
        chatSourceName: obsSettings.chatSourceName || obsSettings.ocrSourceName,
        stageSourceName: obsSettings.stageSourceName,
        stageUrl: obsSettings.stageUrl,
        startupSceneName: obsSettings.startupSceneName,
        liveSceneName: obsSettings.liveSceneName,
        transmissionMode: obsSettings.transmissionMode,
        canvasWidth: obsSettings.canvasWidth,
        canvasHeight: obsSettings.canvasHeight,
        sceneWhitelist: obsSettings.allowedScenes,
        allowedScenes: obsSettings.allowedScenes,
      };
      if (obsConnection.authenticationEnabled && passwordInput.trim()) {
        payload.websocketPassword = passwordInput;
      }
      if (!obsConnection.authenticationEnabled) {
        payload.websocketPassword = '';
      }
      const response = await fetch(apiUrl('/obs/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        settings?: Partial<ObsSettings>;
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const normalized = normalizeObsSettings(data.settings);
      setObsSettings(normalized);
      setObsConnection(parseObsConnection(normalized));
      setSelectedSceneTest((current) => current || normalized.allowedScenes[0] || '');
      setPasswordInput('');
      setMessage('Configuracoes do OBS salvas.');
      onSaved();
      if (onObsSettingsChanged) {
        onObsSettingsChanged(payload as Record<string, unknown>);
      }
      void onRefreshHealth();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao salvar configuracoes');
    } finally {
      setSaving(false);
    }
  };

  const updateWorkspace = (patch: Partial<WorkspaceSettings>) => {
    setWorkspace((current) => ({ ...current, ...patch }));
  };

  const syncObsScenes = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl('/obs/scenes'));
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        scenes?: string[];
        currentScene?: string | null;
        allowedScenes?: string[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const scenes = Array.isArray(data.scenes) ? data.scenes : [];
      setAvailableScenes(scenes);
      setObsHealth((current) => ({
        ...(current || {}),
        connected: true,
        availableScenes: scenes,
        allowedScenes: data.allowedScenes || obsSettings.allowedScenes,
        currentScene: data.currentScene || current?.currentScene || null,
        sceneSwitchReady: Boolean((data.allowedScenes || obsSettings.allowedScenes).length),
      }));
      setMessage(`Cenas sincronizadas: ${scenes.length}. Marque as cenas que as automacoes podem usar.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao sincronizar cenas do OBS');
    } finally {
      setLoading(false);
    }
  };

  const toggleAllowedScene = (scene: string) => {
    setObsSettings((current) => {
      const exists = current.allowedScenes.some((item) => item.toLowerCase() === scene.toLowerCase());
      const next = exists
        ? current.allowedScenes.filter((item) => item.toLowerCase() !== scene.toLowerCase())
        : [...current.allowedScenes, scene];
      return { ...current, sceneWhitelist: next, allowedScenes: next };
    });
    setSelectedSceneTest((current) => current || scene);
  };

  const testSceneSwitch = async () => {
    const sceneName = selectedSceneTest || obsSettings.allowedScenes[0] || '';
    if (!sceneName) {
      setMessage('Selecione uma cena permitida para testar a troca.');
      return;
    }
    setSceneTesting(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl('/obs/switch-scene'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneName }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        currentScene?: string;
        sceneName?: string;
        scene?: string;
        error?: string;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(`Cena alterada no OBS: ${data.currentScene || data.sceneName || data.scene || sceneName}`);
      void testObs();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao trocar cena no OBS');
    } finally {
      setSceneTesting(false);
    }
  };

  const saveWebhook = async () => {
    setWebhookSaving(true);
    setWebhookMessage(null);
    try {
      const payload = {
        ...webhookDraft,
        headers: parseHeadersText(webhookHeaderText),
      };
      const response = await fetch(apiUrl('/webhooks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        webhook?: WebhookConfig;
        webhooks?: WebhookConfig[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhooks(Array.isArray(data.webhooks) ? data.webhooks : []);
      setWebhookDraft({ ...payload, id: data.webhook?.id || payload.id });
      setWebhookMessage('Webhook salvo.');
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao salvar webhook');
    } finally {
      setWebhookSaving(false);
    }
  };

  const editWebhook = (webhook: WebhookConfig) => {
    setWebhookDraft(webhook);
    setWebhookHeaderText(headersToText(webhook.headers));
    setWebhookMessage(null);
  };

  const deleteWebhook = async (webhookId: string) => {
    setWebhookSaving(true);
    setWebhookMessage(null);
    try {
      const response = await fetch(apiUrl(`/webhooks/${encodeURIComponent(webhookId)}`), {
        method: 'DELETE',
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        webhooks?: WebhookConfig[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhooks(Array.isArray(data.webhooks) ? data.webhooks : []);
      if (webhookDraft.id === webhookId) {
        setWebhookDraft(EMPTY_WEBHOOK_DRAFT);
        setWebhookHeaderText('');
      }
      setWebhookMessage('Webhook removido.');
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao remover webhook');
    } finally {
      setWebhookSaving(false);
    }
  };

  const testWebhook = async (webhookId: string) => {
    setWebhookSaving(true);
    setWebhookMessage(null);
    try {
      const response = await fetch(apiUrl(`/webhooks/${encodeURIComponent(webhookId)}/test`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: { text: 'Teste manual do Centro de Acoes', kind: 'test' },
          action: { type: 'webhook', capability: 'webhook.call', payload: { webhookId } },
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        statusCode?: number;
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhookMessage(`Webhook executado: HTTP ${data.statusCode || 'ok'}.`);
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao testar webhook');
    } finally {
      setWebhookSaving(false);
    }
  };

  const obsReady =
    !!obsHealth?.ok && !!obsHealth.connected && !!obsHealth.sourceReady && !!obsHealth.screenshotReady;
  const sceneSwitchReady = !!obsHealth?.connected && !!obsHealth.sceneSwitchReady;
  const apiRows = [
    { label: 'Gemini', ok: !!health?.gemini_configured },
    { label: 'OpenAI texto', ok: !!health?.openai_ai_configured },
    { label: 'OpenAI TTS', ok: !!health?.openai_tts_configured },
    { label: 'Kokoro TTS', ok: !!health?.kokoro_tts_configured },
  ];

  return (
    <PageSurface
      icon={<Settings className="h-4 w-4" />}
      title="Configuracoes"
      description="OBS WebSocket, fontes persistentes, consumo de APIs, automacoes e diagnosticos ficam centralizados aqui."
    >
      <div className="h-full overflow-y-auto p-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(560px,1fr)_360px]">
          <section className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <SectionTitle icon={<Settings />} title="OBS WebSocket" />
                  <p className="mt-2 text-sm text-slate-400">
                    A live assistida usa uma source dedicada do OBS para OCR, sem depender da aba ativa.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusDot status={obsReady ? 'online' : obsHealth ? 'error' : 'idle'} />
                  <Badge variant={obsReady ? 'success' : obsHealth ? 'danger' : 'default'}>
                    {obsReady ? 'pronto' : obsHealth ? 'pendente' : 'nao testado'}
                  </Badge>
                </div>
              </div>

              <div className="mb-4 flex items-center gap-2">
                {obsProfiles.length > 0 ? (
                  <>
                    <select
                      className="h-9 cursor-pointer rounded-xl border border-white/10 bg-white/[0.06] px-3 pr-7 text-sm text-white outline-none focus:border-sky-400/40"
                      value={activeObsProfileId}
                      onChange={(e) => { if (e.target.value) void applyObsProfile(e.target.value); else setActiveObsProfileId(''); }}
                    >
                      <option value="">Selecionar perfil...</option>
                      {obsProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {activeObsProfileId && (
                      <button
                        onClick={() => void deleteObsProfile(activeObsProfileId)}
                        className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                        title="Excluir perfil"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    <div className="mx-1 h-5 w-px bg-white/10" />
                  </>
                ) : (
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Perfis</span>
                )}
                <Input
                  value={obsProfileName}
                  onChange={(e) => setObsProfileName(e.target.value)}
                  placeholder="Novo perfil..."
                  className="max-w-[200px]"
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveObsProfile(obsProfileName); }}
                />
                <Button size="sm" variant="secondary" disabled={!obsProfileName.trim() || saving} onClick={() => void saveObsProfile(obsProfileName)}>
                  <Save className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex h-10 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 text-sm text-slate-200">
                  <span>Exigir OBS WebSocket na live</span>
                  <input
                    type="checkbox"
                    checked={obsSettings.enabled}
                    onChange={(event) =>
                      setObsSettings((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                </label>
                <label className="flex h-10 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 text-sm text-slate-200">
                  <span>Habilitar autenticacao</span>
                  <input
                    type="checkbox"
                    checked={obsConnection.authenticationEnabled}
                    onChange={(event) =>
                      setObsConnection((current) => ({
                        ...current,
                        authenticationEnabled: event.target.checked,
                      }))
                    }
                  />
                </label>
                <Input
                  label="Host do servidor"
                  value={obsConnection.host}
                  placeholder="localhost"
                  onChange={(event) =>
                    setObsConnection((current) => ({ ...current, host: event.target.value }))
                  }
                />
                <Input
                  label="Porta do servidor"
                  type="number"
                  min="1"
                  max="65535"
                  value={obsConnection.port}
                  placeholder="4455"
                  onChange={(event) =>
                    setObsConnection((current) => ({ ...current, port: event.target.value }))
                  }
                />
                <Input
                  label="Source do chat/OCR"
                  value={obsSettings.chatSourceName}
                  onChange={(event) =>
                    setObsSettings((current) => ({
                      ...current,
                      chatSourceName: event.target.value,
                      ocrSourceName: event.target.value,
                    }))
                  }
                />
                <Input
                  label="Senha do servidor"
                  type="password"
                  value={passwordInput}
                  disabled={!obsConnection.authenticationEnabled}
                  placeholder={
                    !obsConnection.authenticationEnabled
                      ? 'Autenticacao desativada'
                      : obsSettings.passwordConfigured
                        ? 'Senha configurada - deixe vazio para manter'
                        : 'Senha do OBS WebSocket'
                  }
                  onChange={(event) => setPasswordInput(event.target.value)}
                />
                <Input
                  label="Source do palco"
                  value={obsSettings.stageSourceName}
                  onChange={(event) =>
                    setObsSettings((current) => ({ ...current, stageSourceName: event.target.value }))
                  }
                />
                <Input
                  label="URL do palco"
                  value={obsSettings.stageUrl}
                  onChange={(event) =>
                    setObsSettings((current) => ({ ...current, stageUrl: event.target.value }))
                  }
                />
                <Input
                  label="Cena inicial"
                  value={obsSettings.startupSceneName}
                  onChange={(event) =>
                    setObsSettings((current) => ({ ...current, startupSceneName: event.target.value }))
                  }
                />
                <Input
                  label="Cena ao vivo"
                  value={obsSettings.liveSceneName}
                  onChange={(event) =>
                    setObsSettings((current) => ({ ...current, liveSceneName: event.target.value }))
                  }
                />
                <Input
                  label="Largura palco"
                  type="number"
                  min="1"
                  value={obsSettings.canvasWidth}
                  onChange={(event) =>
                    setObsSettings((current) => ({
                      ...current,
                      canvasWidth: Math.max(1, Number(event.target.value) || current.canvasWidth),
                    }))
                  }
                />
                <Input
                  label="Altura palco"
                  type="number"
                  min="1"
                  value={obsSettings.canvasHeight}
                  onChange={(event) =>
                    setObsSettings((current) => ({
                      ...current,
                      canvasHeight: Math.max(1, Number(event.target.value) || current.canvasHeight),
                    }))
                  }
                />
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-slate-400">
                  URL gerada:{' '}
                  <span className="font-mono font-semibold text-slate-200">
                    {buildObsWebsocketUrl(obsConnection)}
                  </span>
                </div>
                <Badge variant={obsConnection.authenticationEnabled ? 'gold' : 'default'}>
                  {obsConnection.authenticationEnabled ? 'auth ligada' : 'sem auth'}
                </Badge>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                    Transmissao
                  </span>
                  <select
                    value={obsSettings.transmissionMode}
                    onChange={(event) =>
                      setObsSettings((current) => ({
                        ...current,
                        transmissionMode: event.target.value as ObsSettings['transmissionMode'],
                      }))
                    }
                    className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                  >
                    <option value="stream">OBS Stream</option>
                    <option value="virtual_camera">Camera virtual</option>
                    <option value="none">Nao iniciar automaticamente</option>
                  </select>
                </label>
                <Button
                  variant="secondary"
                  loading={loading}
                  onClick={async () => {
                    setLoading(true);
                    setMessage(null);
                    try {
                      const response = await fetch(apiUrl('/obs/setup-live-scene'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chatSourceName: obsSettings.chatSourceName,
                          stageSourceName: obsSettings.stageSourceName,
                          stageUrl: obsSettings.stageUrl,
                          startupSceneName: obsSettings.startupSceneName,
                          liveSceneName: obsSettings.liveSceneName,
                          transmissionMode: obsSettings.transmissionMode,
                          canvasWidth: obsSettings.canvasWidth,
                          canvasHeight: obsSettings.canvasHeight,
                        }),
                      });
                      const data = (await response.json().catch(() => ({}))) as {
                        ok?: boolean;
                        layout?: Partial<ObsSettings>;
                        allowedScenes?: string[];
                        error?: string | null;
                      };
                      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
                      if (data.layout) setObsSettings((current) => normalizeObsSettings({ ...current, ...data.layout }));
                      if (Array.isArray(data.allowedScenes)) {
                        setObsSettings((current) => ({
                          ...current,
                          allowedScenes: data.allowedScenes || current.allowedScenes,
                          sceneWhitelist: data.allowedScenes || current.sceneWhitelist,
                        }));
                      }
                      setMessage('Mesa OBS preparada: cenas, palco e chat foram sincronizados.');
                      void testObs();
                    } catch (err) {
                      setMessage(err instanceof Error ? err.message : 'Falha ao preparar Mesa OBS');
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  <RadioTower className="h-4 w-4" />
                  Preparar mesa OBS
                </Button>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Cenas permitidas para automacoes
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Sincronize do OBS e marque apenas as cenas que podem ser acionadas por gatilhos.
                    </div>
                  </div>
                  <Button variant="secondary" loading={loading} onClick={() => void syncObsScenes()}>
                    <RefreshCw className="h-4 w-4" />
                    Sincronizar cenas
                  </Button>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {availableScenes.length ? (
                    availableScenes.map((scene) => {
                      const allowed = obsSettings.allowedScenes.some(
                        (item) => item.toLowerCase() === scene.toLowerCase(),
                      );
                      return (
                        <label
                          key={scene}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-slate-200"
                        >
                          <span className="truncate">{scene}</span>
                          <input
                            type="checkbox"
                            checked={allowed}
                            onChange={() => toggleAllowedScene(scene)}
                          />
                        </label>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500 md:col-span-2">
                      Nenhuma cena sincronizada ainda. Use o botao acima com o OBS aberto.
                    </div>
                  )}
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                  <select
                    value={selectedSceneTest}
                    onChange={(event) => setSelectedSceneTest(event.target.value)}
                    className="h-10 rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                  >
                    <option value="">Selecionar cena para teste</option>
                    {obsSettings.allowedScenes.map((scene) => (
                      <option key={scene} value={scene}>
                        {scene}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    loading={sceneTesting}
                    onClick={() => void testSceneSwitch()}
                  >
                    <RadioTower className="h-4 w-4" />
                    Testar troca
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" loading={saving} onClick={() => void saveObsSettings()}>
                  <CheckCircle2 className="h-4 w-4" />
                  Salvar OBS
                </Button>
                <Button variant="secondary" loading={loading} onClick={() => void testObs()}>
                  <RefreshCw className="h-4 w-4" />
                  Testar source
                </Button>
                <Button variant="secondary" loading={loading} onClick={() => void loadObsSettings()}>
                  <RefreshCw className="h-4 w-4" />
                  Recarregar
                </Button>
              </div>

              {message && (
                <div
                  className={cn(
                    'mt-4 rounded-2xl border px-3 py-2 text-sm',
                    obsReady
                      ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                      : 'border-amber-400/25 bg-amber-500/10 text-amber-100',
                  )}
                >
                  {message}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <SectionTitle icon={<ClipboardCheck />} title="Configuracao do Iniciar Live" />
                  <p className="mt-2 text-sm text-slate-400">
                    O botao do topo executa este plano. Use a simulacao para conferir tudo sem afetar a live.
                  </p>
                </div>
                <Badge variant={liveConfig.actionMode === 'real' ? 'danger' : 'success'}>
                  {liveConfig.actionMode === 'real' ? 'acoes reais' : 'seguro por padrao'}
                </Badge>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {[
                  ['prepareObs', 'Verificar/preparar OBS'],
                  ['showStage', 'Colocar palco na cena live'],
                  ['startAutomation', 'Iniciar automacao do fluxo'],
                  ['startCapture', 'Disparar captura do chat'],
                  ['voiceEnabled', 'Habilitar Voz IA / TTS'],
                  ['enableChat', 'Habilitar resposta no chat'],
                  ['startTransmission', 'Iniciar transmissao/camera'],
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className="flex h-10 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 text-sm text-slate-200"
                  >
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={
                        key === 'prepareObs' || key === 'showStage' || key === 'startAutomation'
                          ? liveConfig[key as keyof LiveConfig] !== false
                          : !!liveConfig[key as keyof LiveConfig]
                      }
                      onChange={(event) =>
                        onLiveConfigChange?.((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                  </label>
                ))}
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                    Modo das acoes
                  </span>
                  <select
                    value={liveConfig.actionMode || 'simulated'}
                    onChange={(event) =>
                      onLiveConfigChange?.((current) => ({
                        ...current,
                        actionMode: event.target.value as LiveConfig['actionMode'],
                      }))
                    }
                    className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                  >
                    <option value="simulated">Simulado por padrao</option>
                    <option value="approval_required">Exigir aprovacao</option>
                    <option value="real">Real ao clicar</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Plano ativo
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {(livePlan?.steps || []).map((step) => (
                      <div
                        key={step.id}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-xs',
                          step.enabled
                            ? step.status === 'blocked'
                              ? 'border-rose-400/25 bg-rose-500/10 text-rose-200'
                              : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                            : 'border-white/10 bg-white/[0.035] text-slate-500',
                        )}
                      >
                        <div className="font-semibold">{step.label}</div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-widest opacity-70">
                          {step.enabled ? step.mode : 'desativado'}
                        </div>
                      </div>
                    ))}
                    {!livePlan?.steps?.length && (
                      <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500 md:col-span-2">
                        Carregue o plano para ver a ordem exata das acoes.
                      </div>
                    )}
                  </div>
                  {!!livePlan?.risks?.length && (
                    <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                      {livePlan.risks.join(' | ')}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Button variant="secondary" loading={livePlanLoading} onClick={() => void loadLivePlan()}>
                    <RefreshCw className="h-4 w-4" />
                    Atualizar plano
                  </Button>
                  <Button variant="success" loading={livePlanLoading} onClick={() => void simulateLiveStart()}>
                    <ShieldAlert className="h-4 w-4" />
                    Simular Iniciar Live
                  </Button>
                </div>
              </div>

              {livePlanMessage && (
                <div className="mt-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                  {livePlanMessage}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <SectionTitle icon={<Link2 />} title="Webhooks" />
                  <p className="mt-2 text-sm text-slate-400">
                    Cadastre endpoints genericos para gatilhos. n8n entra aqui como um webhook comum.
                  </p>
                </div>
                <Badge variant={webhooks.length ? 'success' : 'default'}>
                  {webhooks.length ? `${webhooks.length} configurado(s)` : 'sem webhooks'}
                </Badge>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
                <div className="space-y-2">
                  {webhooks.length ? (
                    webhooks.map((webhook) => (
                      <div
                        key={webhook.id}
                        className="rounded-2xl border border-white/10 bg-white/[0.045] p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            className="min-w-0 text-left"
                            onClick={() => editWebhook(webhook)}
                          >
                            <div className="truncate text-sm font-semibold text-white">
                              {webhook.name}
                            </div>
                            <div className="mt-1 truncate text-xs text-slate-500">
                              {webhook.id}
                            </div>
                          </button>
                          <Badge variant={webhook.enabled ? 'success' : 'warning'}>
                            {webhook.enabled ? 'ativo' : 'pausado'}
                          </Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={webhookSaving}
                            onClick={() => void testWebhook(webhook.id)}
                          >
                            Testar
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={webhookSaving}
                            onClick={() => void deleteWebhook(webhook.id)}
                          >
                            Remover
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">
                      Nenhum webhook salvo.
                    </div>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    label="Nome"
                    value={webhookDraft.name}
                    onChange={(event) =>
                      setWebhookDraft((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Metodo
                    </span>
                    <select
                      value={webhookDraft.method}
                      onChange={(event) =>
                        setWebhookDraft((current) => ({ ...current, method: event.target.value }))
                      }
                      className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                    >
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                    </select>
                  </label>
                  <Input
                    label="URL"
                    value={webhookDraft.url}
                    placeholder="https://..."
                    className="md:col-span-2"
                    onChange={(event) =>
                      setWebhookDraft((current) => ({ ...current, url: event.target.value }))
                    }
                  />
                  <Input
                    label="Timeout ms"
                    type="number"
                    min="500"
                    max="15000"
                    value={webhookDraft.timeoutMs}
                    onChange={(event) =>
                      setWebhookDraft((current) => ({
                        ...current,
                        timeoutMs: Number(event.target.value) || 2500,
                      }))
                    }
                  />
                  <label className="flex h-10 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 text-sm text-slate-200">
                    <span>Ativo</span>
                    <input
                      type="checkbox"
                      checked={webhookDraft.enabled}
                      onChange={(event) =>
                        setWebhookDraft((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }))
                      }
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Headers
                    </span>
                    <textarea
                      value={webhookHeaderText}
                      onChange={(event) => setWebhookHeaderText(event.target.value)}
                      className="min-h-20 w-full resize-y rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                      placeholder="Authorization: Bearer ..."
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Body template
                    </span>
                    <textarea
                      value={webhookDraft.bodyTemplate}
                      onChange={(event) =>
                        setWebhookDraft((current) => ({
                          ...current,
                          bodyTemplate: event.target.value,
                        }))
                      }
                      className="min-h-28 w-full resize-y rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 font-mono text-xs text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2 md:col-span-2">
                    <Button variant="primary" loading={webhookSaving} onClick={() => void saveWebhook()}>
                      <CheckCircle2 className="h-4 w-4" />
                      Salvar webhook
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setWebhookDraft(EMPTY_WEBHOOK_DRAFT);
                        setWebhookHeaderText('');
                        setWebhookMessage(null);
                      }}
                    >
                      Novo
                    </Button>
                  </div>
                  {webhookMessage && (
                    <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-300 md:col-span-2">
                      {webhookMessage}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
                <SectionTitle icon={<Database />} title="Consumo de APIs" />
                <div className="mt-4 grid gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Perfil de custo
                    </span>
                    <select
                      value={workspace.apiBudgetMode}
                      onChange={(event) =>
                        updateWorkspace({
                          apiBudgetMode: event.target.value as WorkspaceSettings['apiBudgetMode'],
                        })
                      }
                      className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                    >
                      <option value="economico">Economico</option>
                      <option value="normal">Normal</option>
                      <option value="agressivo">Agressivo</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {apiRows.map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm"
                      >
                        <span className="truncate text-slate-300">{row.label}</span>
                        <StatusDot status={row.ok ? 'online' : 'idle'} />
                      </div>
                    ))}
                  </div>
                  <Button variant="secondary" onClick={() => void onRefreshHealth()}>
                    <RefreshCw className="h-4 w-4" />
                    Atualizar health
                  </Button>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
                <SectionTitle icon={<RadioTower />} title="Automacoes" />
                <div className="mt-4 grid gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                      Modo operacional
                    </span>
                    <select
                      value={workspace.automationMode}
                      onChange={(event) =>
                        updateWorkspace({
                          automationMode: event.target.value as WorkspaceSettings['automationMode'],
                        })
                      }
                      className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                    >
                      <option value="manual">Manual</option>
                      <option value="assistido">Assistido</option>
                      <option value="automatico">Automatico</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Regras" value={health ? 'online' : 'aguardando'} />
                    <Metric label="Cenas permitidas" value={obsSettings.allowedScenes.length} />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
              <SectionTitle icon={<ShieldAlert />} title="Relatorio de erros" />
              <div className="mt-4 space-y-3">
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-3 text-sm text-slate-200">
                  <span>Salvar diagnosticos locais</span>
                  <input
                    type="checkbox"
                    checked={workspace.errorReports}
                    onChange={(event) => updateWorkspace({ errorReports: event.target.checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-3 text-sm text-slate-200">
                  <span>Telemetria de uso</span>
                  <input
                    type="checkbox"
                    checked={workspace.telemetry}
                    onChange={(event) => updateWorkspace({ telemetry: event.target.checked })}
                  />
                </label>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs leading-5 text-slate-400">
                  Estas preferencias ficam locais por enquanto. A estrutura ja deixa o painel pronto para
                  plugar provedores de erro, custos de API e novas automacoes.
                </div>
              </div>
            </div>


            <div className="rounded-[28px] border border-white/10 bg-[#101114] p-4">
              <SectionTitle icon={<ListVideo />} title="Diagnostico OBS" />
              <div className="mt-4 space-y-2 text-sm">
                <FlowDatum label="Conectado" value={obsHealth?.connected ? 'sim' : 'nao'} />
                <FlowDatum label="Source pronta" value={obsHealth?.sourceReady ? 'sim' : 'nao'} />
                <FlowDatum label="Screenshot" value={obsHealth?.screenshotReady ? 'sim' : 'nao'} />
                <FlowDatum label="Troca de cena" value={sceneSwitchReady ? 'sim' : 'nao'} />
                <FlowDatum
                  label="Cenas OBS"
                  value={String(availableScenes.length || obsHealth?.availableScenes?.length || 0)}
                />
                <FlowDatum label="Cenas permitidas" value={String(obsSettings.allowedScenes.length)} />
                <FlowDatum
                  label="Resolucao"
                  value={
                    obsHealth?.imageWidth && obsHealth?.imageHeight
                      ? `${obsHealth.imageWidth}x${obsHealth.imageHeight}`
                      : '-'
                  }
                />
                <FlowDatum label="Cena atual" value={obsHealth?.currentScene || '-'} />
                <FlowDatum label="Erro" value={obsHealth?.error || '-'} />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </PageSurface>
  );
}

function ReactiveFlowLogLab({
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

// Metadados de cada aba para o cabeçalho/sidebar (redesign Studio 2.0).
const TAB_META: Record<TabKey, { group: string; title: string }> = {
  live:     { group: 'Operação', title: 'Central da Live' },
  library:  { group: 'Conteúdo', title: 'Biblioteca' },
  flow:     { group: 'Operação', title: 'Automações' },
  history:  { group: 'Operação', title: 'Histórico da Live' },
  settings: { group: 'Sistema',  title: 'Configurações' },
  home:     { group: 'Operação', title: 'Central da Live' },
  stage:    { group: 'Operação', title: 'Palco' },
  ai:       { group: 'Configuração', title: 'Diretora IA' },
  chat:     { group: 'Operação', title: 'Central da Live' },
  canvas:   { group: 'Conteúdo', title: 'Mural de Planejamento' },
  sources:  { group: 'Sistema',  title: 'Fontes / OCR' },
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

function HomeDashboard({
  capturedText,
  runtime,
  videoState,
  view,
  go,
  onRefresh,
}: {
  capturedText: CapturedMessage[];
  runtime: AutopilotRuntimeState;
  videoState: VideoState | null;
  view: HomeViewData;
  go: (tab: TabKey) => void;
  onRefresh: () => void;
}) {
  // ⚡ Bolt: Using backward loop instead of slice(-6).reverse()
  const latestEvents = [];
  for (let i = capturedText.length - 1; i >= Math.max(0, capturedText.length - 6); i--) {
    latestEvents.push(capturedText[i]);
  }
  // Derive the active clip exactly like StagePanel so both players stay in sync.
  // applyVideoEdit sobrepõe a edição por vídeo (cortes/volume/áudio) também nos
  // clipes vindos do servidor (fluxo), não só nos forçados pela Diretora.
  const homeActiveClip =
    (videoState?.currentClip ? applyVideoEdit(videoState.currentClip) : null) ||
    (videoState?.current_video_id
      ? clipFromVideoId(videoState.current_video_id, view.videos)
      : view.idleVideoId
        ? clipFromVideoId(view.idleVideoId, view.videos)
        : null);

  const homeDecision = runtime.latestDecision;
  const homeMood = globalMoodEngine.getCurrentMood();
  const homeMoodLabel = ({ cozy: 'Aconchego', hype: 'Hype', focused: 'Focada', chaotic: 'Caótica' } as Record<string, string>)[homeMood.state] || 'Calma';
  const homeStats = [
    { v: view.activeTriggers.length, l: 'Gatilhos ativos', accent: true },
    { v: videoState?.queue_len ?? 0, l: 'Clipes na fila' },
    { v: capturedText.length, l: 'Eventos' },
    { v: runtime.obsScenes.length, l: 'Cenas OK' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#07080a] p-4 lg:p-5">
      <div className="grid gap-4 lg:grid-cols-[348px_1fr]" style={{ alignItems: 'start' }}>
        {/* Preview do palco */}
        <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-black" style={{ aspectRatio: '9 / 16', maxHeight: 592 }}>
          <ContinuityPlayer
            clip={homeActiveClip}
            nextClip={videoState?.nextClip ? applyVideoEdit(videoState.nextClip) : null}
            videos={view.videos}
            onEnded={async () => { await advanceReactiveFlow(videoState ?? null); onRefresh(); }}
            fit="contain"
            className="h-full w-full"
          />
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2">
            <span className="rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-[var(--gold)]">{videoState?.state === 'ACTION' ? 'reação no ar' : 'em ensaio'}</span>
            <span className="rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">1080×1920</span>
          </div>
        </div>

        {/* Coluna direita */}
        <div className="flex flex-col gap-4">
          {/* Diretora ao vivo */}
          <div className="odessa-panel-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <Brain style={{ width: 15, height: 15 }} className="text-[var(--violet)]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Diretora ao vivo</span>
              <button className="ml-auto text-[11px] text-slate-500 hover:text-slate-300" onClick={() => go('ai')}>ver tudo →</button>
            </div>
            <div className="flex gap-4">
              <div className="min-w-0 flex-1">
                {homeDecision ? (
                  <>
                    <p className="text-[13px] italic text-sky-200/90">“{homeDecision.speech}”</p>
                    <p className="mt-1 text-[11px] text-slate-500">{homeDecision.reason}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {homeDecision.actions.slice(0, 4).map((a) => (
                        <span key={a.id} className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300">{a.type}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] text-slate-500">Aguardando eventos — inicie a Diretora para vê-la conduzir.</p>
                )}
              </div>
              <div className="w-[136px] shrink-0 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Humor</div>
                <div className="heading-serif text-2xl text-[var(--gold)]">{homeMoodLabel}</div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#171a1f]"><div className="h-full rounded-full" style={{ width: `${Math.round(homeMood.energy)}%`, background: 'var(--accent-grad)' }} /></div>
                <div className="text-[11px] text-slate-500">energia {Math.round(homeMood.energy)} · acolhimento {Math.round(homeMood.warmth)}</div>
              </div>
            </div>
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {homeStats.map((s) => (
              <div key={s.l} className="odessa-panel-surface p-4">
                <div className="heading-serif text-3xl leading-none" style={s.accent ? { color: 'transparent', backgroundImage: 'var(--accent-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text' } : undefined}>{s.v}</div>
                <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{s.l}</div>
              </div>
            ))}
          </div>

          {/* Eventos ao vivo */}
          <div className="odessa-panel-surface p-4">
            <div className="mb-2 flex items-center gap-2">
              <RadioTower style={{ width: 15, height: 15 }} className="text-[var(--violet)]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Eventos · ao vivo</span>
              <span className="ml-auto text-[10px] text-slate-600">captura ●</span>
            </div>
            {latestEvents.length === 0 ? (
              <p className="text-xs text-slate-500">Aguardando OCR ou teste manual.</p>
            ) : (
              <div className="divide-y divide-white/5">
                {latestEvents.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 py-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#171a1f] text-[13px]">{event.kind === 'gift' ? '🎁' : event.kind === 'alert' ? '👋' : '💬'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] text-slate-200">{event.text}</div>
                      <div className="text-[10px] text-slate-600">{event.kind}/{event.source}</div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-slate-600">{event.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
 * Segmentos limitados (com fim definido) que o player deve tocar em sequência.
 * - segments[] explícitos → usa-os;
 * - senão, trim simples (startSec/endSec) → um único segmento;
 * - senão (sem fim) → [] (vídeo inteiro; o evento 'ended' nativo encerra).
 */
function effectiveSegments(clip: VideoClip | null): VideoSegment[] {
  if (!clip) return [];
  if (clip.segments && clip.segments.length) return clip.segments;
  if (clip.endSec != null) return [{ startSec: Math.max(0, clip.startSec || 0), endSec: clip.endSec }];
  return [];
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
}: {
  clip: VideoClip | null;
  nextClip?: VideoClip | null;
  videos: VideoEntry[];
  onEnded: () => Promise<void>;
  className?: string;
  fit?: 'cover' | 'contain';
  showLabel?: boolean;
}) {
  const firstVideoRef = useRef<HTMLVideoElement>(null);
  const secondVideoRef = useRef<HTMLVideoElement>(null);
  const refs = useMemo(() => [firstVideoRef, secondVideoRef] as const, []);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const activeSlotRef = useRef<0 | 1>(0);
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
  const activateSlot = useCallback((slot: 0 | 1) => {
    activeSlotRef.current = slot;
    setActiveSlot(slot);
  }, []);

  const primeElement = useCallback((element: HTMLVideoElement, slotClip: VideoClip, slot: 0 | 1) => {
    element.muted = (slotClip.audio?.mode || 'muted') !== 'original';
    element.volume = Math.max(0, Math.min(1, slotClip.audio?.volume ?? 1));
    // Reinicia no primeiro segmento (cortes multi-segmento da Fase 4).
    slotSegmentRef.current[slot] = 0;
    const segs = effectiveSegments(slotClip);
    const start = segs.length ? segs[0].startSec : Math.max(0, slotClip.startSec || 0);
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
          activateSlot(slot);
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
    [activateSlot, primeElement, refs],
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
      activateSlot(slot);
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
    const segs = effectiveSegments(slotClip);
    if (!segs.length) return; // vídeo inteiro → encerra pelo evento 'ended' nativo
    let idx = slotSegmentRef.current[slot];
    if (idx >= segs.length) idx = segs.length - 1;
    const seg = segs[idx];
    if (element.currentTime < seg.endSec) return;
    if (idx + 1 < segs.length) {
      // Próximo corte: pula para o início do segmento seguinte (mesma fonte).
      slotSegmentRef.current[slot] = idx + 1;
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
          className={cn(
            'absolute inset-0 h-full w-full',
            fit === 'contain' ? 'object-contain' : 'object-cover',
            activeSlot === index ? 'opacity-100' : 'opacity-0',
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
}: {
  runtime: AutopilotRuntimeState;
  capturedText: CapturedMessage[];
  view: HomeViewData;
  videoState: VideoState | null;
  obsSettingsFromApp?: Record<string, unknown> | null;
  onRefresh: () => void;
  onPlayVideoById: (videoId: string, reason?: string) => Promise<unknown>;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [triggering, setTriggering] = useState(false);
  const [obsBusy, setObsBusy] = useState('');
  const [, setObsMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const runRoutedCommand = async (label: string, fn: () => Promise<CommandResult>) => {
    setObsBusy(label);
    setObsMessage(null);
    try {
      const result = await fn();
      setObsMessage(`${label}: ${result.ok ? 'ok' : result.error} (${result.route})`);
      onRefresh();
    } catch (err) {
      setObsMessage(`${label}: ${err instanceof Error ? err.message : 'falha'}`);
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

  const forceVideo = async (videoId: string) => {
    if (!videoId) return;
    setTriggering(true);
    try {
      await onPlayVideoById(videoId, 'manual_click');
    } finally {
      setTriggering(false);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await stageRef.current?.requestFullscreen();
    } catch (err) {
      setObsMessage(`Tela cheia: ${err instanceof Error ? err.message : 'falha'}`);
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

  // ⚡ Bolt: Using backward loop instead of slice(-3).reverse()
  const latestSignals = [];
  for (let i = capturedText.length - 1; i >= Math.max(0, capturedText.length - 3); i--) {
    latestSignals.push(capturedText[i]);
  }

  const activeClipLabel = activeClip ? clipDisplayName(activeClip, view.videos) : 'Sem video selecionado';

  const advanceVideo = async () => {
    await advanceReactiveFlow(videoState ?? null);
    onRefresh();
  };

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
    <div ref={stageRef} className="odsa-stage2 flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-[#07080a] p-4 lg:p-5">
      {/* Status + controles de OBS */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          status={deriveStageStatus({ state: videoState?.state, isTransitioning: triggering, queueLen: videoState?.queue_len, autopilotEnabled: runtime.autopilotEnabled })}
          pulse={runtime.autopilotEnabled}
        />
        <span className="truncate text-xs text-slate-400">{videoState?.queue_len ?? 0} na fila</span>
        <div className="ml-auto flex items-center gap-2">
          <button className="odsa-btn odsa-btn-secondary odsa-btn-md" disabled={!!obsBusy} onClick={() => void runRoutedCommand('Preparar mesa OBS', () => routeSetupLiveScene(obsSettingsFromApp as never))}>
            <Upload style={{ width: 14, height: 14 }} /> Preparar OBS
          </button>
          <button className="odsa-btn odsa-btn-primary odsa-btn-md" disabled={!!obsBusy} onClick={() => void runRoutedCommand('Iniciar transmissao', () => routeStartTransmission(obsSettingsFromApp as never))}>
            <RadioTower style={{ width: 14, height: 14 }} /> Transmitir
          </button>
          <button className="odsa-btn odsa-btn-secondary odsa-btn-md odsa-btn-icon" onClick={() => void toggleFullscreen()} title="Tela cheia">
            <Maximize2 style={{ width: 15, height: 15 }} />
          </button>
        </div>
      </div>

      {/* Topo: preview + No ar agora + fila */}
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]" style={{ alignItems: 'start' }}>
        <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-black" style={{ aspectRatio: '9 / 16', maxHeight: 460 }}>
          <ContinuityPlayer clip={activeClip} nextClip={videoState?.nextClip ? applyVideoEdit(videoState.nextClip) : null} videos={view.videos} onEnded={advanceVideo} fit="contain" className="h-full w-full" />
          <div className="pointer-events-none absolute right-2 top-2 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-[var(--sky)]">No ar</div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="odessa-panel-surface p-4">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">No ar agora</div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{activeClipLabel}</div>
                <div className="truncate text-xs text-slate-500">{(activeClip?.segments?.length || 0) > 0 ? `${activeClip?.segments?.length} cortes` : 'sem corte'} · áudio {activeClip?.audio?.mode || 'mudo'}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="odsa-btn odsa-btn-secondary odsa-btn-md odsa-btn-icon" title="Repetir" onClick={() => { if (activeClip?.videoId) void forceVideo(activeClip.videoId); }}><Rewind style={{ width: 15, height: 15 }} /></button>
                <button className="odsa-btn odsa-btn-secondary odsa-btn-md odsa-btn-icon" title="Próximo" onClick={() => void advanceVideo()}><FastForward style={{ width: 15, height: 15 }} /></button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <VolumeX style={{ width: 15, height: 15 }} className="shrink-0 text-slate-500" />
              <input type="range" min={0} max={100} value={Math.round((activeClip?.audio?.volume ?? 1) * 100)}
                onChange={(e) => { if (!activeClip?.videoId) return; const cur = getVideoEdit(activeClip.videoId) ?? defaultVideoEdit(activeClip.videoId); saveVideoEdit({ ...cur, volume: Number(e.target.value) / 100 }); onRefresh(); }}
                className="flex-1 accent-[var(--violet)]" />
              <span className="w-9 shrink-0 text-right font-mono text-[11px] text-slate-400">{Math.round((activeClip?.audio?.volume ?? 1) * 100)}%</span>
            </div>
          </div>

          <div className="odessa-panel-surface p-4">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">A seguir na fila</div>
            {upcomingClips.length === 0 ? (
              <div className="text-xs text-slate-500">Nada enfileirado. A Diretora enfileira reações automaticamente.</div>
            ) : (
              <div className="space-y-2">
                {upcomingClips.slice(0, 5).map((clip, i) => (
                  <div key={`${clip.videoId}-${i}`} className="flex items-center gap-3 text-xs">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#171a1f] text-slate-400">▶</span>
                    <span className="truncate text-slate-300">{clipDisplayName(clip, view.videos)}</span>
                    <span className="ml-auto text-slate-600">fila</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Editor de cortes — embutido na página (sem modal) */}
      {activeClip?.videoId ? (
        <Suspense fallback={<div className="odessa-panel-surface p-4 text-xs text-slate-500">Carregando editor…</div>}>
          <VideoEditor embedded key={activeClip.videoId} videoId={activeClip.videoId} label={activeClipLabel} />
        </Suspense>
      ) : (
        <div className="odessa-panel-surface p-4 text-xs text-slate-500">Coloque um vídeo no ar para editar os cortes aqui.</div>
      )}
    </div>
  );

}

function VideoLibraryPanel({
  config,
  onChanged,
}: {
  config: PersonaConfig | null;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadBatch, setUploadBatch] = useState<
    Array<{ name: string; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string }>
  >([]);
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const videos = config?.videos || [];
  const editingVideo = videos.find((v) => v.id === editingVideoId) || null;

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

      {videos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Film className="mb-4 h-12 w-12 text-[var(--t3)]" />
          <p className="text-sm font-semibold text-[var(--t1)]">Nenhum video na biblioteca</p>
          <p className="mt-1 text-xs text-[var(--t3)]">Clique em "Adicionar videos" para fazer upload</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {videos.map((video) => (
          <Card key={video.id} className="overflow-hidden bg-[#101114]">
            <div className="aspect-video bg-black">
              <video
                muted
                playsInline
                preload="metadata"
                className="h-full w-full object-contain"
                src={apiUrl(`/api/video/play/${video.id}`)}
              />
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{videoLabel(video)}</div>
                  <div className="truncate text-xs text-[var(--t3)]">{video.group || video.id}</div>
                </div>
                {video.loop && <Badge variant="gold">Idle</Badge>}
              </div>
              <div className="mt-3 line-clamp-2 text-xs text-[var(--t3)]">
                {video.description || 'Video registrado na Odessa.'}
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => forceVideo(video.id)}>
                  <Play className="h-3.5 w-3.5" />
                  Preview
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditingVideoId(video.id)}>
                  <Scissors className="h-3.5 w-3.5" />
                  Editar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setIdle(video.id)}>
                  Idle
                </Button>
                <Button size="sm" variant="danger" onClick={() => archiveVideo(video.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {editingVideo && (
        <Suspense fallback={null}>
          <VideoEditor
            videoId={editingVideo.id}
            label={videoLabel(editingVideo)}
            onClose={() => setEditingVideoId(null)}
          />
        </Suspense>
      )}
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
    <div className="min-w-0 rounded-[22px] border border-[var(--border2)] bg-black/20 p-4 shadow-[var(--shadow-1)]">
      <div className="heading-serif truncate text-[34px] leading-none text-[var(--t1)]">{value}</div>
      <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--t3)]">
        {label}
      </div>
    </div>
  );
}
