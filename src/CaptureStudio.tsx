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
  Eye,
  FileText,
  Gauge,
  Layers,
  Monitor,
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
import { apiUrl } from './lib/api';
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

const DEFAULT_SETTINGS: CaptureSettings = {
  magnification: 2,
  contrast: 1.4,
  brightness: 1.05,
  intervalTime: 1000,
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
      <span className="text-slate-100">{displayed.substring(usernameLen)}</span>
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
    idle: 'border-slate-600 bg-slate-900/70 text-slate-300',
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
        <span className="font-semibold text-slate-400">{label}</span>
        <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-slate-200">
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
  const [stream, setStream] = useState<MediaStream | null>(null);
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
  });
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthCheckedAt, setHealthCheckedAt] = useState('Nunca');
  const [captureEvents, setCaptureEvents] = useState<CaptureEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastCaptureTime, setLastCaptureTime] = useState('Nunca');
  const [currentRawText, setCurrentRawText] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isSelectingRegion, setIsSelectingRegion] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [currentSelection, setCurrentSelection] = useState<SelectionRect | null>(null);
  const [draggingZoneIndex, setDraggingZoneIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [resizingZoneIndex, setResizingZoneIndex] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventsScrollRef = useRef<HTMLDivElement | null>(null);
  const isBusyRef = useRef(false);
  const zonesRef = useRef<CaptureZone[]>([]);
  const settingsRef = useRef(settings);

  const activePreset = useMemo(
    () => presets.find((preset) => preset.id === activePresetId) || presets[0],
    [activePresetId, presets],
  );
  const zones = useMemo(() => activePreset?.zones || [], [activePreset?.zones]);
  const activeZone = zones[activeZoneIndex] || zones[0];

  const lastEvent = captureEvents[captureEvents.length - 1];
  // ⚡ Bolt: Combine expensive array operations to prevent multiple iterations and recalculation on every render
  const { successfulEvents, averageConfidence, averageLatency } = useMemo(() => {
    const success: LiveEvent[] = [];
    let confSum = 0;
    let confCount = 0;
    let latSum = 0;
    let latCount = 0;

    for (const event of captureEvents) {
      if (event.routeStatus === 'sent') {
        success.push(event);

        if (event.confidence !== null) {
          confSum += event.confidence;
          confCount++;
        }
        if (event.latencyMs !== null) {
          latSum += event.latencyMs;
          latCount++;
        }
      }
    }

    return {
      successfulEvents: success,
      averageConfidence: confCount === 0 ? 0 : confSum / confCount,
      averageLatency: latCount === 0 ? 0 : latSum / latCount
    };
  }, [captureEvents]);
  const backendOnline = backendHealth?.status === 'ok' && !healthError;

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
    setSettings((current) => ({ ...current, [key]: value }));
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

  useEffect(() => {
    zonesRef.current = zones;
  }, [zones]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activePresetId,
        presets,
        settings,
      }),
    );
  }, [activePresetId, presets, settings]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (!captureEvents.length || !eventsScrollRef.current) return;
    eventsScrollRef.current.scrollTop = eventsScrollRef.current.scrollHeight;
  }, [captureEvents.length]);

  useEffect(() => {
    const firstRun = window.setTimeout(refreshHealth, 0);
    const interval = window.setInterval(refreshHealth, 15000);
    return () => {
      window.clearTimeout(firstRun);
      window.clearInterval(interval);
    };
  }, [refreshHealth]);

  // Listen for start-live events to initiate capture when user clicks "Iniciar Live"
  useEffect(() => {
    const handler = (ev: Event) => {
      const custom = ev as CustomEvent<{ prefer?: 'monitor' | 'window' }>;
      const prefer = custom?.detail?.prefer || 'monitor';
      if (status === CaptureStatus.CAPTURING) return;

      // If we already have a stream, just start capturing
      if (stream) {
        startCapture();
        return;
      }

      // Otherwise try to obtain a display media and start
      selectScreen(prefer as 'monitor' | 'window')
        .then(() => startCapture())
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Falha ao iniciar captura: ${msg}`);
        });
    };

    window.addEventListener('odessa:start-live', handler as EventListener);
    return () => window.removeEventListener('odessa:start-live', handler as EventListener);
  }, [selectScreen, startCapture, stream, status]);

  const pauseCapture = useCallback(() => {
    setStatus(CaptureStatus.IDLE);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopCapture = useCallback(() => {
    pauseCapture();
    setStream((currentStream) => {
      currentStream?.getTracks().forEach((track) => track.stop());
      return null;
    });
  }, [pauseCapture]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  const selectScreen = async (surfaceType: 'monitor' | 'window' = 'monitor') => {
    try {
      const streamData = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: surfaceType,
        } as MediaTrackConstraints,
        audio: false,
      });
      setStream(streamData);
      setStatus(CaptureStatus.SELECTING);
      setError(null);
      streamData.getVideoTracks()[0].onended = () => {
        stopCapture();
      };
    } catch (err) {
      setError(
        `Erro ao selecionar fonte: ${err instanceof Error ? err.message : 'permissao negada'}`,
      );
      setStatus(CaptureStatus.ERROR);
    }
  };

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

  const getMouseVideoCoords = (clientX: number, clientY: number) => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    const rect = video.getBoundingClientRect();
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (!videoWidth || !videoHeight) return null;

    const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
    const displayedWidth = videoWidth * scale;
    const displayedHeight = videoHeight * scale;
    const offsetX = (rect.width - displayedWidth) / 2;
    const offsetY = (rect.height - displayedHeight) / 2;
    const videoLeft = rect.left + offsetX;
    const videoTop = rect.top + offsetY;
    const mouseX = clientX - videoLeft;
    const mouseY = clientY - videoTop;

    return {
      x: Math.max(0, Math.min(videoWidth, mouseX / scale)),
      y: Math.max(0, Math.min(videoHeight, mouseY / scale)),
    };
  };

  const getZoneOverlayStyle = (zone: CaptureZone) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return {};

    const scale = Math.min(
      video.offsetWidth / video.videoWidth,
      video.offsetHeight / video.videoHeight,
    );
    const displayedWidth = video.videoWidth * scale;
    const displayedHeight = video.videoHeight * scale;
    const offsetX = (video.offsetWidth - displayedWidth) / 2;
    const offsetY = (video.offsetHeight - displayedHeight) / 2;

    return {
      left: offsetX + zone.x * scale,
      top: offsetY + zone.y * scale,
      width: zone.width * scale,
      height: zone.height * scale,
    };
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!isSelectingRegion) return;
    event.preventDefault();
    const coords = getMouseVideoCoords(event.clientX, event.clientY);
    if (!coords) return;
    setSelectionStart(coords);
    setCurrentSelection({ x: coords.x, y: coords.y, width: 0, height: 0 });
  };

  const startDraggingZone = (event: React.PointerEvent, idx: number) => {
    if (isSelectingRegion) return;
    event.preventDefault();
    event.stopPropagation();
    const coords = getMouseVideoCoords(event.clientX, event.clientY);
    if (!coords) return;
    setDraggingZoneIndex(idx);
    setDragOffset({
      x: coords.x - zones[idx].x,
      y: coords.y - zones[idx].y,
    });
    setActiveZoneIndex(idx);
  };

  const startResizingZone = (event: React.PointerEvent, idx: number) => {
    if (isSelectingRegion) return;
    event.preventDefault();
    event.stopPropagation();
    setResizingZoneIndex(idx);
    setActiveZoneIndex(idx);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    event.preventDefault();
    const coords = getMouseVideoCoords(event.clientX, event.clientY);
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
      const video = videoRef.current;
      const videoWidth = video?.videoWidth || 10000;
      const videoHeight = video?.videoHeight || 10000;
      updateActivePresetZones((currentZones) => {
        const nextZones = [...currentZones];
        const zone = nextZones[draggingZoneIndex];
        const nextX = Math.max(0, Math.min(coords.x - dragOffset.x, videoWidth - zone.width));
        const nextY = Math.max(0, Math.min(coords.y - dragOffset.y, videoHeight - zone.height));
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

  const runCaptureCycle = useCallback(async () => {
    if (
      status !== CaptureStatus.CAPTURING ||
      !videoRef.current ||
      !captureCanvasRef.current ||
      isBusyRef.current
    ) {
      return;
    }

    try {
      isBusyRef.current = true;
      setIsProcessing(true);
      const video = videoRef.current;
      const canvas = captureCanvasRef.current;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        throw new Error('Canvas indisponivel');
      }

      for (const [index, zone] of zonesRef.current.entries()) {
        const currentSettings = settingsRef.current;
        canvas.width = Math.max(1, Math.round(zone.width * currentSettings.magnification));
        canvas.height = Math.max(1, Math.round(zone.height * currentSettings.magnification));
        context.imageSmoothingEnabled = false;
        context.filter = `grayscale(1) contrast(${currentSettings.contrast}) brightness(${currentSettings.brightness}) saturate(0)`;
        context.drawImage(
          video,
          zone.x,
          zone.y,
          zone.width,
          zone.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );

        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.86);
        if (index === activeZoneIndex) {
          setPreviewImage(imageDataUrl);
        }

        try {
          const requestStartedAt = performance.now();
          const response = await fetch(apiUrl('/ocr'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              zone_id: zone.id,
              zone_name: zone.name,
              x: Math.round(zone.x),
              y: Math.round(zone.y),
              width: Math.round(zone.width),
              height: Math.round(zone.height),
              image: imageDataUrl,
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = (await response.json()) as OcrResponse;
          const fullText = data.full_text?.trim() || '';
          const newText = data.text?.trim() || '';
          const latencyMs = data.latency_ms ?? Math.round(performance.now() - requestStartedAt);
          const time = formatClock();

          if (index === activeZoneIndex) {
            setCurrentRawText(fullText || '(nenhum texto detectado)');
            setLastCaptureTime(time);
          }

          if (data.error) {
            addCaptureEvent({
              id: makeEventId(),
              zoneId: zone.id,
              zoneName: zone.name,
              text: '',
              rawText: fullText,
              time,
              routeStatus: 'error',
              confidence: data.confidence ?? null,
              latencyMs,
              error: data.error,
            });
            setError(`OCR ${zone.name}: ${data.error}`);
            continue;
          }

          if (newText.length > 0) {
            const captureEvent: CaptureEvent = {
              id: makeEventId(),
              zoneId: data.zone_id || zone.id,
              zoneName: data.zone_name || zone.name,
              text: newText,
              rawText: fullText,
              time,
              routeStatus: 'sent',
              confidence: data.confidence ?? null,
              latencyMs,
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
        timerRef.current = setTimeout(runCaptureCycle, settingsRef.current.intervalTime);
      }
    }
  }, [activeZoneIndex, setCapturedText, status]);

  const startCapture = () => {
    if (!stream) {
      setError('Selecione uma tela ou janela primeiro');
      return;
    }
    onStartAutopilot?.();
    setStatus(CaptureStatus.CAPTURING);
    setError(null);
  };

  useEffect(() => {
    if (status === CaptureStatus.CAPTURING) {
      runCaptureCycle();
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [status, runCaptureCycle]);

  const pipeline = [
    { label: stream ? 'Fonte ativa' : 'Fonte pendente', icon: Monitor, active: Boolean(stream) },
    { label: `${zones.length} zonas`, icon: Layers, active: zones.length > 0 },
    { label: backendOnline ? 'OCR pronto' : 'OCR offline', icon: ScanText, active: backendOnline },
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
    <main className="flex-1 overflow-y-auto bg-[var(--odessa-bg)] text-slate-100 xl:overflow-hidden">
      <div className="grid min-h-full grid-cols-1 xl:h-full xl:grid-cols-[304px_minmax(0,1fr)_372px]">
        <aside className="border-b border-[var(--odessa-border)] bg-[var(--odessa-surface)] p-4 xl:overflow-y-auto xl:border-b-0 xl:border-r">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                Capture Studio
              </p>
              <h2 className="mt-1 text-lg font-black text-white">Extrator OCR</h2>
            </div>
            <StatusChip
              label={status === CaptureStatus.CAPTURING ? 'Live' : 'Standby'}
              tone={status === CaptureStatus.CAPTURING ? 'good' : 'idle'}
              icon={<Activity className="h-3.5 w-3.5" />}
            />
          </div>

          <section className="space-y-3 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Fonte</h3>
              <button
                onClick={refreshHealth}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                title="Atualizar backend"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => selectScreen('monitor')}
                disabled={stream !== null}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Monitor className="h-4 w-4" />
                Tela
              </button>
              <button
                onClick={() => selectScreen('window')}
                disabled={stream !== null}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-indigo-500 px-3 py-2 text-xs font-black text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Eye className="h-4 w-4" />
                Janela
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={startCapture}
                disabled={!stream || status === CaptureStatus.CAPTURING}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-4 w-4 fill-current" />
                Iniciar
              </button>
              <button
                onClick={pauseCapture}
                disabled={status !== CaptureStatus.CAPTURING}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-xs font-black text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Pause className="h-4 w-4" />
                Pausar
              </button>
            </div>
            {stream && (
              <button
                onClick={stopCapture}
                className="w-full rounded-md border border-rose-400/30 px-3 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-500/10"
              >
                Encerrar fonte
              </button>
            )}
          </section>

          <section className="mt-4 space-y-3 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Presets
              </h3>
              <button
                onClick={resetPreset}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
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
                      : 'border-slate-800 bg-slate-950/40 hover:border-slate-600',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-white">{preset.name}</span>
                    <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                      {preset.zones.length} zonas
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-4 text-slate-500">
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-4 space-y-3 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Zonas</h3>
              <button
                onClick={addZone}
                disabled={zones.length >= MAX_ZONES}
                className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-40"
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
                      : 'border-slate-800 bg-slate-950/40 hover:border-slate-600',
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
                      <span className="truncate text-sm font-bold text-white">{zone.name}</span>
                    </span>
                    <span className="mt-1 block font-mono text-[10px] text-slate-500">
                      {Math.round(zone.width)}x{Math.round(zone.height)} px
                    </span>
                  </button>
                  {zones.length > 1 && (
                    <button
                      onClick={() => removeZone(index)}
                      className="border-l border-slate-800 px-2 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"
                      title={`Remover ${zone.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {activeZone && (
              <div className="space-y-2 rounded-md border border-slate-800 bg-slate-950/50 p-3">
                <label className="block text-xs font-semibold text-slate-400">
                  Nome da zona
                  <input
                    value={activeZone.name}
                    onChange={(event) => updateZone(activeZoneIndex, { name: event.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm font-semibold text-white outline-none focus:border-sky-400"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-400">
                  Tipo
                  <select
                    value={activeZone.role}
                    onChange={(event) =>
                      updateZone(activeZoneIndex, {
                        role: event.target.value as CaptureZone['role'],
                      })
                    }
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm font-semibold text-white outline-none focus:border-sky-400"
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
              <Settings2 className="h-4 w-4 text-slate-500" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">OCR</h3>
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
              min={500}
              max={5000}
              step={100}
              suffix="ms"
              onChange={(value) => updateSettings('intervalTime', value)}
            />
            <label className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs font-semibold text-slate-300">
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

        <section className="flex min-h-[720px] flex-col bg-[var(--odessa-bg)] xl:min-h-0">
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
                          : 'border-slate-800 bg-slate-950/50 text-slate-500',
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

          <div className="flex min-h-[420px] flex-1 flex-col border-b border-slate-800 bg-black">
            {stream && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-[#111722] px-4 py-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
                  <Crosshair className="h-4 w-4 text-sky-300" />
                  Zona ativa: <span className="text-white">{activeZone?.name || 'Zona'}</span>
                </div>
                <button
                  onClick={() => setIsSelectingRegion((current) => !current)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-black transition',
                    isSelectingRegion
                      ? 'bg-rose-500 text-white'
                      : 'bg-slate-800 text-slate-100 hover:bg-slate-700',
                  )}
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  {isSelectingRegion ? 'Cancelar recorte' : 'Desenhar recorte'}
                </button>
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
              {stream ? (
                <>
                  <video
                    ref={videoRef}
                    className="h-full w-full object-contain"
                    autoPlay
                    playsInline
                    muted
                  />
                  {isSelectingRegion && (
                    <div className="pointer-events-none absolute inset-0 bg-black/45">
                      <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm font-black uppercase tracking-[0.22em] text-white/55">
                        Arraste para redefinir {activeZone?.name || 'a zona'}
                      </div>
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0">
                    {zones.map((zone, index) => (
                      <div
                        key={zone.id}
                        onPointerDown={(event) => startDraggingZone(event, index)}
                        className={cn(
                          'pointer-events-auto absolute border-2 transition-colors',
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
                        <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                          {Math.round(zone.width)}x{Math.round(zone.height)}
                        </span>
                        {!isSelectingRegion && (
                          <div
                            onPointerDown={(event) => startResizingZone(event, index)}
                            className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize rounded-tl"
                            style={{ backgroundColor: zone.color }}
                          />
                        )}
                      </div>
                    ))}

                    {isSelectingRegion && currentSelection && videoRef.current && (
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
                </>
              ) : (
                <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
                  <div className="rounded-full border border-slate-800 bg-slate-950 p-5">
                    <Camera className="h-11 w-11 text-slate-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white">Conecte uma fonte visual</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Escolha tela ou janela, ajuste as zonas e inicie a leitura para alimentar a
                      Persona em tempo real.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-px bg-slate-800 lg:grid-cols-4">
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Clock3 className="h-4 w-4" />
                Ultima captura
              </div>
              <p className="mt-2 font-mono text-lg font-black text-white">{lastCaptureTime}</p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Gauge className="h-4 w-4" />
                Latencia media
              </div>
              <p className="mt-2 font-mono text-lg font-black text-white">
                {successfulEvents.length ? `${Math.round(averageLatency)}ms` : '0ms'}
              </p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Zap className="h-4 w-4" />
                Confianca OCR
              </div>
              <p className="mt-2 font-mono text-lg font-black text-white">
                {successfulEvents.length ? `${Math.round(averageConfidence * 100)}%` : '0%'}
              </p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Activity className="h-4 w-4" />
                Ciclo
              </div>
              <p className="mt-2 font-mono text-lg font-black text-white">
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
                  <h3 className="text-sm font-black text-white">Backend local</h3>
                  <p className="mt-1 text-xs text-slate-500">Verificado as {healthCheckedAt}</p>
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
                <div className="rounded-md border border-slate-800 bg-slate-950/50 p-2">
                  <p className="text-[10px] font-bold uppercase text-slate-500">OCR</p>
                  <p className="mt-1 text-xs font-black text-slate-100">
                    {backendHealth?.ocr || '-'}
                  </p>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-950/50 p-2">
                  <p className="text-[10px] font-bold uppercase text-slate-500">IA</p>
                  <p className="mt-1 text-xs font-black text-slate-100">
                    {backendHealth?.gemini_configured
                      ? 'Gemini'
                      : backendHealth?.openai_ai_configured
                        ? 'OpenAI'
                        : '-'}
                  </p>
                </div>
                <div className="rounded-md border border-slate-800 bg-slate-950/50 p-2">
                  <p className="text-[10px] font-bold uppercase text-slate-500">TTS</p>
                  <p className="mt-1 text-xs font-black text-slate-100">
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
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div>
                  <h3 className="text-sm font-black text-white">Fila para Persona</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {capturedText.length} mensagens roteadas
                  </p>
                </div>
                <button
                  onClick={downloadLog}
                  disabled={capturedText.length === 0}
                  className="rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-40"
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
                  <p className="py-8 text-center text-slate-600">Aguardando eventos OCR...</p>
                ) : (
                  captureEvents.map((event) => (
                    <div
                      key={event.id}
                      className={cn(
                        'rounded-md border p-3',
                        event.routeStatus === 'error'
                          ? 'border-rose-400/30 bg-rose-500/10'
                          : 'border-slate-800 bg-slate-950/50',
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          {event.routeStatus === 'error' ? (
                            <AlertCircle className="h-3.5 w-3.5 text-rose-300" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                          )}
                          <span className="truncate font-sans text-xs font-black text-white">
                            {event.zoneName}
                          </span>
                        </span>
                        <span className="text-[10px] text-slate-500">{event.time}</span>
                      </div>
                      {event.error ? (
                        <p className="whitespace-pre-wrap text-rose-200">{event.error}</p>
                      ) : (
                        <p className="break-words leading-5 text-slate-100">
                          <TypewriterText text={event.text} />
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2 font-sans text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        <span>{event.routeStatus}</span>
                        {event.confidence !== null && (
                          <span>{Math.round(event.confidence * 100)}% conf.</span>
                        )}
                        {event.latencyMs !== null && <span>{Math.round(event.latencyMs)}ms</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]">
              <div className="border-b border-slate-800 px-4 py-3">
                <h3 className="text-sm font-black text-white">Texto bruto</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Zona ativa: {activeZone?.name || 'nenhuma'}
                </p>
              </div>
              <div className="space-y-3 p-4">
                {previewImage && (
                  <img
                    src={previewImage}
                    alt="Preview OCR"
                    className="h-28 w-full rounded-md border border-slate-800 bg-black object-contain"
                    style={{ imageRendering: 'pixelated' }}
                  />
                )}
                <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950/70 p-3 text-xs leading-5 text-slate-300">
                  {currentRawText || '(aguardando captura)'}
                </pre>
                {lastEvent && (
                  <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
                    <span className="font-bold text-slate-200">Ultima rota:</span>{' '}
                    {lastEvent.routeStatus} / {lastEvent.zoneName}
                  </div>
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>

      <canvas ref={captureCanvasRef} className="hidden" />
    </main>
  );
});

export default CaptureStudio;
