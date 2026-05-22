import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Camera,
  CheckCircle2,
  Clock3,
  Crosshair,
  Download,
  FileText,
  Gauge,
  Layers,
  Link2,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  ScanText,
  Settings2,
  Trash2,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { emitEvent } from './core/eventBus';
import { apiUrl, API_BASE_URL } from './lib/api';
import { cn } from './lib/utils';
import type { CapturedMessage, LiveEventKind } from './types';

interface CaptureStudioProps {
  capturedText: CapturedMessage[];
  setCapturedText: React.Dispatch<React.SetStateAction<CapturedMessage[]>>;
  autopilotEnabled?: boolean;
  pendingAutopilotEvents?: number;
  latestAutopilotActionStatus?: string;
  onStartAutopilot?: () => void;
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CaptureZone extends SelectionRect {
  id: string;
  name: string;
  role: 'chat' | 'gifts' | 'alerts' | 'custom';
  color: string;
}

interface CapturePreset {
  id: string;
  name: string;
  description: string;
  zones: CaptureZone[];
}

interface CaptureSettings {
  magnification: number;
  contrast: number;
  brightness: number;
  intervalTime: number;
  debugMode: boolean;
}

type CaptureSourceMode = 'screen' | 'obs' | 'direct';
type DirectPageMode = 'interact' | 'crop';
type DirectRenderer = 'none' | 'iframe' | 'proxy-preview' | 'electron-webview' | 'electron-webcontentsview';
type DirectPageState = 'none' | 'loading' | 'dom-ready' | 'rendered' | 'failed' | 'blocked' | 'empty';
type DirectCaptureState = 'unavailable' | 'available' | 'tested' | 'failed';

interface ElectronImage {
  toDataURL: () => string;
}

interface ElectronWebviewElement extends HTMLElement {
  src: string;
  capturePage?: () => Promise<ElectronImage>;
  loadURL?: (url: string) => void;
  reload?: () => void;
  goBack?: () => void;
  goForward?: () => void;
}

interface OdessaDesktopBridge {
  isElectron?: boolean;
  canUseDirectWebCapture?: boolean;
  canUseDesktopSources?: boolean;
  apiOrigin?: string;
  platform?: string;
  version?: string;
  renderer?: string;
  webviewTagEnabled?: boolean;
  getRuntimeStatus?: () => Promise<unknown>;
  listCaptureSources?: () => Promise<unknown>;
  openLogs?: () => Promise<unknown>;
}

interface ElectronRuntimeWindow extends Window {
  electronAPI?: {
    isElectron?: boolean;
    platform?: string;
  };
  odessaDesktop?: OdessaDesktopBridge;
}

type WebviewProps = React.HTMLAttributes<ElectronWebviewElement> & {
  src?: string;
  partition?: string;
  allowpopups?: string;
  webpreferences?: string;
};

const WebviewTag = React.forwardRef<ElectronWebviewElement, WebviewProps>((props, ref) =>
  React.createElement('webview', { ...props, ref }),
);
WebviewTag.displayName = 'WebviewTag';

interface ObsHealth {
  ok?: boolean;
  connected?: boolean;
  sourceReady?: boolean;
  sourceName?: string;
  currentScene?: string | null;
  screenshotReady?: boolean;
  imageWidth?: number | null;
  imageHeight?: number | null;
  sourceActive?: boolean | null;
  sourceShowing?: boolean | null;
  frameHash?: string | null;
  capturedAt?: string | null;
  error?: string | null;
}

interface ObsCycleResponse {
  ok?: boolean;
  sourceName?: string;
  image?: string | null;
  width?: number | null;
  height?: number | null;
  sourceActive?: boolean | null;
  sourceShowing?: boolean | null;
  frameHash?: string | null;
  capturedAt?: string | null;
  results?: OcrResponse[];
  latency_ms?: number | null;
  error?: string | null;
}

interface BackendHealth {
  status: string;
  ocr: string;
  gemini_configured: boolean;
  openai_ai_configured: boolean;
  openai_text_model?: string;
  openai_tts_configured: boolean;
}

interface CaptureEvent {
  id: string;
  zoneId: string;
  zoneName: string;
  text: string;
  rawText: string;
  time: string;
  routeStatus: 'captured' | 'processed' | 'sent' | 'error';
  confidence: number | null;
  latencyMs: number | null;
  error?: string;
  deduped?: boolean;
  duplicateReason?: string | null;
  captureMode?: string;
  sourceHealth?: Record<string, unknown>;
}

interface OcrResponse {
  text?: string;
  full_text?: string;
  error?: string | null;
  zone_id?: string | null;
  zone_name?: string | null;
  confidence?: number | null;
  latency_ms?: number | null;
  created_at?: string;
  deduped?: boolean;
  duplicateReason?: string | null;
  lineHash?: string | null;
  captureMode?: string;
  sourceHealth?: Record<string, unknown>;
  zone_role?: string | null;
}

enum CaptureStatus {
  IDLE = 'Parado',
  SELECTING = 'Fonte conectada',
  CAPTURING = 'Capturando',
  ERROR = 'Erro',
}

const STORAGE_KEY = 'odessa:capture-studio:v1';
const LEGACY_STORAGE_KEY = 'dojobua:capture-studio:v1';
const MAX_ZONES = 6;
const MAX_EVENTS = 120;
const MAX_PERSONA_MESSAGES = 100;
const DEFAULT_OBS_SOURCE_NAME = 'Odessa Chat OCR';

const DEFAULT_SETTINGS: CaptureSettings = {
  magnification: 2,
  contrast: 1.4,
  brightness: 1.05,
  intervalTime: 250,
  debugMode: false,
};

const DEFAULT_PRESETS: CapturePreset[] = [
  {
    id: 'stream-main',
    name: 'Live Chat',
    description: 'Chat principal e eventos laterais',
    zones: [
      {
        id: 'zone-chat',
        name: 'Chat',
        role: 'chat',
        color: '#38BDF8',
        x: 100,
        y: 100,
        width: 420,
        height: 300,
      },
      {
        id: 'zone-gifts',
        name: 'Presentes',
        role: 'gifts',
        color: '#F59E0B',
        x: 560,
        y: 160,
        width: 280,
        height: 220,
      },
    ],
  },
  {
    id: 'obs-compact',
    name: 'OBS Compacto',
    description: 'Uma zona grande para layout simples',
    zones: [
      {
        id: 'zone-compact-chat',
        name: 'Chat',
        role: 'chat',
        color: '#22C55E',
        x: 80,
        y: 120,
        width: 360,
        height: 420,
      },
    ],
  },
  {
    id: 'events-focus',
    name: 'Eventos',
    description: 'Separacao para alertas e presentes',
    zones: [
      {
        id: 'zone-event-chat',
        name: 'Chat',
        role: 'chat',
        color: '#38BDF8',
        x: 110,
        y: 110,
        width: 380,
        height: 260,
      },
      {
        id: 'zone-event-alerts',
        name: 'Alertas',
        role: 'alerts',
        color: '#E11D48',
        x: 560,
        y: 80,
        width: 320,
        height: 180,
      },
      {
        id: 'zone-event-gifts',
        name: 'Presentes',
        role: 'gifts',
        color: '#F59E0B',
        x: 560,
        y: 300,
        width: 320,
        height: 190,
      },
    ],
  },
];

const ROLE_LABELS: Record<CaptureZone['role'], string> = {
  chat: 'Chat',
  gifts: 'Presentes',
  alerts: 'Alertas',
  custom: 'Custom',
};

function clonePresets(presets: CapturePreset[]) {
  return presets.map((preset) => ({
    ...preset,
    zones: preset.zones.map((zone) => ({ ...zone })),
  }));
}

function getStoredState(): {
  activePresetId?: string;
  presets?: CapturePreset[];
  settings?: CaptureSettings;
  sourceName?: string;
  captureMode?: CaptureSourceMode;
  directUrl?: string;
} | null {
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatClock(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function makeEventId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function kindFromZoneRole(role: CaptureZone['role']): LiveEventKind {
  if (role === 'gifts') return 'gift';
  if (role === 'alerts') return 'alert';
  return 'chat';
}

function normalizeDirectUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Informe o link da live antes de abrir.');
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Use um link http ou https valido.');
  }
  return parsed.toString();
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Nao foi possivel preparar o frame da pagina.'));
    image.src = src;
  });
}

function TypewriterText({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    let i = 0;
    const resetTimer = window.setTimeout(() => setDisplayed(''), 0);
    const interval = window.setInterval(() => {
      setDisplayed(text.substring(0, i));
      i += 1;
      if (i > text.length) {
        window.clearInterval(interval);
      }
    }, 12);

    return () => {
      window.clearTimeout(resetTimer);
      window.clearInterval(interval);
    };
  }, [text]);

  const separators = [':', ' < ', ' > ', ' comecou a ver', ' Novo seguidor', ' curtiu'];
  let usernameLen = 0;

  for (const sep of separators) {
    const idx = text.indexOf(sep);
    if (idx > 0 && idx < 28) {
      usernameLen = idx;
      break;
    }
  }

  if (!usernameLen) {
    const firstSpace = text.indexOf(' ');
    if (firstSpace > 2 && firstSpace < 16) {
      usernameLen = firstSpace;
    }
  }

  return (
    <span>
      {usernameLen > 0 && (
        <strong className="text-amber-300">{displayed.substring(0, usernameLen)}</strong>
      )}
      <span className="text-[var(--t1)]">{displayed.substring(usernameLen)}</span>
    </span>
  );
}

function StatusChip({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: 'good' | 'warn' | 'idle' | 'danger';
  icon?: React.ReactNode;
}) {
  const tones = {
    good: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
    warn: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
    idle: 'border-[var(--border2)] bg-[var(--bg2)]/70 text-[var(--t2)]',
    danger: 'border-rose-400/30 bg-rose-500/10 text-rose-200',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
        tones[tone],
      )}
    >
      {icon}
      {label}
    </span>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-center justify-between text-xs">
        <span className="font-semibold text-[var(--t3)]">{label}</span>
        <span className="rounded bg-[var(--bg2)] px-2 py-0.5 font-mono text-[11px] text-[var(--t1)]">
          {Number.isInteger(value) ? value : value.toFixed(1)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full accent-sky-400"
      />
    </label>
  );
}

