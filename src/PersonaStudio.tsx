import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCw,
  Volume2,
  VolumeX,
  Zap,
  ChevronRight,
  Sparkles,
  Film,
  Settings,
  PlayCircle,
} from 'lucide-react';
import { cn } from './lib/utils';
import { apiUrl } from './lib/api';
import PersonaMediaLibrary from './PersonaMediaLibrary';
import TriggerEditor from './TriggerEditor';
import OcrSetup from './OcrSetup';
import {
  processRawEvent,
  registerVideoPlayCallback,
  registerPipelineLogCallback,
  loadRulesFromFlowTriggers,
  type GiftPipelineResult,
} from './core/giftEventBus';

/**
 * Video group classifications (from server/core/video_logic.py)
 */
interface VideoState {
  id: string; // '01' to '16'
  group: 'base_idle' | 'look_side' | 'hair_motion' | 'thank_you' | 'read_screen';
  label: string;
  description: string;
  loop?: boolean;
}

interface TransitionTrigger {
  type: 'gift' | 'message' | 'manual' | 'auto_idle' | 'natural' | 'watchdog';
  targetVideoId?: string;
  label: string;
}

interface PersonaConfig {
  videos: VideoState[];
  action_map: Record<string, string[]>;
  transitions: Record<string, { safe_next: string[] }>;
  gift_map?: Record<string, string[]>;
  triggers?: {
    gift_keywords: string[];
    message_keywords: string[];
  };
}

// Default video catalog (will be overwritten by fetch)
const DEFAULT_CATALOG: Record<string, VideoState> = {
  '04': {
    id: '04',
    group: 'base_idle',
    label: 'Âncora Principal',
    description: 'Idle base frontal',
  },
};

interface PersonaStudioProps {
  videoPath?: string; // Relative path (e.g., /api/video/play/)
  onVideoChange?: (videoId: string) => void;
  autoPlayNext?: boolean;
  onRegisterTriggers?: (triggers: {
    gift: (data?: any) => void;
    message: (data?: any) => void;
    reaction: (data?: any) => void;
  }) => void;
}