const CaptureStudio = React.memo(function CaptureStudio({
  capturedText,
  setCapturedText,
  autopilotEnabled = false,
  pendingAutopilotEvents = 0,
  latestAutopilotActionStatus,
  onStartAutopilot,
}: CaptureStudioProps) {
  const storedState = useMemo(() => getStoredState(), []);
  const [status, setStatus] = useState<CaptureStatus>(CaptureStatus.IDLE);
  const [captureMode, setCaptureMode] = useState<CaptureSourceMode>(
    storedState?.captureMode === 'direct' ? 'direct' : 'screen',
  );
  const [sourceName, setSourceName] = useState(storedState?.sourceName || DEFAULT_OBS_SOURCE_NAME);
  const [directUrl, setDirectUrl] = useState(storedState?.directUrl || '');
  const [isOpeningDirectLink, setIsOpeningDirectLink] = useState(false);
  const [directLinkStatus, setDirectLinkStatus] = useState<string | null>(null);
  const [directPageUrl, setDirectPageUrl] = useState(storedState?.directUrl || '');
  const [directPageReady, setDirectPageReady] = useState(false);
  const [directPageMode, setDirectPageMode] = useState<DirectPageMode>('interact');
  const [directPageState, setDirectPageState] = useState<DirectPageState>(
    storedState?.directUrl ? 'loading' : 'none',
  );
  const [directCaptureState, setDirectCaptureState] = useState<DirectCaptureState>('unavailable');
  const [directCapturePreview, setDirectCapturePreview] = useState<string | null>(null);
  const [directCaptureSize, setDirectCaptureSize] = useState<{ width: number; height: number } | null>(null);
  const [directCaptureError, setDirectCaptureError] = useState<string | null>(null);
  const [presets, setPresets] = useState<CapturePreset[]>(
    storedState?.presets?.length ? storedState.presets : clonePresets(DEFAULT_PRESETS),
  );
  const [activePresetId, setActivePresetId] = useState<string>(
    storedState?.activePresetId || 'stream-main',
  );
  const [activeZoneIndex, setActiveZoneIndex] = useState(0);
  const [settings, setSettings] = useState<CaptureSettings>({
    ...DEFAULT_SETTINGS,
    ...(storedState?.settings || {}),
    intervalTime: Math.max(
      250,
      Number(storedState?.settings?.intervalTime || DEFAULT_SETTINGS.intervalTime),
    ),
  });
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [obsHealth, setObsHealth] = useState<ObsHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthCheckedAt, setHealthCheckedAt] = useState('Nunca');
  const [captureEvents, setCaptureEvents] = useState<CaptureEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastCaptureTime, setLastCaptureTime] = useState('Nunca');
  const [currentRawText, setCurrentRawText] = useState('');
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [frameWarning, setFrameWarning] = useState<string | null>(null);
  const [isSelectingRegion, setIsSelectingRegion] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [currentSelection, setCurrentSelection] = useState<SelectionRect | null>(null);
  const [draggingZoneIndex, setDraggingZoneIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [resizingZoneIndex, setResizingZoneIndex] = useState<number | null>(null);

  const livePreviewRef = useRef<HTMLVideoElement | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const directWebviewRef = useRef<ElectronWebviewElement | null>(null);
  const directIframeRef = useRef<HTMLIFrameElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventsScrollRef = useRef<HTMLDivElement | null>(null);
  const isBusyRef = useRef(false);
  const zonesRef = useRef<CaptureZone[]>([]);
  const settingsRef = useRef(settings);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const lastFrameHashRef = useRef<string | null>(null);
  const repeatedFrameCountRef = useRef(0);
  const lastOpenedDirectUrlRef = useRef<string | null>(storedState?.directUrl || null);
  const runCaptureCycleRef = useRef<(() => Promise<void>) | null>(null);

  const activePreset = useMemo(
    () => presets.find((preset) => preset.id === activePresetId) || presets[0],
    [activePresetId, presets],
  );
  const zones = useMemo(() => activePreset?.zones || [], [activePreset?.zones]);
  const activeZone = zones[activeZoneIndex] || zones[0];

  const lastEvent = captureEvents[captureEvents.length - 1];
  const { successfulEvents, averageConfidence, averageLatency } = useMemo(() => {
    // ⚡ Bolt: Single-pass iteration to calculate multiple stats
    // This replaces multiple filter/reduce O(N) traversals to prevent stutter
    // during high-frequency live OCR capture updates.
    const successful: typeof captureEvents = [];
    let confSum = 0;
    let confCount = 0;
    let latSum = 0;
    let latCount = 0;

    for (let i = 0; i < captureEvents.length; i++) {
      const event = captureEvents[i];
      if (event.routeStatus !== 'error') {
        successful.push(event);
        if (event.confidence !== null && event.confidence !== undefined) {
          confSum += event.confidence;
          confCount++;
        }
        if (event.latencyMs !== null && event.latencyMs !== undefined) {
          latSum += event.latencyMs;
          latCount++;
        }
      }
    }

    return {
      successfulEvents: successful,
      averageConfidence: confCount === 0 ? 0 : confSum / confCount,
      averageLatency: latCount === 0 ? 0 : latSum / latCount,
    };
  }, [captureEvents]);
  const desktopRuntime = (window as ElectronRuntimeWindow).odessaDesktop;
  const isElectronRuntime = Boolean(desktopRuntime?.isElectron);
  const canUseDirectWebCapture = Boolean(desktopRuntime?.canUseDirectWebCapture);
  const runtimeRenderer = isElectronRuntime ? 'electron' : 'browser';

  // ----- Webview diagnostic log state (visible in the console visual) -----
  const [webviewLogs, setWebviewLogs] = useState<string[]>([]);
  const addDirectLog = useCallback((msg: string) => {
    const line = `[${formatClock()}] ${msg}`;
    setWebviewLogs((prev) => [...prev.slice(-80), line]);
    if (settingsRef.current.debugMode) {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }, []);
  const backendOnline = backendHealth?.status === 'ok' && !healthError;

  // When running in browser mode (not Electron), route the iframe through
  // the backend proxy to strip X-Frame-Options / CSP headers.
  const directRenderer: DirectRenderer = useMemo(() => {
    if (!directPageUrl) return 'none';
    if (isElectronRuntime) return 'electron-webview';
    return backendOnline ? 'proxy-preview' : 'iframe';
  }, [backendOnline, directPageUrl, isElectronRuntime]);
  const proxyIframeUrl = useMemo(() => {
    if (!directPageUrl) return '';
    if (isElectronRuntime) return directPageUrl; // webview doesn't need proxy
    // Derive the server origin from API_BASE_URL (e.g. http://localhost:8000)
    const apiOrigin = API_BASE_URL.replace(/\/api.*$/, '');
    return `${apiOrigin}/proxy?url=${encodeURIComponent(directPageUrl)}`;
  }, [directPageUrl, isElectronRuntime]);
  const obsReady = Boolean(
    obsHealth?.ok && obsHealth.connected && obsHealth.sourceReady && obsHealth.screenshotReady,
  );
  const screenReady = Boolean(screenStream?.active);
  const directReady = Boolean(
    directPageUrl &&
      isElectronRuntime &&
      directRenderer === 'electron-webview' &&
      directPageReady &&
      directPageState === 'rendered',
  );
  const directCaptureTested = directCaptureState === 'tested' && Boolean(directCapturePreview);
  const sourceReady =
    captureMode === 'screen' ? screenReady : captureMode === 'direct' ? directReady : obsReady;
  const hasDirectUrl = directUrl.trim().length > 0;
  const canStartCapture =
    backendOnline &&
    status !== CaptureStatus.CAPTURING &&
    (captureMode === 'screen' ||
      (captureMode === 'direct' ? directReady && directCaptureTested : sourceReady));
  const hasPreview =
    captureMode === 'screen'
      ? screenReady
      : captureMode === 'direct'
        ? Boolean(directPageUrl)
        : Boolean(previewImage);
  const canEditZones = captureMode !== 'direct' || directPageMode === 'crop' || isSelectingRegion;

  useEffect(() => {
    if (captureMode !== 'direct') return;
    addDirectLog(`[Runtime] Electron detectado: ${isElectronRuntime}`);
    addDirectLog(`[Runtime] isElectron=${isElectronRuntime}`);
    addDirectLog(`[Runtime] canUseDirectWebCapture=${canUseDirectWebCapture}`);
    addDirectLog(`[Runtime] renderer=${runtimeRenderer}`);
    addDirectLog(`[LinkDireto] webviewTag habilitado: ${Boolean(desktopRuntime?.webviewTagEnabled)}`);
  }, [
    addDirectLog,
    canUseDirectWebCapture,
    captureMode,
    desktopRuntime?.webviewTagEnabled,
    isElectronRuntime,
    runtimeRenderer,
  ]);

  const updateActivePresetZones = useCallback(
    (updater: CaptureZone[] | ((current: CaptureZone[]) => CaptureZone[])) => {
      setPresets((currentPresets) =>
        currentPresets.map((preset) => {
          if (preset.id !== activePresetId) return preset;
          const nextZones = typeof updater === 'function' ? updater(preset.zones) : updater;
          return { ...preset, zones: nextZones };
        }),
      );
    },
    [activePresetId],
  );

  const updateSettings = <Key extends keyof CaptureSettings>(
    key: Key,
    value: CaptureSettings[Key],
  ) => {
    const nextValue =
      key === 'intervalTime'
        ? (Math.max(250, Number(value) || DEFAULT_SETTINGS.intervalTime) as CaptureSettings[Key])
        : value;
    setSettings((current) => ({ ...current, [key]: nextValue }));
  };

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/health'));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as BackendHealth;
      setBackendHealth(data);
      setHealthError(null);
      setHealthCheckedAt(formatClock());
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : 'Backend indisponivel');
      setBackendHealth(null);
      setHealthCheckedAt(formatClock());
    }
  }, []);

  const refreshObsHealth = useCallback(async () => {
    try {
      const params = new URLSearchParams({ sourceName });
      const response = await fetch(apiUrl(`/obs/health?${params.toString()}`));
      const data = (await response.json().catch(() => ({}))) as ObsHealth;
      setObsHealth(data);
      if (!response.ok || !data.ok) {
        setError(data.error || `OBS indisponivel: HTTP ${response.status}`);
      } else {
        setError((current) => (current?.startsWith('OBS') ? null : current));
      }
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OBS WebSocket indisponivel';
      const data: ObsHealth = {
        ok: false,
        connected: false,
        sourceReady: false,
        sourceName,
        currentScene: null,
        screenshotReady: false,
        error: message,
      };
      setObsHealth(data);
      setError(message);
      return data;
    }
  }, [sourceName]);

  const noteFrameMetadata = useCallback((frameHash?: string | null, capturedAt?: string | null) => {
    if (!frameHash) return;
    if (lastFrameHashRef.current === frameHash) {
      repeatedFrameCountRef.current += 1;
    } else {
      lastFrameHashRef.current = frameHash;
      repeatedFrameCountRef.current = 0;
      setFrameWarning(null);
      return;
    }

    if (repeatedFrameCountRef.current >= 3) {
      const when = capturedAt ? ` Capturado em ${new Date(capturedAt).toLocaleTimeString()}.` : '';
      setFrameWarning(
        `OBS retornou o mesmo frame ${repeatedFrameCountRef.current + 1} vezes.${when} Atualize a Browser Source se o chat estiver parado.`,
      );
    }
  }, []);

  const refreshObsPreview = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/obs/screenshot'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceName, format: 'png' }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        image?: string | null;
        width?: number | null;
        height?: number | null;
        frameHash?: string | null;
        capturedAt?: string | null;
        error?: string | null;
      };
      if (!response.ok || !data.ok || !data.image) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setPreviewImage(data.image);
      if (data.width && data.height) setPreviewSize({ width: data.width, height: data.height });
      noteFrameMetadata(data.frameHash, data.capturedAt);
      setStatus((current) => (current === CaptureStatus.CAPTURING ? current : CaptureStatus.SELECTING));
      setError(null);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao capturar preview OBS');
      setStatus(CaptureStatus.ERROR);
      return null;
    }
  }, [noteFrameMetadata, sourceName]);

  const clearCaptureTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleScreenShareEnded = useCallback(() => {
    clearCaptureTimer();
    screenStreamRef.current = null;
    setScreenStream(null);
    setStatus(CaptureStatus.IDLE);
    setIsProcessing(false);
    isBusyRef.current = false;
    setError('Compartilhamento da janela encerrado.');
  }, [clearCaptureTimer]);

  const stopScreenStream = useCallback(() => {
    const stream = screenStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    screenStreamRef.current = null;
    setScreenStream(null);
    if (livePreviewRef.current) {
      livePreviewRef.current.srcObject = null;
    }
  }, []);

  const requestScreenStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Captura de janela/tela nao esta disponivel neste navegador.');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', handleScreenShareEnded, { once: true });
    });
    screenStreamRef.current = stream;
    setScreenStream(stream);
    setPreviewImage(null);
    setFrameWarning(null);
    setError(null);
    return stream;
  }, [handleScreenShareEnded]);

  const updateDirectPageSize = useCallback(() => {
    const element = directWebviewRef.current || directIframeRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || element.clientWidth || 1));
    const height = Math.max(1, Math.round(rect.height || element.clientHeight || 1));
    const nextSize = { width, height };
    setPreviewSize(nextSize);
    return nextSize;
  }, []);

  useEffect(() => {
    zonesRef.current = zones;
  }, [zones]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    screenStreamRef.current = screenStream;
    const video = livePreviewRef.current;
    if (!video) return;
    if (!screenStream) {
      video.srcObject = null;
      return;
    }
    video.srcObject = screenStream;
    void video.play().catch(() => undefined);
  }, [screenStream]);

  useEffect(() => {
    return () => {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (captureMode !== 'obs') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(apiUrl('/obs/settings'));
          const data = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            settings?: { ocrSourceName?: unknown };
          };
          const nextSource = data.settings?.ocrSourceName;
          if (!cancelled && data.ok && typeof nextSource === 'string' && nextSource.trim()) {
            setSourceName(nextSource.trim());
          }
        } catch {
          // The local CaptureStudio state remains usable when settings are offline.
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [captureMode]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activePresetId,
        captureMode: captureMode === 'direct' ? 'direct' : 'screen',
        directUrl,
        presets,
        settings,
        sourceName,
      }),
    );
  }, [activePresetId, captureMode, directUrl, presets, settings, sourceName]);

  // ----- Webview diagnostic listeners (tasks 2 & 3) -----
  useEffect(() => {
    if (captureMode !== 'direct' || !directPageUrl) return;
    const webview = directWebviewRef.current;
    if (!webview) return;

    const addLog = (msg: string) => {
      const ts = formatClock();
      const line = `[${ts}] [LinkDireto] ${msg}`;
      setWebviewLogs((prev) => [...prev.slice(-80), line]);
      if (settings.debugMode) {
        // eslint-disable-next-line no-console
        console.log(line);
      }
    };

    addLog(`webview attached – src=${directPageUrl}`);

    addLog('Renderer escolhido: webview');
    addLog('webview anexado ao DOM');

    const onStartLoading = () => {
      addLog('did-start-loading');
      setDirectPageState('loading');
      setDirectCaptureState('available');
      setDirectCaptureError(null);
    };
    const onStopLoading = () => {
      addLog('did-stop-loading');
      updateDirectPageSize();
    };
    const onDomReady = () => {
      addLog('dom-ready');
      setDirectPageState('dom-ready');
      setDirectPageReady(false);
      setIsOpeningDirectLink(false);
      setDirectLinkStatus(`DOM pronto as ${formatClock()}`);
      updateDirectPageSize();
      setError(null);
      // Check capturePage availability
      const hasCapture = typeof webview.capturePage === 'function';
      addLog(`capturePage disponivel: ${hasCapture}`);
      setDirectCaptureState(hasCapture ? 'available' : 'unavailable');
    };
    const onFinishLoad = () => {
      addLog('did-finish-load');
      setDirectPageState('rendered');
      setDirectPageReady(true);
      setIsOpeningDirectLink(false);
      setDirectLinkStatus(`Renderizada as ${formatClock()}; teste a captura antes de iniciar OCR.`);
      updateDirectPageSize();
      setError(null);
    };
    const onFailLoad = (event: Event) => {
      const details = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        validatedURL?: string;
        isMainFrame?: boolean;
      };
      if (details.isMainFrame === false) return;
      addLog(
        `did-fail-load: errorCode=${details.errorCode ?? '?'}, ` +
        `errorDescription=${details.errorDescription ?? '?'}, ` +
        `validatedURL=${details.validatedURL ?? '?'}`,
      );
      setDirectPageState('failed');
      setDirectPageReady(false);
      setDirectCaptureState('unavailable');
      setIsOpeningDirectLink(false);
      setDirectLinkStatus(null);
      setError(details.errorDescription || 'Nao foi possivel carregar a pagina direta.');
    };
    const onConsoleMessage = (event: Event) => {
      const msg = (event as Event & { message?: string }).message;
      if (msg) addLog(`console-message da pagina: ${msg.slice(0, 200)}`);
    };
    const onCrashed = () => {
      addLog('CRASHED / render-process-gone');
      setDirectPageState('failed');
      setDirectPageReady(false);
      setDirectCaptureState('unavailable');
    };

    webview.addEventListener('did-start-loading', onStartLoading);
    webview.addEventListener('did-stop-loading', onStopLoading);
    webview.addEventListener('dom-ready', onDomReady);
    webview.addEventListener('did-finish-load', onFinishLoad);
    webview.addEventListener('did-fail-load', onFailLoad);
    webview.addEventListener('console-message', onConsoleMessage);
    webview.addEventListener('crashed', onCrashed);
    webview.addEventListener('render-process-gone', onCrashed);

    window.requestAnimationFrame(() => updateDirectPageSize());

    return () => {
      webview.removeEventListener('did-start-loading', onStartLoading);
      webview.removeEventListener('did-stop-loading', onStopLoading);
      webview.removeEventListener('dom-ready', onDomReady);
      webview.removeEventListener('did-finish-load', onFinishLoad);
      webview.removeEventListener('did-fail-load', onFailLoad);
      webview.removeEventListener('console-message', onConsoleMessage);
      webview.removeEventListener('crashed', onCrashed);
      webview.removeEventListener('render-process-gone', onCrashed);
    };
  }, [captureMode, directPageUrl, settings.debugMode, updateDirectPageSize]);

  useEffect(() => {
    if (!captureEvents.length || !eventsScrollRef.current) return;
    eventsScrollRef.current.scrollTop = eventsScrollRef.current.scrollHeight;
  }, [captureEvents.length]);

  useEffect(() => {
    const firstRun = window.setTimeout(refreshHealth, 0);
    const obsFirstRun =
      captureMode === 'obs'
        ? window.setTimeout(() => {
            void refreshObsHealth();
            void refreshObsPreview();
          }, 250)
        : null;
    const interval = window.setInterval(refreshHealth, 15000);
    const obsInterval =
      captureMode === 'obs' ? window.setInterval(refreshObsHealth, 15000) : null;
    return () => {
      window.clearTimeout(firstRun);
      if (obsFirstRun) window.clearTimeout(obsFirstRun);
      window.clearInterval(interval);
      if (obsInterval) window.clearInterval(obsInterval);
    };
  }, [captureMode, refreshHealth, refreshObsHealth, refreshObsPreview]);


  const pauseCapture = useCallback(() => {
    setStatus(CaptureStatus.IDLE);
    clearCaptureTimer();
  }, [clearCaptureTimer]);

  const changeCaptureMode = useCallback(
    (mode: CaptureSourceMode) => {
      if (mode === captureMode) return;
      clearCaptureTimer();
      setStatus(CaptureStatus.IDLE);
      setIsSelectingRegion(false);
      setCaptureMode(mode);
      setError(null);
      setFrameWarning(null);
      if (mode !== 'screen') {
        stopScreenStream();
        if (mode === 'direct') {
          setPreviewImage(null);
          setDirectPageMode('interact');
        }
      } else {
        setPreviewImage(null);
      }
      setDirectLinkStatus(null);
    },
    [captureMode, clearCaptureTimer, stopScreenStream],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const addZone = () => {
    if (zones.length >= MAX_ZONES) return;
    const nextZone: CaptureZone = {
      id: `zone-${Date.now()}`,
      name: `Zona ${zones.length + 1}`,
      role: 'custom',
      color: '#A78BFA',
      x: 140 + zones.length * 28,
      y: 140 + zones.length * 28,
      width: 300,
      height: 200,
    };
    updateActivePresetZones((currentZones) => [...currentZones, nextZone]);
    setActiveZoneIndex(zones.length);
  };

  const removeZone = (idx: number) => {
    if (zones.length <= 1) return;
    updateActivePresetZones((currentZones) => currentZones.filter((_, index) => index !== idx));
    setActiveZoneIndex((currentIndex) => Math.max(0, Math.min(currentIndex, zones.length - 2)));
  };

  const updateZone = (idx: number, patch: Partial<CaptureZone>) => {
    updateActivePresetZones((currentZones) =>
      currentZones.map((zone, index) => (index === idx ? { ...zone, ...patch } : zone)),
    );
  };

  const resetPreset = () => {
    const defaultPreset = DEFAULT_PRESETS.find((preset) => preset.id === activePresetId);
    if (!defaultPreset) return;
    updateActivePresetZones(clonePresets([defaultPreset])[0].zones);
    setActiveZoneIndex(0);
  };

  const downloadLog = () => {
    const content = capturedText.map((item) => `[${item.time}] ${item.text}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `captura_${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const getPreviewDimensions = () => {
    const liveVideo = livePreviewRef.current;
    const image = previewImageRef.current;
    const directElement = directWebviewRef.current || directIframeRef.current;
    const element =
      captureMode === 'screen' && liveVideo?.srcObject
        ? liveVideo
        : captureMode === 'direct'
          ? directElement
          : image;
    const width =
      captureMode === 'screen'
        ? liveVideo?.videoWidth || previewSize?.width || 0
        : captureMode === 'direct'
          ? previewSize?.width || directElement?.clientWidth || 0
          : image?.naturalWidth || previewSize?.width || 0;
    const height =
      captureMode === 'screen'
        ? liveVideo?.videoHeight || previewSize?.height || 0
        : captureMode === 'direct'
          ? previewSize?.height || directElement?.clientHeight || 0
          : image?.naturalHeight || previewSize?.height || 0;
    return { element, width, height };
  };

  const getMousePreviewCoords = (clientX: number, clientY: number) => {
    const { element, width, height } = getPreviewDimensions();
    if (!element || !width || !height) return null;
    const rect = element.getBoundingClientRect();

    const scale = Math.min(rect.width / width, rect.height / height);
    const displayedWidth = width * scale;
    const displayedHeight = height * scale;
    const offsetX = (rect.width - displayedWidth) / 2;
    const offsetY = (rect.height - displayedHeight) / 2;
    const imageLeft = rect.left + offsetX;
    const imageTop = rect.top + offsetY;
    const mouseX = clientX - imageLeft;
    const mouseY = clientY - imageTop;

    return {
      x: Math.max(0, Math.min(width, mouseX / scale)),
      y: Math.max(0, Math.min(height, mouseY / scale)),
    };
  };

  const getZoneOverlayStyle = (zone: CaptureZone) => {
    if (!previewSize?.width || !previewSize.height) return {};

    return {
      left: `${(zone.x / previewSize.width) * 100}%`,
      top: `${(zone.y / previewSize.height) * 100}%`,
      width: `${(zone.width / previewSize.width) * 100}%`,
      height: `${(zone.height / previewSize.height) * 100}%`,
    };
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!canEditZones) return;
    if (!isSelectingRegion) return;
    event.preventDefault();
    const coords = getMousePreviewCoords(event.clientX, event.clientY);
    if (!coords) return;
    setSelectionStart(coords);
    setCurrentSelection({ x: coords.x, y: coords.y, width: 0, height: 0 });
  };

  const startDraggingZone = (event: React.PointerEvent, idx: number) => {
    if (!canEditZones) return;
    if (isSelectingRegion) return;
    event.preventDefault();
    event.stopPropagation();
    const coords = getMousePreviewCoords(event.clientX, event.clientY);
    if (!coords) return;
    setDraggingZoneIndex(idx);
    setDragOffset({
      x: coords.x - zones[idx].x,
      y: coords.y - zones[idx].y,
    });
    setActiveZoneIndex(idx);
  };

  const startResizingZone = (event: React.PointerEvent, idx: number) => {
    if (!canEditZones) return;
    if (isSelectingRegion) return;
    event.preventDefault();
    event.stopPropagation();
    setResizingZoneIndex(idx);
    setActiveZoneIndex(idx);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!canEditZones) return;
    event.preventDefault();
    const coords = getMousePreviewCoords(event.clientX, event.clientY);
    if (!coords) return;

    if (isSelectingRegion && selectionStart) {
      const x = Math.min(selectionStart.x, coords.x);
      const y = Math.min(selectionStart.y, coords.y);
      const width = Math.abs(coords.x - selectionStart.x);
      const height = Math.abs(coords.y - selectionStart.y);
      setCurrentSelection({ x, y, width, height });
      return;
    }

    if (draggingZoneIndex !== null && dragOffset) {
      const dimensions = getPreviewDimensions();
      const imageWidth = dimensions.width || 10000;
      const imageHeight = dimensions.height || 10000;
      updateActivePresetZones((currentZones) => {
        const nextZones = [...currentZones];
        const zone = nextZones[draggingZoneIndex];
        const nextX = Math.max(0, Math.min(coords.x - dragOffset.x, imageWidth - zone.width));
        const nextY = Math.max(0, Math.min(coords.y - dragOffset.y, imageHeight - zone.height));
        nextZones[draggingZoneIndex] = { ...zone, x: nextX, y: nextY };
        return nextZones;
      });
      return;
    }

    if (resizingZoneIndex !== null) {
      updateActivePresetZones((currentZones) => {
        const nextZones = [...currentZones];
        const zone = nextZones[resizingZoneIndex];
        nextZones[resizingZoneIndex] = {
          ...zone,
          width: Math.max(24, coords.x - zone.x),
          height: Math.max(24, coords.y - zone.y),
        };
        return nextZones;
      });
    }
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (!canEditZones) return;
    event.preventDefault();

    if (draggingZoneIndex !== null || resizingZoneIndex !== null) {
      setDraggingZoneIndex(null);
      setResizingZoneIndex(null);
      setDragOffset(null);
      return;
    }

    if (!isSelectingRegion || !selectionStart || !currentSelection) return;

    if (currentSelection.width > 12 && currentSelection.height > 12) {
      updateActivePresetZones((currentZones) =>
        currentZones.map((zone, index) =>
          index === activeZoneIndex ? { ...zone, ...currentSelection } : zone,
        ),
      );
      if (status !== CaptureStatus.CAPTURING) {
        setStatus(CaptureStatus.SELECTING);
      }
    }

    setIsSelectingRegion(false);
    setSelectionStart(null);
    setCurrentSelection(null);
  };

  const addCaptureEvent = (event: CaptureEvent) => {
    setCaptureEvents((current) => [...current, event].slice(-MAX_EVENTS));
  };

  const captureZoneFromLiveVideo = useCallback((zone: CaptureZone) => {
    const video = livePreviewRef.current;
    const sourceWidth = video?.videoWidth || 0;
    const sourceHeight = video?.videoHeight || 0;
    if (!video || !sourceWidth || !sourceHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    const settingsSnapshot = settingsRef.current;
    const magnification = Math.max(1, Math.round(settingsSnapshot.magnification || 1));
    const left = Math.max(0, Math.min(sourceWidth - 1, Math.round(zone.x)));
    const top = Math.max(0, Math.min(sourceHeight - 1, Math.round(zone.y)));
    const width = Math.max(1, Math.min(sourceWidth - left, Math.round(zone.width)));
    const height = Math.max(1, Math.min(sourceHeight - top, Math.round(zone.height)));
    const canvas = captureCanvasRef.current || document.createElement('canvas');
    captureCanvasRef.current = canvas;
    canvas.width = width * magnification;
    canvas.height = height * magnification;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas OCR indisponivel neste navegador.');
    }

    context.imageSmoothingEnabled = false;
    context.filter = [
      'grayscale(1)',
      `contrast(${settingsSnapshot.contrast || 1})`,
      `brightness(${settingsSnapshot.brightness || 1})`,
    ].join(' ');
    context.drawImage(video, left, top, width, height, 0, 0, canvas.width, canvas.height);
    context.filter = 'none';
    return canvas.toDataURL('image/png');
  }, []);

  const captureZoneFromImage = useCallback(
    (
      image: HTMLImageElement,
      displaySize: { width: number; height: number },
      zone: CaptureZone,
    ) => {
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      if (!sourceWidth || !sourceHeight || !displaySize.width || !displaySize.height) {
        return null;
      }

      const scaleX = sourceWidth / displaySize.width;
      const scaleY = sourceHeight / displaySize.height;
      const settingsSnapshot = settingsRef.current;
      const magnification = Math.max(1, Math.round(settingsSnapshot.magnification || 1));
      const left = Math.max(0, Math.min(sourceWidth - 1, Math.round(zone.x * scaleX)));
      const top = Math.max(0, Math.min(sourceHeight - 1, Math.round(zone.y * scaleY)));
      const width = Math.max(1, Math.min(sourceWidth - left, Math.round(zone.width * scaleX)));
      const height = Math.max(1, Math.min(sourceHeight - top, Math.round(zone.height * scaleY)));
      const canvas = document.createElement('canvas');
      canvas.width = width * magnification;
      canvas.height = height * magnification;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas OCR indisponivel neste navegador.');
      }

      context.imageSmoothingEnabled = false;
      context.filter = [
        'grayscale(1)',
        `contrast(${settingsSnapshot.contrast || 1})`,
        `brightness(${settingsSnapshot.brightness || 1})`,
      ].join(' ');
      context.drawImage(image, left, top, width, height, 0, 0, canvas.width, canvas.height);
      context.filter = 'none';
      return canvas.toDataURL('image/png');
    },
    [],
  );

  const testDirectCapture = useCallback(async () => {
    const webview = directWebviewRef.current;
    if (!isElectronRuntime || directRenderer !== 'electron-webview') {
      const msg = 'Captura direta de pagina externa indisponivel no modo web. Use captura de tela do navegador, OBS ou proxy/iframe de preview.';
      setDirectCaptureState('unavailable');
      setDirectCaptureError(msg);
      addDirectLog(`[LinkDireto] capturePage disponivel: false`);
      return false;
    }
    if (!webview || typeof webview.capturePage !== 'function') {
      const msg = 'capturePage nao esta disponivel na superficie Electron.';
      setDirectCaptureState('failed');
      setDirectCaptureError(msg);
      addDirectLog(`[LinkDireto] capturePage disponivel: false`);
      return false;
    }

    addDirectLog(`[LinkDireto] capturePage disponivel: true`);
    let dataUrl = '';
    try {
      const captured = await webview.capturePage();
      dataUrl = captured.toDataURL();
    } catch (err) {
      const msg = `capturePage falhou: ${err instanceof Error ? err.message : 'erro desconhecido'}`;
      setDirectCaptureState('failed');
      setDirectCaptureError(msg);
      addDirectLog(`[LinkDireto] ${msg}`);
      return false;
    }

    try {
      const frame = await loadImageElement(dataUrl);
      const width = frame.naturalWidth || frame.width;
      const height = frame.naturalHeight || frame.height;
      addDirectLog(`[LinkDireto] screenshot capturado: ${width} x ${height}`);
      const zone = activeZone;
      const zoneInside = Boolean(
        zone &&
          width > 0 &&
          height > 0 &&
          zone.x >= 0 &&
          zone.y >= 0 &&
          zone.width > 0 &&
          zone.height > 0 &&
          zone.x + zone.width <= width &&
          zone.y + zone.height <= height,
      );
      addDirectLog(
        `[LinkDireto] zona ativa: ${Math.round(zone?.x || 0)}, ${Math.round(zone?.y || 0)}, ${Math.round(
          zone?.width || 0,
        )}, ${Math.round(zone?.height || 0)}`,
      );

      if (!width || !height || dataUrl.length < 64) {
        const msg =
          'Pagina carregada, mas captura retornou imagem vazia. Verifique se a superficie Electron esta ativa e visivel.';
        setDirectPageState('empty');
        setDirectCaptureState('failed');
        setDirectCaptureError(msg);
        addDirectLog(`[LinkDireto] ${msg}`);
        return false;
      }
      if (!zoneInside) {
        const msg = 'Zona ativa fora dos limites da imagem capturada.';
        setDirectCaptureState('failed');
        setDirectCaptureError(msg);
        addDirectLog(`[LinkDireto] ${msg}`);
        return false;
      }

      setDirectCapturePreview(dataUrl);
      setDirectCaptureSize({ width, height });
      setDirectCaptureState('tested');
      setDirectCaptureError(null);
      setDirectPageState('rendered');
      setDirectPageReady(true);
      setDirectLinkStatus(`Captura testada com sucesso: ${width}x${height}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Nao foi possivel validar a captura.';
      setDirectCaptureState('failed');
      setDirectCaptureError(msg);
      addDirectLog(`[LinkDireto] ${msg}`);
      return false;
    }
  }, [activeZone, addDirectLog, directRenderer, isElectronRuntime]);

  const runScreenOcrCycle = useCallback(async () => {
    const video = livePreviewRef.current;
    if (!video?.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setCurrentRawText('Aguardando frames da janela...');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }

    setPreviewSize({ width: video.videoWidth, height: video.videoHeight });
    const results: OcrResponse[] = [];
    for (const zone of zonesRef.current) {
      const image = captureZoneFromLiveVideo(zone);
      if (!image) continue;
      const response = await fetch(apiUrl('/ocr/process'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zone_id: zone.id,
          zone_name: zone.name,
          x: zone.x,
          y: zone.y,
          width: zone.width,
          height: zone.height,
          image,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as OcrResponse;
      results.push({
        ...result,
        error: response.ok ? result.error : result.error || `HTTP ${response.status}`,
        zone_id: result.zone_id || zone.id,
        zone_name: result.zone_name || zone.name,
      });
    }

    return {
      waiting: false,
      width: video.videoWidth,
      height: video.videoHeight,
      results,
    };
  }, [captureZoneFromLiveVideo]);

  const runDirectPageOcrCycle = useCallback(async () => {
    // --- Task 6: Validate Electron + webview before OCR ---
    if (!isElectronRuntime) {
      setCurrentRawText('No modo web, use captura de tela do navegador, OBS ou proxy/iframe para OCR.');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    const webview = directWebviewRef.current;
    if (!webview) {
      setCurrentRawText('Webview nao encontrado. Recarregue a pagina.');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    if (typeof webview.capturePage !== 'function') {
      const msg = 'capturePage nao esta disponivel neste webview. Verifique a versao do Electron.';
      setCurrentRawText(msg);
      setWebviewLogs((prev) => [...prev.slice(-60), `[${formatClock()}] [LinkDireto] ERRO: ${msg}`]);
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    if (!directPageReady) {
      setCurrentRawText('Aguardando carregamento da pagina direta...');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    if (directCaptureState !== 'tested') {
      setCurrentRawText('Teste a captura da pagina antes de iniciar o OCR automatico.');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }

    const size = updateDirectPageSize();
    if (!size) {
      setCurrentRawText('Aguardando area da pagina direta...');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }

    let captured: ElectronImage;
    try {
      captured = await webview.capturePage();
    } catch (err) {
      const msg = `capturePage falhou: ${err instanceof Error ? err.message : 'erro desconhecido'}`;
      setCurrentRawText(msg);
      setWebviewLogs((prev) => [...prev.slice(-60), `[${formatClock()}] [LinkDireto] ERRO: ${msg}`]);
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    const frameDataUrl = captured.toDataURL();
    const frame = await loadImageElement(frameDataUrl);
    const frameWidth = frame.naturalWidth || frame.width;
    const frameHeight = frame.naturalHeight || frame.height;
    addDirectLog(`[LinkDireto] screenshot capturado: ${frameWidth} x ${frameHeight}`);
    if (!frameWidth || !frameHeight || frameDataUrl.length < 64) {
      const msg =
        'Pagina carregada, mas captura retornou imagem vazia. Verifique se a superficie Electron esta ativa e visivel.';
      setDirectPageState('empty');
      setDirectCaptureState('failed');
      setDirectCaptureError(msg);
      addDirectLog(`[LinkDireto] ${msg}`);
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    const results: OcrResponse[] = [];

    for (const zone of zonesRef.current) {
      addDirectLog(
        `[LinkDireto] zona ativa: ${Math.round(zone.x)}, ${Math.round(zone.y)}, ${Math.round(zone.width)}, ${Math.round(
          zone.height,
        )}`,
      );
      const image = captureZoneFromImage(frame, size, zone);
      if (!image) continue;
      addDirectLog('[LinkDireto] OCR enviado para /ocr/process');
      const response = await fetch(apiUrl('/ocr/process'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zone_id: zone.id,
          zone_name: zone.name,
          x: zone.x,
          y: zone.y,
          width: zone.width,
          height: zone.height,
          image,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as OcrResponse;
      addDirectLog(
        result.text?.trim() || result.full_text?.trim()
          ? '[LinkDireto] OCR retornou texto encontrado'
          : '[LinkDireto] OCR retornou texto vazio',
      );
      results.push({
        ...result,
        error: response.ok ? result.error : result.error || `HTTP ${response.status}`,
        zone_id: result.zone_id || zone.id,
        zone_name: result.zone_name || zone.name,
      });
    }

    return {
      waiting: false,
      width: size.width,
      height: size.height,
      results,
    };
  }, [
    captureZoneFromImage,
    addDirectLog,
    directCaptureState,
    directPageReady,
    isElectronRuntime,
    updateDirectPageSize,
  ]);

  const scheduleNextCaptureCycle = useCallback(() => {
    timerRef.current = setTimeout(() => {
      void runCaptureCycleRef.current?.();
    }, settingsRef.current.intervalTime);
  }, []);

  const runCaptureCycle = useCallback(async () => {
    if (status !== CaptureStatus.CAPTURING) {
      return;
    }
    if (isBusyRef.current) {
      scheduleNextCaptureCycle();
      return;
    }

    try {
      isBusyRef.current = true;
      setIsProcessing(true);
      if (!zonesRef.current.length) {
        throw new Error('Nenhuma zona OCR configurada');
      }

      const requestStartedAt = performance.now();
      let data: ObsCycleResponse;
      if (captureMode === 'screen') {
        const screenData = await runScreenOcrCycle();
        if (screenData.waiting) return;
        data = {
          ok: true,
          sourceName: 'Janela/tela',
          width: screenData.width,
          height: screenData.height,
          results: screenData.results,
          latency_ms: Math.round(performance.now() - requestStartedAt),
          error: null,
        };
      } else if (captureMode === 'direct') {
        const directData = await runDirectPageOcrCycle();
        if (directData.waiting) return;
        data = {
          ok: true,
          sourceName: 'Pagina direta',
          width: directData.width,
          height: directData.height,
          results: directData.results,
          latency_ms: Math.round(performance.now() - requestStartedAt),
          error: null,
        };
      } else {
        const response = await fetch(apiUrl('/ocr/obs-cycle'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceName,
            zones: zonesRef.current,
            settings: settingsRef.current,
          }),
        });

        data = (await response.json().catch(() => ({}))) as ObsCycleResponse;
        if (!response.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }

        if (data.image) setPreviewImage(data.image);
        if (data.width && data.height) setPreviewSize({ width: data.width, height: data.height });
        noteFrameMetadata(data.frameHash, data.capturedAt);
      }

      const results = Array.isArray(data.results) ? data.results : [];
      for (const [index, result] of results.entries()) {
        const zone =
          zonesRef.current.find((candidate) => candidate.id === result.zone_id) ||
          zonesRef.current[index] ||
          zonesRef.current[0];
        if (!zone) continue;

        try {
          const fullText = result.full_text?.trim() || '';
          const newText = result.text?.trim() || '';
          const latencyMs =
            result.latency_ms ??
            data.latency_ms ??
            Math.round(performance.now() - requestStartedAt);
          const time = formatClock();

          if (zone.id === zonesRef.current[activeZoneIndex]?.id) {
            setCurrentRawText(fullText || '(nenhum texto detectado)');
            setLastCaptureTime(time);
          }

          if (result.error) {
            addCaptureEvent({
              id: makeEventId(),
              zoneId: zone.id,
              zoneName: zone.name,
              text: '',
              rawText: fullText,
              time,
              routeStatus: 'error',
              confidence: result.confidence ?? null,
              latencyMs,
              error: result.error,
              deduped: result.deduped,
              duplicateReason: result.duplicateReason,
              captureMode: result.captureMode,
              sourceHealth: result.sourceHealth,
            });
            setError(`OCR ${zone.name}: ${result.error}`);
            continue;
          }

          if (newText.length > 0) {
            const ingestText = `${result.zone_name || zone.name}: ${newText}`;
            let ingestResult: Record<string, unknown> | null = null;
            try {
              const ingestResponse = await fetch(apiUrl('/automation/ingest'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  text: ingestText,
                  source: 'ocr',
                  zoneName: result.zone_name || zone.name,
                  kind: kindFromZoneRole(zone.role),
                  execute: true,
                  maxActions: 6,
                  metadata: {
                    zoneId: result.zone_id || zone.id,
                    zoneRole: zone.role,
                    rawText: fullText,
                    confidence: result.confidence ?? null,
                    latencyMs,
                  },
                }),
              });
              ingestResult = (await ingestResponse.json().catch(() => ({}))) as Record<string, unknown>;
              if (!ingestResponse.ok || ingestResult?.error) {
                throw new Error(String(ingestResult?.error || `HTTP ${ingestResponse.status}`));
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Falha ao ingerir evento';
              addCaptureEvent({
                id: makeEventId(),
                zoneId: result.zone_id || zone.id,
                zoneName: result.zone_name || zone.name,
                text: newText,
                rawText: fullText,
                time,
                routeStatus: 'error',
                confidence: result.confidence ?? null,
                latencyMs,
                error: `Automation ingest: ${message}`,
                deduped: result.deduped,
                duplicateReason: result.duplicateReason,
                captureMode: result.captureMode,
                sourceHealth: result.sourceHealth,
              });
              setError(`Automation ingest: ${message}`);
              continue;
            }

            const captureEvent: CaptureEvent = {
              id: makeEventId(),
              zoneId: result.zone_id || zone.id,
              zoneName: result.zone_name || zone.name,
              text: newText,
              rawText: fullText,
              time,
              routeStatus: 'sent',
              confidence: result.confidence ?? null,
              latencyMs,
              deduped: result.deduped,
              duplicateReason: result.duplicateReason,
              captureMode: result.captureMode,
              sourceHealth: result.sourceHealth,
            };
            addCaptureEvent(captureEvent);
            const liveEvent = emitEvent({
              id: captureEvent.id,
              source: 'ocr',
              zoneName: captureEvent.zoneName,
              text: `${captureEvent.zoneName}: ${captureEvent.text}`,
              kind: kindFromZoneRole(zone.role),
              createdAt: new Date().toISOString(),
              time,
              metadata: {
                zoneId: captureEvent.zoneId,
                zoneRole: zone.role,
                rawText: captureEvent.rawText,
                confidence: captureEvent.confidence,
                latencyMs: captureEvent.latencyMs,
                backendIngested: true,
                automation: ingestResult,
              },
            });
            setCapturedText((current) =>
              [...current.filter((event) => event.id !== liveEvent.id), liveEvent].slice(
                MAX_PERSONA_MESSAGES * -1,
              ),
            );
            setError(null);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Erro desconhecido';
          const time = formatClock();
          addCaptureEvent({
            id: makeEventId(),
            zoneId: zone.id,
            zoneName: zone.name,
            text: '',
            rawText: '',
            time,
            routeStatus: 'error',
            confidence: null,
            latencyMs: null,
            error: message,
            captureMode,
          });
          if (index === activeZoneIndex) {
            setError(`Erro OCR: ${message}`);
          }
        }
      }
    } catch (err) {
      setError(`Erro no ciclo: ${err instanceof Error ? err.message : 'desconhecido'}`);
    } finally {
      setIsProcessing(false);
      isBusyRef.current = false;
      if (status === CaptureStatus.CAPTURING) {
        scheduleNextCaptureCycle();
      }
    }
  }, [
    activeZoneIndex,
    captureMode,
    noteFrameMetadata,
    runDirectPageOcrCycle,
    runScreenOcrCycle,
    scheduleNextCaptureCycle,
    setCapturedText,
    sourceName,
    status,
  ]);

  useEffect(() => {
    runCaptureCycleRef.current = runCaptureCycle;
  }, [runCaptureCycle]);

  const openDirectLink = useCallback(async () => {
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeDirectUrl(directUrl);
    } catch (err) {
      setStatus(CaptureStatus.ERROR);
      setError(err instanceof Error ? err.message : 'Link da live invalido.');
      return false;
    }

    setIsOpeningDirectLink(true);
    setDirectLinkStatus('Carregando pagina...');
    setDirectPageReady(false);
    setDirectPageState('loading');
    setDirectCaptureState(isElectronRuntime && canUseDirectWebCapture ? 'available' : 'unavailable');
    setDirectCapturePreview(null);
    setDirectCaptureSize(null);
    setDirectCaptureError(null);
    setDirectPageUrl(normalizedUrl);
    setDirectUrl(normalizedUrl);
    setDirectPageMode('interact');
    setPreviewImage(null);
    setFrameWarning(
      isElectronRuntime
        ? null
        : backendOnline
          ? null // proxy will handle it — no warning needed
          : 'Proxy do backend offline. A pagina pode ser bloqueada pelo site. Inicie o servidor backend para desbloquear.',
    );
    if (!isElectronRuntime) {
      setFrameWarning(
        'Modo web ativo: use captura de tela do navegador, OBS ou proxy/iframe para preview. OCR direto de pagina externa nao usa mais Electron.',
      );
    }
    addDirectLog(`[LinkDireto] URL solicitada: ${normalizedUrl}`);
    addDirectLog(
      `[LinkDireto] Renderer escolhido: ${
        isElectronRuntime ? 'webview' : backendOnline ? 'proxy preview' : 'iframe'
      }`,
    );
    lastOpenedDirectUrlRef.current = normalizedUrl;
    window.setTimeout(() => {
      updateDirectPageSize();
      setIsOpeningDirectLink(false);
    }, 0);
    setStatus((current) => (current === CaptureStatus.CAPTURING ? current : CaptureStatus.SELECTING));
    setError(
      isElectronRuntime
        ? null
        : 'Modo web ativo: para OCR use captura de tela do navegador, OBS ou uma zona de captura configurada.',
    );
    return true;
  }, [addDirectLog, backendOnline, canUseDirectWebCapture, directUrl, isElectronRuntime, updateDirectPageSize]);

  const startCapture = useCallback(async () => {
    lastFrameHashRef.current = null;
    repeatedFrameCountRef.current = 0;
    setFrameWarning(null);

    if (captureMode === 'screen') {
      try {
        if (!screenStreamRef.current?.active) {
          await requestScreenStream();
        }
        onStartAutopilot?.();
        setStatus(CaptureStatus.CAPTURING);
        setError(null);
      } catch (err) {
        setStatus(CaptureStatus.ERROR);
        setError(err instanceof Error ? err.message : 'Nao foi possivel iniciar a captura da janela.');
      }
      return;
    }

    if (captureMode === 'direct') {
      let normalizedUrl: string | null;
      try {
        normalizedUrl = hasDirectUrl ? normalizeDirectUrl(directUrl) : null;
      } catch (err) {
        setStatus(CaptureStatus.ERROR);
        setError(err instanceof Error ? err.message : 'Link da live invalido.');
        return;
      }

      if (normalizedUrl && (normalizedUrl !== lastOpenedDirectUrlRef.current || !sourceReady)) {
        const opened = await openDirectLink();
        if (!opened) return;
      }
      if (!isElectronRuntime) {
        setStatus(CaptureStatus.ERROR);
        setError('Modo web ativo: use captura de tela do navegador, OBS ou proxy/iframe para OCR.');
        addDirectLog('[LinkDireto] OCR bloqueado: runtime browser limitado');
        return;
      }
      if (!directReady || !directCaptureTested) {
        setStatus(CaptureStatus.ERROR);
        setError('Teste a captura da pagina antes de iniciar o OCR automatico.');
        addDirectLog('[LinkDireto] OCR bloqueado: captura ainda nao foi testada com sucesso');
        return;
      }
      onStartAutopilot?.();
      setStatus(CaptureStatus.CAPTURING);
      setError(null);
      return;
    }

    let health = await refreshObsHealth();
    const sourceNotRendering = health.sourceActive === false || health.sourceShowing === false;
    if (!health.ok || !health.connected || !health.sourceReady || !health.screenshotReady || sourceNotRendering) {
      try {
        setError(`Preparando a source "${sourceName}" no OBS...`);
        const repairResponse = await fetch(apiUrl('/obs/prepare-capture'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceName }),
        });
        const repair = (await repairResponse.json().catch(() => ({}))) as {
          ok?: boolean;
          health?: ObsHealth;
          error?: string | null;
        };
        if (!repairResponse.ok || !repair.ok) {
          throw new Error(repair.error || `HTTP ${repairResponse.status}`);
        }
        health = repair.health || (await refreshObsHealth());
        setObsHealth(health);
      } catch (err) {
        setStatus(CaptureStatus.ERROR);
        setError(
          err instanceof Error
            ? err.message
            : `Nao foi possivel preparar a source "${sourceName}" no OBS.`,
        );
        return;
      }
    }

    if (!health.ok || !health.connected || !health.sourceReady || !health.screenshotReady) {
      setStatus(CaptureStatus.ERROR);
      setError(
        health.error ||
          `Nao foi possivel iniciar a live assistida: a source "${sourceName}" nao esta pronta no OBS.`,
      );
      return;
    }
    if (health.sourceActive === false || health.sourceShowing === false) {
      setFrameWarning('A source OBS ainda nao reportou renderizacao ativa; o OCR vai tentar usar o frame disponivel.');
    }
    const preview = await refreshObsPreview();
    if (!preview) return;
    onStartAutopilot?.();
    setStatus(CaptureStatus.CAPTURING);
    setError(null);
  }, [
    captureMode,
    directUrl,
    hasDirectUrl,
    directCaptureTested,
    directReady,
    addDirectLog,
    isElectronRuntime,
    onStartAutopilot,
    openDirectLink,
    refreshObsHealth,
    refreshObsPreview,
    requestScreenStream,
    sourceName,
    sourceReady,
  ]);

  // Listen for start-live events to initiate capture when user clicks "Iniciar Live"
  useEffect(() => {
    const handler = () => {
      if (status === CaptureStatus.CAPTURING) return;
      void startCapture();
    };

    window.addEventListener('odessa:start-live', handler as EventListener);
    return () => window.removeEventListener('odessa:start-live', handler as EventListener);
  }, [startCapture, status]);

  useEffect(() => {
    if (status === CaptureStatus.CAPTURING) {
      timerRef.current = setTimeout(() => {
        void runCaptureCycleRef.current?.();
      }, 0);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status]);

  const pipeline = [
    {
      label:
        captureMode === 'screen'
          ? screenReady
            ? 'Janela ao vivo'
            : 'Selecionar janela'
          : captureMode === 'direct'
            ? directReady
              ? 'Pagina renderizada'
              : directPageUrl
                ? `Pagina: ${directPageState}`
                : 'Abrir link direto'
            : obsReady
              ? 'OBS Source pronta'
              : 'OBS Source pendente',
      icon: captureMode === 'screen' ? Camera : captureMode === 'direct' ? Link2 : Wifi,
      active: sourceReady,
    },
    { label: `${zones.length} zonas`, icon: Layers, active: zones.length > 0 },
    {
      label:
        captureMode === 'direct'
          ? directCaptureTested
            ? 'Captura testada'
            : 'Captura pendente'
          : backendOnline
            ? 'OCR backend online'
            : 'OCR backend offline',
      icon: ScanText,
      active: captureMode === 'direct' ? directCaptureTested : backendOnline,
    },
    {
      label: autopilotEnabled ? 'Autopilot ativo' : 'Autopilot liga ao iniciar',
      icon: Bot,
      active: autopilotEnabled,
    },
    {
      label: `${pendingAutopilotEvents} pendentes`,
      icon: FileText,
      active: pendingAutopilotEvents > 0,
    },
    {
      label: latestAutopilotActionStatus ? `Acao ${latestAutopilotActionStatus}` : 'Sem acao ainda',
      icon: Zap,
      active: Boolean(latestAutopilotActionStatus),
    },
  ];

  return (
    <main className="flex-1 overflow-y-auto bg-[var(--bg)] text-[var(--t1)] xl:overflow-hidden">
      <canvas ref={captureCanvasRef} className="hidden" aria-hidden="true" />
      <div className="grid min-h-full grid-cols-1 xl:h-full xl:grid-cols-[304px_minmax(0,1fr)_372px]">
        <aside className="border-b border-[var(--odessa-border)] bg-[var(--odessa-surface)] p-4 xl:overflow-y-auto xl:border-b-0 xl:border-r">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--t3)]">
                Capture Studio
              </p>
              <h2 className="mt-1 text-lg font-black text-[var(--t1)]">Extrator OCR</h2>
            </div>
            <StatusChip
              label={status === CaptureStatus.CAPTURING ? 'Live' : 'Standby'}
              tone={status === CaptureStatus.CAPTURING ? 'good' : 'idle'}
              icon={<Activity className="h-3.5 w-3.5" />}
            />
          </div>

          <section className="space-y-3 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--t3)]">Fonte</h3>
              <button
                onClick={() => {
                  void refreshHealth();
                  if (captureMode === 'obs') {
                    void refreshObsHealth();
                    void refreshObsPreview();
                  } else if (captureMode === 'direct') {
                    directWebviewRef.current?.reload?.();
                    updateDirectPageSize();
                  }
                }}
                className="rounded-md p-1.5 text-[var(--t3)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)]"
                title="Atualizar fonte"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => changeCaptureMode('screen')}
                  className={cn(
                    'rounded-md border px-3 py-2 text-xs font-black transition',
                    captureMode === 'screen'
                      ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-100'
                      : 'border-[var(--border)] bg-[var(--bg1)]/50 text-[var(--t3)] hover:border-[var(--border2)]',
                  )}
                >
                  Janela/tela
                </button>
                <button
                  type="button"
                  onClick={() => changeCaptureMode('obs')}
                  className={cn(
                    'rounded-md border px-3 py-2 text-xs font-black transition',
                    captureMode === 'obs'
                      ? 'border-sky-400/50 bg-sky-500/15 text-sky-100'
                      : 'border-[var(--border)] bg-[var(--bg1)]/50 text-[var(--t3)] hover:border-[var(--border2)]',
                  )}
                >
                  OBS
                </button>
                <button
                  type="button"
                  onClick={() => changeCaptureMode('direct')}
                  className={cn(
                    'rounded-md border px-2 py-2 text-xs font-black transition',
                    captureMode === 'direct'
                      ? 'border-violet-400/50 bg-violet-500/15 text-violet-100'
                      : 'border-[var(--border)] bg-[var(--bg1)]/50 text-[var(--t3)] hover:border-[var(--border2)]',
                  )}
                >
                  Link direto
                </button>
              </div>
              {captureMode === 'screen' ? (
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--t3)]">
                    Captura em tempo real
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[var(--t3)]">
                    Selecione a janela do TikTok/Live Studio para recortar o chat direto do video ao vivo.
                  </p>
                  <button
                    type="button"
                    onClick={() => void requestScreenStream()}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--bg3)] px-3 py-2 text-xs font-black text-[var(--t1)] transition hover:bg-[var(--bg4)]"
                  >
                    <Camera className="h-4 w-4" />
                    {screenReady ? 'Trocar janela' : 'Selecionar janela'}
                  </button>
                </div>
              ) : captureMode === 'obs' ? (
                <>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--t3)]">
                    Source OCR
                  </label>
                  <input
                    aria-label="Source OCR"
                    value={sourceName}
                    onChange={(event) => setSourceName(event.target.value)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--bg1)]/70 px-3 py-2 text-xs font-bold text-[var(--t1)] outline-none transition focus:border-sky-400"
                  />
                </>
              ) : (
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--t3)]">
                    Link da live
                  </label>
                  <input
                    aria-label="Link da live"
                    value={directUrl}
                    onChange={(event) => {
                      setDirectUrl(event.target.value);
                      setDirectLinkStatus(null);
                    }}
                    placeholder="https://..."
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--bg1)]/70 px-3 py-2 text-xs font-bold text-[var(--t1)] outline-none transition focus:border-violet-400"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => void openDirectLink()}
                      disabled={!hasDirectUrl || isOpeningDirectLink}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-violet-500 px-3 py-2 text-xs font-black text-[var(--t1)] transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Link2 className="h-4 w-4" />
                      {isOpeningDirectLink ? 'Abrindo' : 'Abrir nesta tela'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        directWebviewRef.current?.reload?.();
                        setDirectPageReady(false);
                        setDirectPageState(directPageUrl ? 'loading' : 'none');
                        setDirectCaptureState('available');
                        setDirectCapturePreview(null);
                        setDirectCaptureSize(null);
                        setDirectCaptureError(null);
                        setDirectLinkStatus('Recarregando pagina...');
                        window.requestAnimationFrame(() => updateDirectPageSize());
                      }}
                      disabled={!directPageUrl}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--bg3)] px-3 py-2 text-xs font-black text-[var(--t1)] transition hover:bg-[var(--bg4)]"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Recarregar
                    </button>
                    <button
                      type="button"
                      onClick={() => void testDirectCapture()}
                      disabled={!isElectronRuntime || !directPageUrl || directPageState !== 'rendered'}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ScanText className="h-4 w-4" />
                      Testar captura
                    </button>
                  </div>
                  {directLinkStatus && (
                    <p className="truncate text-xs font-semibold text-emerald-300">
                      {directLinkStatus}
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-wide">
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-2 text-[var(--t3)]">
                  <p>
                    {captureMode === 'screen' ? 'Janela' : captureMode === 'direct' ? 'Link' : 'OBS'}
                  </p>
                  <p
                    className={cn(
                      'mt-1',
                      captureMode === 'screen'
                        ? screenReady
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                        : captureMode === 'direct'
                          ? directPageUrl
                            ? directReady
                              ? 'text-emerald-300'
                              : 'text-amber-300'
                            : 'text-[var(--t3)]'
                        : sourceReady
                          ? 'text-emerald-300'
                          : obsHealth?.connected
                            ? 'text-amber-300'
                            : 'text-rose-300',
                    )}
                  >
                    {captureMode === 'screen'
                      ? screenReady
                        ? 'ao vivo'
                        : 'pendente'
                      : captureMode === 'direct'
                        ? directPageUrl
                          ? directReady
                            ? 'aberto'
                            : 'carregando'
                          : 'pendente'
                      : sourceReady
                        ? 'pronto'
                        : obsHealth?.connected
                          ? 'conectado'
                          : 'offline'}
                  </p>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-2 text-[var(--t3)]">
                  <p>{captureMode === 'direct' ? 'Captura' : 'OCR'}</p>
                  <p
                    className={cn(
                      'mt-1',
                      captureMode === 'direct'
                        ? directCaptureTested
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                        : backendOnline
                          ? 'text-emerald-300'
                          : 'text-amber-300',
                    )}
                  >
                    {captureMode === 'direct'
                      ? directCaptureTested
                        ? 'testada'
                        : 'indisponivel'
                      : backendOnline
                        ? 'backend online'
                        : 'pendente'}
                  </p>
                </div>
              </div>
              {captureMode === 'obs' && obsHealth?.currentScene && (
                <p className="truncate text-xs text-[var(--t3)]">Cena atual: {obsHealth.currentScene}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void startCapture()}
                disabled={!canStartCapture}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-4 w-4 fill-current" />
                Iniciar
              </button>
              <button
                onClick={pauseCapture}
                disabled={status !== CaptureStatus.CAPTURING}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--bg3)] px-3 py-2 text-xs font-black text-[var(--t1)] transition hover:bg-[var(--bg4)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Pause className="h-4 w-4" />
                Pausar
              </button>
            </div>
            {captureMode === 'obs' && obsHealth?.error && (
              <p className="text-xs leading-5 text-amber-300">{obsHealth.error}</p>
            )}
          </section>

          <section className="mt-4 space-y-3 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--t3)]">
                Presets
              </h3>
              <button
                onClick={resetPreset}
                className="rounded-md p-1.5 text-[var(--t3)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)]"
                title="Restaurar preset"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => {
                    setActivePresetId(preset.id);
                    setActiveZoneIndex(0);
                  }}
                  className={cn(
                    'w-full rounded-md border p-3 text-left transition',
                    activePresetId === preset.id
                      ? 'border-sky-400/60 bg-sky-500/10'
                      : 'border-[var(--border)] bg-[var(--bg1)]/40 hover:border-[var(--border2)]',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-[var(--t1)]">{preset.name}</span>
                    <span className="rounded bg-[var(--bg2)] px-2 py-0.5 text-[10px] font-bold text-[var(--t3)]">
                      {preset.zones.length} zonas
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-4 text-[var(--t3)]">
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-4 space-y-3 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--t3)]">Zonas</h3>
              <button
                onClick={addZone}
                disabled={zones.length >= MAX_ZONES}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--bg3)] px-2 py-1 text-xs font-bold text-[var(--t1)] transition hover:bg-[var(--bg4)] disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Nova
              </button>
            </div>
            <div className="space-y-2">
              {zones.map((zone, index) => (
                <div
                  key={zone.id}
                  className={cn(
                    'flex items-stretch rounded-md border transition',
                    activeZoneIndex === index
                      ? 'border-sky-400/60 bg-sky-500/10'
                      : 'border-[var(--border)] bg-[var(--bg1)]/40 hover:border-[var(--border2)]',
                  )}
                >
                  <button
                    onClick={() => setActiveZoneIndex(index)}
                    className="min-w-0 flex-1 p-2.5 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: zone.color }}
                      />
                      <span className="truncate text-sm font-bold text-[var(--t1)]">{zone.name}</span>
                    </span>
                    <span className="mt-1 block font-mono text-[10px] text-[var(--t3)]">
                      {Math.round(zone.width)}x{Math.round(zone.height)} px
                    </span>
                  </button>
                  {zones.length > 1 && (
                    <button
                      onClick={() => removeZone(index)}
                      className="border-l border-[var(--border)] px-2 text-[var(--t3)] transition hover:bg-rose-500/10 hover:text-rose-300"
                      title={`Remover ${zone.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {activeZone && (
              <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-3">
                <label className="block text-xs font-semibold text-[var(--t3)]">
                  Nome da zona
                  <input
                    value={activeZone.name}
                    onChange={(event) => updateZone(activeZoneIndex, { name: event.target.value })}
                    className="mt-1 w-full rounded-md border border-[var(--border2)] bg-[var(--bg1)] px-2 py-1.5 text-sm font-semibold text-[var(--t1)] outline-none focus:border-sky-400"
                  />
                </label>
                <label className="block text-xs font-semibold text-[var(--t3)]">
                  Tipo
                  <select
                    value={activeZone.role}
                    onChange={(event) =>
                      updateZone(activeZoneIndex, {
                        role: event.target.value as CaptureZone['role'],
                      })
                    }
                    className="mt-1 w-full rounded-md border border-[var(--border2)] bg-[var(--bg1)] px-2 py-1.5 text-sm font-semibold text-[var(--t1)] outline-none focus:border-sky-400"
                  >
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </section>

          <section className="mt-4 space-y-4 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-[var(--t3)]" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--t3)]">OCR</h3>
            </div>
            <SliderControl
              label="Contraste"
              value={settings.contrast}
              min={1}
              max={4}
              step={0.1}
              onChange={(value) => updateSettings('contrast', value)}
            />
            <SliderControl
              label="Luminosidade"
              value={settings.brightness}
              min={0.5}
              max={2}
              step={0.1}
              onChange={(value) => updateSettings('brightness', value)}
            />
            <SliderControl
              label="Zoom"
              value={settings.magnification}
              min={1}
              max={8}
              step={1}
              suffix="x"
              onChange={(value) => updateSettings('magnification', value)}
            />
            <SliderControl
              label="Intervalo"
              value={settings.intervalTime}
              min={250}
              max={5000}
              step={50}
              suffix="ms"
              onChange={(value) => updateSettings('intervalTime', value)}
            />
            <label className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--bg1)]/40 px-3 py-2 text-xs font-semibold text-[var(--t2)]">
              Console debug
              <input
                type="checkbox"
                checked={settings.debugMode}
                onChange={(event) => updateSettings('debugMode', event.target.checked)}
                className="accent-sky-400"
              />
            </label>
          </section>
        </aside>

        <section className="flex min-h-[720px] flex-col bg-[var(--bg)] xl:min-h-0">
          <div className="border-b border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {pipeline.map((step, index) => {
                const Icon = step.icon;
                return (
                  <React.Fragment key={step.label}>
                    <span
                      className={cn(
                        'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-black',
                        step.active
                          ? 'border-sky-400/30 bg-sky-500/10 text-sky-100'
                          : 'border-[var(--border)] bg-[var(--bg1)]/50 text-[var(--t3)]',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {step.label}
                    </span>
                    {index < pipeline.length - 1 && (
                      <span className="hidden text-slate-700 sm:inline">/</span>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div className="flex min-h-[420px] flex-1 flex-col border-b border-[var(--border)] bg-black">
            {/* Task 1: Runtime mode status indicator */}
            {captureMode === 'direct' && (
              <div
                className={cn(
                  'flex items-center gap-2 border-b px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide',
                  isElectronRuntime
                    ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                    : backendOnline
                      ? 'border-sky-400/20 bg-sky-500/10 text-sky-200'
                      : 'border-amber-400/20 bg-amber-500/10 text-amber-200',
                )}
              >
                {isElectronRuntime ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    MODO LEGADO: ELECTRON WEBVIEW
                  </>
                ) : false ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Preview proxy experimental indisponivel para OCR
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3.5 w-3.5" />
                    MODO WEB: use captura de tela, OBS ou proxy/iframe para fontes externas.
                  </>
                )}
              </div>
            )}
            {captureMode === 'direct' && (
              <div className="grid gap-px border-b border-[var(--border)] bg-[var(--bg3)] text-[10px] font-bold uppercase tracking-wide sm:grid-cols-4">
                <div className="bg-[#0B1018] px-3 py-2 text-[var(--t3)]">
                  Runtime
                  <span className="mt-1 block text-xs text-[var(--t1)]">
                    {isElectronRuntime ? 'Electron legado' : 'Web'}
                  </span>
                </div>
                <div className="bg-[#0B1018] px-3 py-2 text-[var(--t3)]">
                  Renderer da pagina
                  <span className="mt-1 block text-xs text-[var(--t1)]">
                    {directRenderer === 'electron-webview'
                      ? 'Electron WebView legado'
                      : directRenderer === 'proxy-preview'
                          ? 'Proxy preview'
                          : directRenderer === 'iframe'
                            ? 'Iframe'
                            : 'Nenhum'}
                  </span>
                </div>
                <div className="bg-[#0B1018] px-3 py-2 text-[var(--t3)]">
                  Pagina
                  <span className="mt-1 block text-xs text-[var(--t1)]">{directPageState}</span>
                </div>
                <div className="bg-[#0B1018] px-3 py-2 text-[var(--t3)]">
                  Captura
                  <span className="mt-1 block text-xs text-[var(--t1)]">{directCaptureState}</span>
                </div>
              </div>
            )}
            {frameWarning && (
              <div className="flex items-center gap-2 border-b border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-100">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{frameWarning}</span>
              </div>
            )}
            {hasPreview && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[#111722] px-4 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[var(--t3)]">
                  <Crosshair className="h-4 w-4 text-sky-300" />
                  <span>Zona ativa</span>
                  <select
                    value={activeZoneIndex}
                    onChange={(event) => setActiveZoneIndex(Number(event.target.value))}
                    className="rounded-md border border-[var(--border2)] bg-[var(--bg1)] px-2 py-1 text-xs font-black text-[var(--t1)] outline-none focus:border-sky-400"
                  >
                    {zones.map((zone, index) => (
                      <option key={zone.id} value={index}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {captureMode === 'direct' && (
                    <button
                      type="button"
                      onClick={() => {
                        setDirectPageMode((current) => (current === 'interact' ? 'crop' : 'interact'));
                        setIsSelectingRegion(false);
                        setCurrentSelection(null);
                      }}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-black transition',
                        directPageMode === 'interact'
                          ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-300'
                          : 'bg-sky-500 text-slate-950 hover:bg-sky-300',
                      )}
                    >
                      {directPageMode === 'interact' ? (
                        <MousePointer2 className="h-3.5 w-3.5" />
                      ) : (
                        <Crosshair className="h-3.5 w-3.5" />
                      )}
                      {directPageMode === 'interact' ? 'Interagir' : 'Editar recorte'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (captureMode === 'direct') setDirectPageMode('crop');
                      setIsSelectingRegion((current) => !current);
                    }}
                    disabled={!canEditZones && captureMode !== 'direct'}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-black transition',
                      isSelectingRegion
                        ? 'bg-rose-500 text-[var(--t1)]'
                        : 'bg-[var(--bg3)] text-[var(--t1)] hover:bg-[var(--bg4)]',
                    )}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                    {isSelectingRegion ? 'Cancelar recorte' : 'Desenhar recorte'}
                  </button>
                </div>
              </div>
            )}

            <div
              className={cn(
                'relative flex flex-1 items-center justify-center overflow-hidden',
                isSelectingRegion ? 'cursor-crosshair' : '',
              )}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              {hasPreview ? (
                <>
                  <div
                    className={cn(
                      'relative max-h-full max-w-full',
                      captureMode === 'direct' ? 'h-full w-full' : 'inline-flex',
                    )}
                  >
                    {captureMode === 'screen' ? (
                      <video
                        ref={livePreviewRef}
                        autoPlay
                        muted
                        playsInline
                        className="block max-h-full max-w-full object-contain"
                        onLoadedMetadata={(event) => {
                          const video = event.currentTarget;
                          if (video.videoWidth && video.videoHeight) {
                            setPreviewSize({ width: video.videoWidth, height: video.videoHeight });
                          }
                          void video.play().catch(() => undefined);
                        }}
                      />
                    ) : captureMode === 'direct' ? (
                      isElectronRuntime ? (
                        <webview
                          ref={directWebviewRef as unknown as React.RefObject<HTMLWebViewElement>}
                          src={directPageUrl}
                          partition="persist:odessa-capture"
                          allowpopups
                          useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                          webpreferences="contextIsolation=yes,nodeIntegration=no,javascript=yes"
                          onError={() => {
                            addDirectLog('[LinkDireto] did-fail-load: code=?, description=webview error, url=?');
                            setDirectPageState('failed');
                            setDirectPageReady(false);
                            setDirectCaptureState('unavailable');
                            setError('A superficie Electron falhou ao carregar a pagina.');
                          }}
                          style={{
                            position: 'absolute' as const,
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            minWidth: '100%',
                            minHeight: '100%',
                            display: 'flex',
                            background: '#fff',
                            zIndex: 0,
                            pointerEvents: directPageMode === 'crop' ? 'none' : 'auto',
                          }}
                        />
                      ) : (
                        /* Browser fallback: proxy strips X-Frame-Options/CSP so the page loads */
                        <div className="flex h-full w-full flex-col">
                          {!backendOnline && (
                            <div className="flex items-center gap-2 border-b border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-100">
                              <AlertCircle className="h-4 w-4 shrink-0" />
                              <span>
                                Backend offline — o proxy nao esta disponivel. Inicie o servidor para carregar a pagina ou use captura de tela/OBS.
                              </span>
                            </div>
                          )}
                          <iframe
                            ref={directIframeRef}
                            title="Pagina direta para captura"
                            src={proxyIframeUrl}
                            className="block flex-1 border-0 bg-white"
                            onLoad={() => {
                              setDirectPageReady(false);
                              setDirectPageState('dom-ready');
                              setDirectCaptureState('unavailable');
                              setDirectLinkStatus('Preview limitado carregado; OCR direto indisponivel no navegador comum.');
                              addDirectLog('[LinkDireto] iframe/proxy preview carregado');
                              updateDirectPageSize();
                            }}
                            onError={() => {
                              setDirectPageReady(false);
                              setDirectPageState('failed');
                              setDirectCaptureState('unavailable');
                              addDirectLog('[LinkDireto] did-fail-load: iframe/proxy preview falhou');
                              setError(
                                backendOnline
                                  ? 'O proxy nao conseguiu carregar a pagina. Tente o app desktop.'
                                  : 'Backend offline. Inicie o servidor e tente novamente.',
                              );
                            }}
                          />
                          <div className="flex items-center gap-3 border-t border-[var(--border)] bg-[#111722] px-4 py-2">
                            <button
                              type="button"
                              onClick={() => window.open(directPageUrl, '_blank', 'noopener')}
                              className="inline-flex items-center gap-2 rounded-md bg-[var(--bg3)] px-3 py-1.5 text-xs font-black text-[var(--t1)] transition hover:bg-[var(--bg4)]"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                              Abrir no navegador externo
                            </button>
                            <span className="text-[10px] text-[var(--t3)]">
                              {backendOnline
                                ? 'Preview experimental via proxy; OCR direto somente no app desktop'
                                : 'Backend offline; use Abrir no navegador externo'}
                            </span>
                          </div>
                        </div>
                      )
                    ) : (
                      <img
                        ref={previewImageRef}
                        src={previewImage || undefined}
                        alt="Preview da source OCR do OBS"
                        className="block max-h-full max-w-full object-contain"
                        onLoad={(event) => {
                          const image = event.currentTarget;
                          if (image.naturalWidth && image.naturalHeight) {
                            setPreviewSize({ width: image.naturalWidth, height: image.naturalHeight });
                          }
                        }}
                      />
                    )}
                    {isSelectingRegion && canEditZones && (
                      <div className="pointer-events-none absolute inset-0 z-10 bg-black/45">
                        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm font-black uppercase tracking-[0.22em] text-[var(--t1)]/55">
                          Arraste para redefinir {activeZone?.name || 'a zona'}
                        </div>
                      </div>
                    )}
                    {/* Task 5: Zone overlay — pointer-events depend on mode */}
                    <div
                      className="absolute inset-0 z-20"
                      style={{
                        pointerEvents:
                          captureMode === 'direct' && directPageMode === 'interact'
                            ? 'none'
                            : canEditZones
                              ? 'auto'
                              : 'none',
                      }}
                    >
                      {zones.map((zone, index) => (
                        <div
                          key={zone.id}
                          onPointerDown={(event) => startDraggingZone(event, index)}
                          className={cn(
                            'absolute border-2 transition-colors',
                            canEditZones ? 'pointer-events-auto' : 'pointer-events-none',
                            isSelectingRegion ? 'cursor-default' : 'cursor-move',
                            activeZoneIndex === index
                              ? 'shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]'
                              : 'opacity-80',
                            isSelectingRegion && activeZoneIndex === index ? 'hidden' : '',
                          )}
                          style={{
                            ...getZoneOverlayStyle(zone),
                            borderColor: zone.color,
                          }}
                        >
                          <span
                            className="absolute -top-7 left-0 rounded-t px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-950"
                            style={{ backgroundColor: zone.color }}
                          >
                            {zone.name}
                          </span>
                          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-[var(--t1)]">
                            {Math.round(zone.width)}x{Math.round(zone.height)}
                          </span>
                          {!isSelectingRegion && canEditZones && (
                            <div
                              onPointerDown={(event) => startResizingZone(event, index)}
                              className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize rounded-tl"
                              style={{ backgroundColor: zone.color }}
                            />
                          )}
                        </div>
                      ))}

                      {isSelectingRegion && currentSelection && previewSize && (
                        <div
                          className="absolute border-2 border-white bg-white/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                          style={getZoneOverlayStyle({
                            ...currentSelection,
                            id: 'selection',
                            name: 'Selecao',
                            role: 'custom',
                            color: '#FFFFFF',
                          })}
                        />
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
                  <div className="rounded-full border border-[var(--border)] bg-[var(--bg1)] p-5">
                    <Camera className="h-11 w-11 text-[var(--t4)]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-[var(--t1)]">
                      {captureMode === 'screen'
                        ? 'Selecione a janela do chat'
                        : captureMode === 'direct'
                          ? 'Abra o link da live'
                          : 'Conecte a source do OBS'}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--t3)]">
                      {captureMode === 'screen'
                        ? 'Use a captura de janela/tela para ver o chat se movendo em tempo real, ajustar as zonas e iniciar os gatilhos.'
                        : captureMode === 'direct'
                          ? 'Cole o link, abra a pagina aqui, interaja normalmente e alterne para editar o recorte quando precisar.'
                          : 'Atualize o preview da source dedicada, ajuste as zonas e inicie a leitura para alimentar a Persona em tempo real.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-px bg-[var(--bg3)] lg:grid-cols-4">
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--t3)]">
                <Clock3 className="h-4 w-4" />
                Ultima captura
              </div>
              <p className="mt-2 font-mono text-lg font-black text-[var(--t1)]">{lastCaptureTime}</p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--t3)]">
                <Gauge className="h-4 w-4" />
                Latencia media
              </div>
              <p className="mt-2 font-mono text-lg font-black text-[var(--t1)]">
                {successfulEvents.length ? `${Math.round(averageLatency)}ms` : '0ms'}
              </p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--t3)]">
                <Zap className="h-4 w-4" />
                Confianca OCR
              </div>
              <p className="mt-2 font-mono text-lg font-black text-[var(--t1)]">
                {successfulEvents.length ? `${Math.round(averageConfidence * 100)}%` : '0%'}
              </p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--t3)]">
                <Activity className="h-4 w-4" />
                Ciclo
              </div>
              <p className="mt-2 font-mono text-lg font-black text-[var(--t1)]">
                {isProcessing ? 'Processando' : `${settings.intervalTime}ms`}
              </p>
            </div>
          </div>
        </section>

        <aside className="border-t border-[var(--odessa-border)] bg-[var(--odessa-surface)] xl:overflow-y-auto xl:border-l xl:border-t-0">
          <div className="space-y-4 p-4">
            <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-[var(--t1)]">Backend local</h3>
                  <p className="mt-1 text-xs text-[var(--t3)]">Verificado as {healthCheckedAt}</p>
                </div>
                <StatusChip
                  label={backendOnline ? 'online' : 'offline'}
                  tone={backendOnline ? 'good' : 'danger'}
                  icon={
                    backendOnline ? (
                      <Wifi className="h-3.5 w-3.5" />
                    ) : (
                      <WifiOff className="h-3.5 w-3.5" />
                    )
                  }
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-2">
                  <p className="text-[10px] font-bold uppercase text-[var(--t3)]">OCR</p>
                  <p className="mt-1 text-xs font-black text-[var(--t1)]">
                    {backendHealth?.ocr || '-'}
                  </p>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-2">
                  <p className="text-[10px] font-bold uppercase text-[var(--t3)]">IA</p>
                  <p className="mt-1 text-xs font-black text-[var(--t1)]">
                    {backendHealth?.gemini_configured
                      ? 'Gemini'
                      : backendHealth?.openai_ai_configured
                        ? 'OpenAI'
                        : '-'}
                  </p>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-2">
                  <p className="text-[10px] font-bold uppercase text-[var(--t3)]">TTS</p>
                  <p className="mt-1 text-xs font-black text-[var(--t1)]">
                    {backendHealth?.openai_tts_configured ? 'ok' : '-'}
                  </p>
                </div>
              </div>
              {healthError && (
                <p className="mt-3 rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {healthError}
                </p>
              )}
            </section>

            <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <div>
                  <h3 className="text-sm font-black text-[var(--t1)]">Fila para Persona</h3>
                  <p className="mt-1 text-xs text-[var(--t3)]">
                    {capturedText.length} mensagens roteadas
                  </p>
                </div>
                <button
                  onClick={downloadLog}
                  disabled={capturedText.length === 0}
                  className="rounded-md p-2 text-[var(--t3)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)] disabled:opacity-40"
                  title="Baixar log"
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>

              <div
                ref={eventsScrollRef}
                className="max-h-[420px] space-y-3 overflow-y-auto p-4 font-mono text-xs"
              >
                {error && (
                  <div className="flex gap-2 rounded-md border border-rose-400/30 bg-rose-500/10 p-3 text-rose-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {captureEvents.length === 0 ? (
                  <p className="py-8 text-center text-[var(--t4)]">Aguardando eventos OCR...</p>
                ) : (
                  captureEvents.map((event) => (
                    <div
                      key={event.id}
                      className={cn(
                        'rounded-md border p-3',
                        event.routeStatus === 'error'
                          ? 'border-rose-400/30 bg-rose-500/10'
                          : 'border-[var(--border)] bg-[var(--bg1)]/50',
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          {event.routeStatus === 'error' ? (
                            <AlertCircle className="h-3.5 w-3.5 text-rose-300" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                          )}
                          <span className="truncate font-sans text-xs font-black text-[var(--t1)]">
                            {event.zoneName}
                          </span>
                        </span>
                        <span className="text-[10px] text-[var(--t3)]">{event.time}</span>
                      </div>
                      {event.error ? (
                        <p className="whitespace-pre-wrap text-rose-200">{event.error}</p>
                      ) : (
                        <p className="break-words leading-5 text-[var(--t1)]">
                          <TypewriterText text={event.text} />
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2 font-sans text-[10px] font-bold uppercase tracking-wide text-[var(--t3)]">
                        <span>{event.routeStatus}</span>
                        {event.confidence !== null && (
                          <span>{Math.round(event.confidence * 100)}% conf.</span>
                        )}
                        {event.latencyMs !== null && <span>{Math.round(event.latencyMs)}ms</span>}
                        {event.deduped && <span>dedup: {event.duplicateReason || 'repetido'}</span>}
                        {event.captureMode && <span>{event.captureMode}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]">
              <div className="border-b border-[var(--border)] px-4 py-3">
                <h3 className="text-sm font-black text-[var(--t1)]">Texto bruto</h3>
                <p className="mt-1 text-xs text-[var(--t3)]">
                  Zona ativa: {activeZone?.name || 'nenhuma'}
                </p>
              </div>
              <div className="space-y-3 p-4">
                {previewImage && (
                  <img
                    src={previewImage}
                    alt="Preview OCR"
                    className="h-28 w-full rounded-md border border-[var(--border)] bg-black object-contain"
                    style={{ imageRendering: 'pixelated' }}
                  />
                )}
                {captureMode === 'direct' && directCapturePreview && (
                  <div className="space-y-2">
                    <img
                      src={directCapturePreview}
                      alt="Preview da captura Link Direto"
                      className="h-28 w-full rounded-md border border-[var(--border)] bg-black object-contain"
                    />
                    <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                      Captura testada: {directCaptureSize?.width || 0}x{directCaptureSize?.height || 0}
                    </p>
                  </div>
                )}
                {captureMode === 'direct' && directCaptureError && (
                  <p className="rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {directCaptureError}
                  </p>
                )}
                <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--bg1)]/70 p-3 text-xs leading-5 text-[var(--t2)]">
                  {currentRawText || '(aguardando captura)'}
                </pre>
                {lastEvent && (
                  <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-3 text-xs text-[var(--t3)]">
                    <span className="font-bold text-[var(--t1)]">Ultima rota:</span>{' '}
                    {lastEvent.routeStatus} / {lastEvent.zoneName}
                  </div>
                )}
              </div>
            </section>

            {/* Task 3: Webview diagnostic logs (console visual) */}
            {captureMode === 'direct' && webviewLogs.length > 0 && (
              <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                  <h3 className="text-sm font-black text-[var(--t1)]">Console WebView</h3>
                  <button
                    type="button"
                    onClick={() => setWebviewLogs([])}
                    className="rounded-md p-1.5 text-[var(--t3)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)]"
                    title="Limpar logs"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="max-h-[200px] overflow-y-auto p-3">
                  {webviewLogs.map((log, idx) => (
                    <p key={idx} className="font-mono text-[10px] leading-4 text-[var(--t3)]">
                      {log}
                    </p>
                  ))}
                </div>
              </section>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
});

export default CaptureStudio;