export default function PersonaStudio({
  videoPath = '/api/video/play/',
  onVideoChange,
  autoPlayNext = true,
  onRegisterTriggers,
}: PersonaStudioProps) {
  // Dual video refs for cross-fading
  const videoRefA = useRef<HTMLVideoElement>(null);
  const videoRefB = useRef<HTMLVideoElement>(null);
  const audioKeepAliveRef = useRef<HTMLAudioElement>(null);

  const [activePlayer, setActivePlayer] = useState<'A' | 'B'>('A');
  const [currentVideoId, setCurrentVideoId] = useState<string>('');

  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true); // Obrigatório para AutoPlay funcionar sempre
  const [showControls, setShowControls] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [lastEventTime, setLastEventTime] = useState(() => Date.now());
  const [videoCatalog, setVideoCatalog] = useState<Record<string, VideoState>>(DEFAULT_CATALOG);
  const [personaConfig, setPersonaConfig] = useState<PersonaConfig | null>(null);
  const [preloadedId, setPreloadedId] = useState<string | null>(null);
  const [queuedActionId, setQueuedActionId] = useState<string | null>(null);

  const [isCleanMode, setIsCleanMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'live' | 'library' | 'triggers' | 'ocr'>('live');
  const [pipelineLogs, setPipelineLogs] = useState<GiftPipelineResult[]>([]);

  const currentVideo = videoCatalog[currentVideoId];

  // Helper to fetch safe transitions
  const fetchSafeNext = useCallback(
    async (videoId: string) => {
      try {
        const res = await fetch(apiUrl(`/api/video/safe-next/${videoId}`));
        await res.json(); // Consumir para evitar erros, mas safeNextIds foi removido
        // No-op for now
      } catch (err) {
        console.error('[VIDEO] Failed to fetch safe transitions:', err);
      }
    },
    [apiUrl],
  );

  // Helper to fetch config
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/video/config'));
      const data: PersonaConfig = await res.json();
      setPersonaConfig(data);
      if (data && Array.isArray(data.videos)) {
        const catalog: Record<string, VideoState> = {};
        data.videos.forEach((v) => {
          catalog[v.id] = v;
        });
        setVideoCatalog(catalog);
      }
    } catch (err) {
      console.error('[VIDEO] Failed to fetch config:', err);
    }
  }, [apiUrl]);

  // Initial load: fetch current state
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch(apiUrl('/api/video/state'));
        const state = await res.json();
        const vid = state.current_video_id;
        setCurrentVideoId(vid);
        fetchSafeNext(vid);
      } catch (e) {
        console.error('Studio init error', e);
        setCurrentVideoId('grok-998cb92c-3b48-4c1a-ba60-51ffa08ae60e-720p');
      }
      fetchConfig();
    };
    init();
  }, [fetchConfig, fetchSafeNext]);

  // Helper to fetch next video from backend
  const findGiftMapping = useCallback(
    (giftMap: Record<string, string[]> | undefined, giftName: string) => {
      if (!giftMap) return null;
      const gn = (giftName || '').toLowerCase().trim();
      // 1) Exact match
      for (const k of Object.keys(giftMap)) {
        if (k.toLowerCase() === gn) return giftMap[k];
      }
      // 2) Substring heuristics
      for (const k of Object.keys(giftMap)) {
        const kl = k.toLowerCase();
        if (!kl) continue;
        if (gn.includes(kl) || kl.includes(gn)) return giftMap[k];
      }
      // 3) Wildcards / defaults
      if (giftMap['*'] && giftMap['*'].length) return giftMap['*'];
      if (giftMap['default'] && giftMap['default'].length) return giftMap['default'];
      return null;
    },
    [],
  );

  const fetchNextVideoId = useCallback(
    async (trigger?: string, detail?: Record<string, any>) => {
      // If we have a queued action, it takes priority
      if (queuedActionId && !trigger) {
        return queuedActionId;
      }

      try {
        // If we have a frontend gift_map configured, allow resolving by giftName locally
        if (
          trigger === 'gift' &&
          detail &&
          detail.giftName &&
          personaConfig &&
          personaConfig.gift_map
        ) {
          const mapped = findGiftMapping(personaConfig.gift_map, String(detail.giftName));
          if (mapped && mapped.length > 0) {
            const pick = mapped[Math.floor(Math.random() * mapped.length)];
            console.log('[VIDEO] Resolved giftName -> video (local map):', detail.giftName, pick);
            return pick;
          }
        }

        let path = `/api/video/next`;
        if (trigger) path += `?trigger=${encodeURIComponent(trigger)}`;
        if (detail && detail.giftName) {
          path += `${path.includes('?') ? '&' : '?'}giftName=${encodeURIComponent(String(detail.giftName))}`;
        }
        const url = apiUrl(path);
        const res = await fetch(url);
        const data = await res.json();
        return data.id as string;
      } catch (err) {
        console.error('[VIDEO] Failed to fetch next video:', err);
        return '04'; // Fallback
      }
    },
    [apiUrl, queuedActionId, personaConfig, findGiftMapping],
  );

  // Smooth transition logic
  const transitionToVideo = useCallback(
    async (targetVideoId: string, trigger: TransitionTrigger) => {
      if (isTransitioning && trigger.type !== 'watchdog') return;

      console.log(
        `[VIDEO] Transitioning: ${currentVideoId} -> ${targetVideoId} (${trigger.label})`,
      );
      setIsTransitioning(true);
      setLastEventTime(Date.now());

      const nextPlayer = activePlayer === 'A' ? 'B' : 'A';
      const nextRef = nextPlayer === 'A' ? videoRefA : videoRefB;
      const currRef = activePlayer === 'A' ? videoRefA : videoRefB;

      try {
        const videoSrc = apiUrl(`${videoPath}${targetVideoId}`);
        const isPreloaded = targetVideoId === preloadedId;
        const isNatural = trigger.type === 'natural' || trigger.type === 'auto_idle';

        if (nextRef.current && currRef.current) {
          if (!isPreloaded) {
            nextRef.current.src = videoSrc;
            nextRef.current.load();
            setPreloadedId(targetVideoId);

            await new Promise((resolve) => {
              const onCanPlay = () => {
                nextRef.current?.removeEventListener('canplay', onCanPlay);
                resolve(null);
              };
              nextRef.current?.addEventListener('canplay', onCanPlay);
              setTimeout(resolve, 2000);
            });
          }

          nextRef.current.volume = 0;
          try {
            await nextRef.current.play();
          } catch (e) {
            console.warn('[VIDEO] Play failed:', e);
          }

          if (isNatural) {
            nextRef.current.style.opacity = '1';
            currRef.current.style.opacity = '0';
            currRef.current.pause();

            if (!isMuted) nextRef.current.volume = 0.5;

            setActivePlayer(nextPlayer);
            setIsTransitioning(false);
            setIsPlaying(true);
            setCurrentVideoId(targetVideoId);
            fetchSafeNext(targetVideoId);
            currRef.current.src = '';

            if (targetVideoId === queuedActionId) {
              setQueuedActionId(null);
            }
          } else {
            let opacity = 0;
            const fadeInterval = setInterval(() => {
              opacity += 0.1;
              if (opacity >= 1) {
                clearInterval(fadeInterval);
                if (nextRef.current) nextRef.current.style.opacity = '1';
                if (currRef.current) {
                  currRef.current.style.opacity = '0';
                  currRef.current.pause();
                  currRef.current.src = '';
                }
                setActivePlayer(nextPlayer);
                setIsTransitioning(false);
                setIsPlaying(true);
                setCurrentVideoId(targetVideoId);
                fetchSafeNext(targetVideoId);

                if (targetVideoId === queuedActionId) {
                  setQueuedActionId(null);
                }
              } else {
                if (nextRef.current) nextRef.current.style.opacity = opacity.toString();
                if (currRef.current) currRef.current.style.opacity = (1 - opacity).toString();
                if (!isMuted) {
                  if (nextRef.current) nextRef.current.volume = opacity * 0.5;
                  if (currRef.current) currRef.current.volume = (1 - opacity) * 0.5;
                }
              }
            }, 30);
          }
        }

        // trigger history removed
        onVideoChange?.(targetVideoId);
      } catch (err) {
        console.error('[VIDEO] Transition fatal error:', err);
        setIsTransitioning(false);
      }
    },
    [
      activePlayer,
      isMuted,
      videoPath,
      onVideoChange,
      isTransitioning,
      currentVideoId,
      fetchSafeNext,
      preloadedId,
      queuedActionId,
    ],
  );

  // Handle automatic transition when video ends
  const handleVideoEnd = async () => {
    if (!autoPlayNext) return;
    const nextId = await fetchNextVideoId();
    transitionToVideo(nextId, { type: 'natural', label: 'Natural Flow' });
  };

  // Web Worker for background persistence
  useEffect(() => {
    const worker = new Worker('/timer-worker.js');
    worker.postMessage({ action: 'start', interval: 500 });

    worker.onmessage = (e) => {
      if (e.data.type === 'tick') {
        // Heartbeat check for background transitions
        const activeRef = activePlayer === 'A' ? videoRefA : videoRefB;
        if (activeRef.current && !isTransitioning) {
          const v = activeRef.current;
          if (v.duration > 0 && v.currentTime > v.duration - 0.45) {
            handleVideoEnd();
          }
        }
      }
    };

    return () => {
      worker.postMessage({ action: 'stop' });
      worker.terminate();
    };
  }, [activePlayer, isTransitioning, autoPlayNext, fetchNextVideoId, transitionToVideo]);

  // Watchdog: ensures video is always playing and alternating
  useEffect(() => {
    if (!autoPlayNext) return;

    const watchdog = setInterval(async () => {
      const activeRef = activePlayer === 'A' ? videoRefA : videoRefB;
      if (!activeRef.current) return;

      const now = Date.now();
      const stalled = activeRef.current.paused && !isTransitioning;
      const stuckAtEnd = activeRef.current.ended && !isTransitioning;
      const timeSinceLastEvent = now - lastEventTime;

      if (stalled || stuckAtEnd || timeSinceLastEvent > 15000) {
        console.log('[VIDEO WATCHDOG] Detected stall or end. Forcing next video.');
        const nextId = await fetchNextVideoId();
        transitionToVideo(nextId, { type: 'watchdog', label: 'Watchdog Recovery' });
      }
    }, 3000);

    return () => clearInterval(watchdog);
  }, [
    activePlayer,
    autoPlayNext,
    isTransitioning,
    lastEventTime,
    fetchNextVideoId,
    transitionToVideo,
  ]);

  // Initial load / Sync
  useEffect(() => {
    if (currentVideoId && videoRefA.current && !videoRefA.current.src) {
      console.log('[STUDIO] Setting initial src:', currentVideoId);
      videoRefA.current.src = apiUrl(`${videoPath}${currentVideoId}`);
      videoRefA.current.play().catch(console.warn);
      fetchSafeNext(currentVideoId);
    }
  }, [fetchConfig, fetchSafeNext, currentVideoId, apiUrl, videoPath]);

  // Predictive transition: trigger before end to ensure gapless
  useEffect(() => {
    const activeRef = activePlayer === 'A' ? videoRefA : videoRefB;
    if (!activeRef.current || !autoPlayNext || isTransitioning) return;

    const handleTimeUpdate = async () => {
      const v = activeRef.current;
      if (!v) return;

      if (v.duration > 0 && v.currentTime > v.duration - 0.45) {
        // Se o vídeo atual é de loop contínuo (Idle), deixamos o HTML5 cuidar do loop nativo!
        // Não precisamos fazer crossfade para o mesmo vídeo. Ele só sairá daqui via interrupção.
        if (currentVideo?.loop) {
          return;
        }

        v.removeEventListener('timeupdate', handleTimeUpdate);
        const nextId = await fetchNextVideoId();
        transitionToVideo(nextId, {
          type: 'natural',
          label: 'Seamless Flow',
        });
      }
    };

    const ref = activeRef.current;
    ref.addEventListener('timeupdate', handleTimeUpdate);
    return () => ref.removeEventListener('timeupdate', handleTimeUpdate);
  }, [
    activePlayer,
    autoPlayNext,
    isTransitioning,
    fetchNextVideoId,
    transitionToVideo,
    currentVideo,
  ]);

  // Pre-load next video in background
  useEffect(() => {
    if (isTransitioning) return;

    const preloadNext = async () => {
      const nextPlayer = activePlayer === 'A' ? 'B' : 'A';
      const nextRef = nextPlayer === 'A' ? videoRefA : videoRefB;

      if (!nextRef.current) return;

      const nextId = await fetchNextVideoId();
      const videoSrc = apiUrl(`${videoPath}${nextId}`);

      if (nextRef.current.src.includes(videoSrc)) return;

      console.log(`[VIDEO] Pre-warming next: ${nextId}`);
      nextRef.current.src = videoSrc;
      nextRef.current.load();
      setPreloadedId(nextId);
    };

    const timer = setTimeout(preloadNext, 1000);
    return () => clearTimeout(timer);
  }, [currentVideoId, activePlayer, isTransitioning, fetchNextVideoId, apiUrl, videoPath]);

  // Register the GiftEventBus video callback once on mount
  useEffect(() => {
    registerVideoPlayCallback((videoId: string, reason: string) => {
      console.log(`[GiftEventBus] Video triggered: ${videoId} — ${reason}`);
      transitionToVideo(videoId, { type: 'manual', label: `Gift: ${reason}` });
    });
    registerPipelineLogCallback((result: GiftPipelineResult) => {
      setPipelineLogs((prev) => [result, ...prev].slice(0, 50));
    });
  }, [transitionToVideo]);

  // Load rules from persona config whenever it changes
  useEffect(() => {
    if (
      personaConfig &&
      'triggers' in personaConfig &&
      Array.isArray((personaConfig as any).triggers)
    ) {
      loadRulesFromFlowTriggers((personaConfig as any).triggers);
    }
  }, [personaConfig]);

  const handleTrigger = useCallback(
    async (triggerType: 'gift' | 'message', detail?: Record<string, any>) => {
      console.log(`[TRIGGER] ${triggerType}`, detail || '');

      if (triggerType === 'gift') {
        const giftName = detail?.giftName || 'Rosa';
        const sender = detail?.sender || 'Lucas';
        const quantity = detail?.quantity || 1;
        const text =
          quantity > 1
            ? `${sender} enviou ${giftName} x${quantity}`
            : `${sender} enviou ${giftName}`;
        console.log(`[TRIGGER] Ingesting through backend pipeline: "${text}"`);
        try {
          const response = await fetch(apiUrl('/automation/ingest'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text,
              source: 'test',
              zoneName: 'Persona Studio',
              kind: 'gift',
              execute: true,
              maxActions: 6,
              metadata: { giftName, sender, quantity, triggerTest: true },
            }),
          });
          const data = (await response.json().catch(() => ({}))) as any;
          if (!response.ok || data?.error)
            throw new Error(String(data?.error || `HTTP ${response.status}`));
          const executedVideoId =
            data.executions?.find((execution: any) => execution?.action?.videoId)?.action
              ?.videoId ||
            data.executions?.find((execution: any) => execution?.videoState?.current_video_id)
              ?.videoState?.current_video_id ||
            data.videoState?.current_video_id;
          if (executedVideoId) {
            transitionToVideo(executedVideoId, { type: 'manual', label: `Gift: ${text}` });
          }
        } catch (err) {
          console.error('Failed to ingest gift trigger; falling back to local pipeline', err);
          processRawEvent(text, 'test');
        }
        return;
      }

      // Chat/message: send to backend (AI response path)
      const text = `@Viewer: ${detail?.message || 'mensagem de teste'}`;
      try {
        await fetch(apiUrl('/automation/ingest'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            source: 'test',
            zoneName: 'Persona Studio',
            kind: 'chat',
            execute: true,
            maxActions: 6,
            metadata: { triggerTest: true },
          }),
        });
      } catch (err) {
        console.error('Failed to inject message trigger', err);
      }
    },
    [transitionToVideo],
  );

  useEffect(() => {
    onRegisterTriggers?.({
      gift: (data?: any) => handleTrigger('gift', data),
      message: (data?: any) => handleTrigger('message', data),
      reaction: (data?: any) => handleTrigger('message', data),
    });
  }, [onRegisterTriggers, handleTrigger]);

  // Poll Automation Engine for queued actions
  useEffect(() => {
    if (!autoPlayNext || isTransitioning) return;

    const pollAutomationQueue = async () => {
      try {
        const res = await fetch(apiUrl('/api/automation/next-action'));
        const responseData = await res.json();

        const action = responseData.action || responseData;

        if (action && action.type === 'play_video' && action.videoId) {
          console.log('[AUTOMATION] Action received:', action);
          transitionToVideo(action.videoId, { type: 'manual', label: 'Action Interruption' });
        }
      } catch (err) {
        // Silent fail for polling
      }
    };

    const interval = setInterval(pollAutomationQueue, 1500); // Check every 1.5s
    return () => clearInterval(interval);
  }, [autoPlayNext, isTransitioning, apiUrl]);

  return (
    <div
      className={cn(
        'flex h-full flex-col gap-4 bg-gradient-to-br from-slate-900 to-slate-950 transition-all',
        isCleanMode ? 'p-0' : 'p-6',
      )}
    >
      {/* Studio Navigation Tabs */}
      {!isCleanMode && (
        <div className="flex items-center gap-2 mb-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('live')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition',
              activeTab === 'live' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800',
            )}
          >
            <PlayCircle className="w-4 h-4" /> Live Control
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition',
              activeTab === 'library'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:bg-slate-800',
            )}
          >
            <Film className="w-4 h-4" /> Video Library
          </button>
          <button
            onClick={() => setActiveTab('triggers')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition',
              activeTab === 'triggers'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:bg-slate-800',
            )}
          >
            <Zap className="w-4 h-4" /> Trigger Editor
          </button>
          <button
            onClick={() => setActiveTab('ocr')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition',
              activeTab === 'ocr' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800',
            )}
          >
            <Settings className="w-4 h-4" /> OCR Setup
          </button>
        </div>
      )}

      {/* ── Main Stage (Live Control) ── */}
      <div
        className={cn(
          'relative flex-1 overflow-hidden bg-black transition-all',
          isCleanMode ? 'rounded-none' : 'rounded-2xl border border-slate-700/50 shadow-2xl',
          activeTab !== 'live' && 'hidden',
        )}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
      >
        <video
          ref={videoRefA}
          muted={isMuted}
          loop={activePlayer === 'A' ? !!currentVideo?.loop : false}
          className={cn(
            'absolute inset-0 h-full w-full object-contain pointer-events-none transition-opacity duration-0',
            activePlayer === 'A' ? 'opacity-100' : 'opacity-0',
          )}
          onEnded={activePlayer === 'A' ? handleVideoEnd : undefined}
          playsInline
        />
        <video
          ref={videoRefB}
          muted={isMuted}
          loop={activePlayer === 'B' ? !!currentVideo?.loop : false}
          className={cn(
            'absolute inset-0 h-full w-full object-contain pointer-events-none transition-opacity duration-0',
            activePlayer === 'B' ? 'opacity-100' : 'opacity-0',
          )}
          onEnded={activePlayer === 'B' ? handleVideoEnd : undefined}
          playsInline
        />

        {/* HUD - Top Bar */}
        <div
          className={cn(
            'absolute inset-x-0 top-0 flex items-center justify-between p-4 z-20 transition-opacity',
            isCleanMode && !showControls ? 'opacity-0' : 'opacity-100',
          )}
        >
          <div className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-md border border-white/10">
            <div
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                isPlaying ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-amber-500',
              )}
            />
            <span className="text-[10px] font-bold uppercase tracking-wider text-white">
              {currentVideo?.label || 'Loading'}
            </span>
          </div>

          {isTransitioning && (
            <div className="flex items-center gap-2 rounded-full bg-blue-500/30 px-3 py-1.5 backdrop-blur-md border border-blue-400/30">
              <RotateCw className="h-3 w-3 animate-spin text-blue-300" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-200">
                Alternando Clips...
              </span>
            </div>
          )}

          <div className="flex-1" />

          <button
            onClick={() => setIsCleanMode(!isCleanMode)}
            className={cn(
              'flex items-center gap-2 rounded-full px-3 py-1.5 backdrop-blur-md border transition',
              isCleanMode
                ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                : 'bg-slate-800/80 border-white/10 text-slate-300 hover:bg-slate-700',
            )}
            title={
              isCleanMode
                ? 'Sair do modo captura'
                : 'Entrar no modo captura (limpa a tela para o OBS)'
            }
          >
            <Zap className={cn('w-3 h-3', isCleanMode && 'fill-amber-300')} />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {isCleanMode ? 'Sair Modo Captura' : 'Modo Captura'}
            </span>
          </button>

          {!isCleanMode && (
            <button
              onClick={() => setActiveTab('live')}
              className="ml-2 group flex items-center gap-2 rounded-full bg-slate-800/80 px-3 py-1.5 backdrop-blur-md border border-white/10 hover:bg-slate-700 transition"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                Overlay preview
              </span>
            </button>
          )}
        </div>

        {/* Video Controls Overlay */}
        {showControls && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent p-4 transition-opacity z-20">
            <button
              onClick={() => {
                const activeRef = activePlayer === 'A' ? videoRefA : videoRefB;
                if (activeRef.current) {
                  if (activeRef.current.paused) {
                    activeRef.current.play();
                    setIsPlaying(true);
                  } else {
                    activeRef.current.pause();
                    setIsPlaying(false);
                  }
                }
              }}
              className="rounded-full bg-white/10 p-2.5 backdrop-blur hover:bg-white/20 transition active:scale-95"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-white" />
              ) : (
                <Play className="w-5 h-5 text-white" />
              )}
            </button>

            <button
              onClick={() => setIsMuted(!isMuted)}
              className="rounded-full bg-white/10 p-2.5 backdrop-blur hover:bg-white/20 transition active:scale-95"
            >
              {isMuted ? (
                <VolumeX className="w-5 h-5 text-white" />
              ) : (
                <Volume2 className="w-5 h-5 text-white" />
              )}
            </button>

            <div className="flex-1" />

            <div className="flex items-center gap-2 text-[10px] text-white/50 font-mono">
              ACTIVE_{activePlayer} ID_{currentVideoId}
            </div>
          </div>
        )}
      </div>

      {/* ── Live Flow & Actions ── */}
      {!isCleanMode && activeTab === 'live' && (
        <div className="grid grid-cols-12 gap-6 animate-in slide-in-from-bottom-4 duration-500">
          {/* Left: Persona Flow (Current & Next) */}
          <div className="col-span-7 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 px-1">
              <Zap className="h-3.5 w-3.5 text-blue-400" />
              Fluxo da Persona em Tempo Real
            </div>

            <div className="flex gap-4 p-4 rounded-2xl bg-slate-800/30 border border-slate-700/50 backdrop-blur-sm">
              <div className="flex-1 space-y-2">
                <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest block text-center">
                  Reproduzindo
                </span>
                <div className="relative aspect-video rounded-xl overflow-hidden border-2 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)] bg-black">
                  <video
                    src={apiUrl(`${videoPath}${currentVideoId}`)}
                    muted
                    loop
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-2 left-2 right-2 bg-black/60 backdrop-blur-md p-1.5 rounded-lg flex items-center justify-between border border-white/5">
                    <span className="text-[10px] font-bold truncate text-white uppercase">
                      {currentVideo?.label}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center pt-4">
                <ChevronRight className="w-6 h-6 text-slate-600 animate-pulse" />
              </div>

              <div className="flex-1 space-y-2">
                <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest block text-center">
                  {queuedActionId ? 'Próximo (Ação Agendada)' : 'Próximo na Fila'}
                </span>
                <div
                  className={cn(
                    'relative aspect-video rounded-xl overflow-hidden border-2 bg-slate-900/50 group transition-colors',
                    queuedActionId ? 'border-rose-500/50' : 'border-slate-700',
                  )}
                >
                  {(queuedActionId || preloadedId) && (
                    <>
                      <video
                        src={apiUrl(`${videoPath}${queuedActionId || preloadedId}`)}
                        muted
                        loop
                        autoPlay
                        playsInline
                        key={queuedActionId || preloadedId}
                        className="w-full h-full object-cover opacity-60"
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        {queuedActionId ? (
                          <div className="px-3 py-1 bg-rose-600 rounded text-[10px] font-bold text-white shadow-lg animate-pulse">
                            AGENDADO
                          </div>
                        ) : (
                          <div className="px-2 py-1 bg-amber-500/20 rounded text-[9px] font-bold text-amber-200">
                            READY
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Quick Recommendations & Actions & Logs */}
          <div className="col-span-5 flex flex-col gap-3 h-full">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 px-1">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              Controles
            </div>

            <div className="grid grid-cols-2 gap-3 shrink-0">
              <button
                onClick={() => handleTrigger('gift')}
                disabled={isTransitioning}
                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 py-3 text-xs font-bold text-white shadow-lg hover:from-rose-500 transition"
              >
                SIMULAR PRESENTE
              </button>
              <button
                onClick={() => handleTrigger('message')}
                disabled={isTransitioning}
                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3 text-xs font-bold text-white shadow-lg hover:from-blue-500 transition"
              >
                SIMULAR MENSAGEM
              </button>
            </div>

            <select
              value={currentVideoId}
              onChange={(e) =>
                transitionToVideo(e.target.value, {
                  type: 'manual',
                  label: `Manual: ${videoCatalog[e.target.value]?.label}`,
                })
              }
              disabled={isTransitioning}
              className="w-full shrink-0 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 text-xs font-medium text-white outline-none focus:border-blue-500"
            >
              {Object.entries(videoCatalog).map(([id, video]) => (
                <option key={id} value={id}>
                  {id} - {video.label}
                </option>
              ))}
            </select>

            {/* Gift Simulate Buttons */}
            <div className="grid grid-cols-2 gap-2 shrink-0">
              <button
                onClick={() =>
                  handleTrigger('gift', { giftName: 'Rosa', sender: 'Lucas', quantity: 1 })
                }
                className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 py-2 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20 transition"
              >
                🌹 Rosa x1
              </button>
              <button
                onClick={() =>
                  handleTrigger('gift', { giftName: 'Rosa', sender: 'Ana', quantity: 5 })
                }
                className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 py-2 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20 transition"
              >
                🌹 Rosa x5
              </button>
              <button
                onClick={() =>
                  handleTrigger('gift', { giftName: 'Coroa', sender: 'BrunoTech', quantity: 1 })
                }
                className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 py-2 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20 transition"
              >
                👑 Coroa
              </button>
              <button
                onClick={() =>
                  handleTrigger('gift', { giftName: 'Diamante', sender: 'CamilaBR', quantity: 1 })
                }
                className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 py-2 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20 transition"
              >
                💎 Diamante
              </button>
            </div>

            {/* Gift Pipeline Diagnostics */}
            <div className="flex-1 min-h-[200px] flex flex-col bg-[#080a0f] border border-amber-500/15 rounded-xl overflow-hidden mt-1">
              <div className="flex items-center gap-2 bg-[#0d0f14] px-3 py-2 border-b border-amber-500/15">
                <span className="text-amber-400 text-xs">🎁</span>
                <span className="text-[10px] font-bold text-amber-300/80 uppercase tracking-widest">
                  Pipeline de Gifts
                </span>
                {pipelineLogs.length > 0 && (
                  <span className="ml-auto text-[9px] text-amber-400/50">
                    {pipelineLogs.length} eventos
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {pipelineLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'rounded-lg border p-2 text-[10px]',
                      log.videoTriggered
                        ? 'border-amber-500/30 bg-amber-500/8'
                        : log.blocked
                          ? 'border-slate-700/40 bg-slate-900/40'
                          : 'border-slate-700/20 bg-transparent',
                    )}
                  >
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-1.5">
                      {log.event.kind === 'gift' ? (
                        <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/12 px-2 py-0.5 text-[9px] font-bold text-amber-300">
                          🎁 GIFT
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 rounded-full border border-slate-600/40 bg-slate-800/50 px-2 py-0.5 text-[9px] font-bold text-slate-400">
                          {log.event.kind.toUpperCase()}
                        </span>
                      )}
                      {log.videoTriggered && (
                        <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[9px] font-bold text-emerald-300">
                          ▶ {log.videoTriggered}
                        </span>
                      )}
                      {log.blocked && (
                        <span className="rounded-full bg-slate-700/40 px-2 py-0.5 text-[9px] text-slate-500">
                          {log.blockedReason}
                        </span>
                      )}
                      <span className="ml-auto text-[9px] text-slate-600 font-mono">
                        {new Date(log.event.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    {/* Steps */}
                    <div className="space-y-0.5">
                      {log.steps.map((step, si) => (
                        <div key={si} className="flex items-center gap-1.5 font-mono">
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full shrink-0',
                              step.status === 'ok'
                                ? 'bg-emerald-500'
                                : step.status === 'blocked'
                                  ? 'bg-amber-500'
                                  : 'bg-red-500',
                            )}
                          />
                          <span className="text-slate-500 w-24 shrink-0">{step.step}</span>
                          <span className="text-slate-400 truncate">{step.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {pipelineLogs.length === 0 && (
                  <div className="text-slate-600 text-xs text-center pt-8">
                    Clique em "Simular Presente" ou em um dos botões de gift para ver o pipeline...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Other Tabs Content */}
      {!isCleanMode && activeTab === 'library' && (
        <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-700/50 overflow-hidden">
          <PersonaMediaLibrary onClose={() => setActiveTab('live')} onConfigChange={fetchConfig} />
        </div>
      )}

      {!isCleanMode && activeTab === 'triggers' && (
        <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-700/50 overflow-hidden">
          <TriggerEditor onConfigChange={fetchConfig} />
        </div>
      )}

      {!isCleanMode && activeTab === 'ocr' && (
        <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-700/50 overflow-hidden">
          <OcrSetup />
        </div>
      )}

      {/* Keep-Alive Silent Audio */}
      <audio
        ref={audioKeepAliveRef}
        loop
        src="data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA== "
      />
    </div>
  );
}
