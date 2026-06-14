import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from './lib/api';
import { cn } from './lib/utils';
import { preloadVideos, videoSrcFor, videoVersion } from './lib/videoPreload';

// Build-time injected by odessaSchedulePlugin in vite.config.ts.
// On the Hostinger server this is populated from the KV store at build time.
// On local dev builds it will be null (no KV file present).
declare const __ODESSA_SCHEDULE_CONFIG__: {
  schedules: Array<{ id: string; videoId: string; intervalMinutes: number; enabled?: boolean }>;
  flowNodes: Array<{ nodeId: string; videoId: string }>;
  flowConnections: Array<{ id: string; fromNodeId: string; toNodeId: string; triggerId: string }>;
  triggers: Array<{ id: string; eventType: string; conditions?: { keyword?: string; giftKey?: string }; enabled?: boolean }>;
  idleVideoId: string | null;
  // Vem no /workflow/published — usado pra detectar quando um vídeo foi trocado
  // (uploadedAt muda) e re-baixar o blob, em vez de tocar o conteúdo antigo.
  videos?: Array<{ id: string; uploadedAt?: string; updatedAt?: string }>;
} | null;

type VideoClip = {
  nodeId?: string | null;
  videoId: string;
  label?: string;
  startSec: number;
  endSec: number | null;
  transitionMs: number;
  returnToIdle?: boolean;
  loop?: boolean;
  audio?: {
    mode?: 'muted' | 'original' | 'track';
    volume?: number;
    trackUrl?: string;
  };
};

type TriggerQueueEntry = {
  targetVideoId?: string;
  videoId?: string;
};

type VideoState = {
  current_video_id?: string;
  start_ts?: number;
  server_time?: number;
  currentClip?: VideoClip | null;
  queue?: TriggerQueueEntry[];
};

function clipFromVideoId(videoId: string): VideoClip {
  return {
    nodeId: null,
    videoId,
    startSec: 0,
    endSec: null,
    transitionMs: 220,
    returnToIdle: true,
  };
}

function clipKey(clip: VideoClip | null | undefined) {
  if (!clip?.videoId) return '';
  return [
    clip.nodeId || 'video',
    clip.videoId,
    clip.startSec || 0,
    clip.endSec ?? 'end',
    clip.transitionMs || 0,
    // Include loop so the client re-transitions when the server breaks the idle
    // loop (trigger queued) — without this the video.loop attribute never updates
    // and handleEnded never fires, so triggers stay stuck in the queue forever.
    clip.loop ? 'loop' : 'once',
  ].join(':');
}

function shouldLoopClip(clip: VideoClip | null | undefined) {
  if (!clip?.videoId || clip.endSec) return false;
  // Loop ONLY when the clip is explicitly a looping clip (the idle).
  // returnToIdle is a flow setting ("go back to idle after"), not a loop
  // flag — and the video name means nothing ("01_IDLE_..." is a sequence
  // step, not the idle loop).
  return clip.loop === true;
}

export default function PersonaOverlay() {
  const videoRefA = useRef<HTMLVideoElement>(null);
  const videoRefB = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const refs = useMemo(() => [videoRefA, videoRefB] as const, []);
  const activeSlotRef = useRef<0 | 1>(0);
  const endedRef = useRef('');
  // Versão (uploadedAt) do vídeo atualmente no ar — pra detectar quando o
  // operador troca o conteúdo do vídeo que já está tocando e recarregar.
  const playedVersionRef = useRef('');
  // Último vídeo "fora do fluxo" que ignoramos — evita empurrar o servidor
  // (advance) repetidamente pro mesmo vídeo rogue a cada tick.
  const rogueAdvancedRef = useRef('');

  // ── Client-side schedule firing ──────────────────────────────────────────
  // Uses the workflow config injected at build time by odessaSchedulePlugin.
  // This fires triggers via the public /api/video/trigger endpoint so that
  // scheduled videos are queued even when the server process is running old
  // code that has no server-side schedule engine.
  const scheduleConfigRef = useRef(
    typeof __ODESSA_SCHEDULE_CONFIG__ !== 'undefined' ? __ODESSA_SCHEDULE_CONFIG__ : null
  );
  const lastScheduleFiredRef = useRef<Record<string, number>>({});

  useEffect(() => {
    // Restore per-schedule last-fired timestamps from localStorage so the
    // interval survives page reloads (the overlay refreshes in OBS on scene switch).
    try {
      const stored = localStorage.getItem('odessa_schedule_lastfired');
      if (stored) lastScheduleFiredRef.current = JSON.parse(stored) as Record<string, number>;
    } catch { /* ignore */ }

    let cancelled = false;

    // Lista [{id, version}] dos vídeos do fluxo (idle + nós + automações), com a
    // versão = uploadedAt do arquivo. A versão deixa o preload detectar quando um
    // vídeo foi TROCADO e re-baixar o blob, em vez de tocar o conteúdo antigo.
    const versionedItems = (c: typeof __ODESSA_SCHEDULE_CONFIG__) => {
      if (!c) return [];
      const verById = new Map<string, string>();
      for (const v of c.videos || []) if (v?.id) verById.set(v.id, v.uploadedAt || v.updatedAt || '');
      const ids: string[] = [];
      if (c.idleVideoId) ids.push(c.idleVideoId); // idle primeiro (fica em loop)
      for (const n of c.flowNodes || []) if (n?.videoId) ids.push(n.videoId);
      for (const s of c.schedules || []) if (s?.videoId) ids.push(s.videoId);
      const seen = new Set<string>();
      return ids
        .filter((id) => id && !seen.has(id) && seen.add(id))
        .map((id) => ({ id, version: verById.get(id) || '' }));
    };

    // Atualiza a config em memória (automações + fluxo) e (re)pré-carrega os
    // vídeos. NUNCA sobrescreve uma config boa com uma vazia/inválida.
    const applyConfig = (cfg: unknown, source: string) => {
      const c = cfg as typeof __ODESSA_SCHEDULE_CONFIG__;
      if (!c || !Array.isArray(c.flowNodes) || !c.flowNodes.length) return false;
      if (Array.isArray(c.flowConnections) && Array.isArray(c.triggers)) {
        const before = scheduleConfigRef.current;
        scheduleConfigRef.current = c;
        if (!before) console.log(`[Odessa] Schedule config carregada de ${source} (${c.schedules?.length || 0} automações)`);
      }
      void preloadVideos(versionedItems(c));
      return true;
    };

    // Re-busca o workflow publicado PERIODICAMENTE — assim trocas de vídeo/fluxo
    // feitas pelo operador chegam ao overlay sem precisar recarregá-lo (que num
    // live 24/7, depois da Fase 3, nunca acontece).
    let settledOnPublished = false;

    const tryPublished = async (): Promise<boolean> => {
      try {
        const r = await fetch(apiUrl('/workflow/published'));
        const cfg = r.ok ? await r.json() : null;
        if (cancelled) return true;
        if (applyConfig(cfg, 'workflow publicado')) {
          settledOnPublished = true;
          return true;
        }
      } catch { /* rede — tenta de novo no próximo ciclo */ }
      return false;
    };

    const refresh = async () => {
      if (await tryPublished()) return;
      // O ESTÁTICO é só último recurso, e SÓ enquanto nunca conseguimos o
      // publicado — nunca regride um fluxo publicado bom pro estático velho.
      if (settledOnPublished || cancelled) return;
      try {
        const r2 = await fetch('/odessa-schedules.json');
        const c2 = r2.ok ? await r2.json() : null;
        if (!cancelled) applyConfig(c2, '/odessa-schedules.json');
      } catch { /* mantém a config atual */ }
    };

    // Cold-start: no boot o token pode levar uns segundos pra ficar fresco (auto-
    // login em segundo plano), e um 401 cairia no fluxo ESTÁTICO velho. Então
    // insiste no publicado por ~30s ANTES de considerar o estático.
    void (async () => {
      for (let i = 0; i < 6 && !settledOnPublished && !cancelled; i++) {
        if (await tryPublished()) return;
        await new Promise((r) => setTimeout(r, 5000));
      }
      await refresh(); // ainda sem publicado → garante ao menos o estático
    })();

    const intervalId = window.setInterval(() => void refresh(), 2 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const [slotClips, setSlotClips] = useState<[VideoClip | null, VideoClip | null]>([null, null]);
  const [currentKey, setCurrentKey] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    activeSlotRef.current = activeSlot;
  }, [activeSlot]);

  const fetchVideoState = useCallback(async (): Promise<VideoState | null> => {
    try {
      const response = await fetch(apiUrl('/api/video/state'));
      if (!response.ok) return null;
      return (await response.json()) as VideoState;
    } catch {
      return null;
    }
  }, []);

  const advanceAndRefresh = useCallback(async (endedClip?: VideoClip | null) => {
    // Tell the backend which clip just ended so the advance is idempotent —
    // if another player already advanced, this call becomes a no-op.
    await fetch(apiUrl('/api/video/advance'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromNodeId: endedClip?.nodeId || null,
        fromVideoId: endedClip?.videoId || null,
      }),
    }).catch(() => undefined);
  }, []);

  // Fire at most one due schedule per poll — mirrors the server-side logic in
  // checkAndFireDueSchedules(). Uses the build-time injected workflow config
  // to derive the right comment/gift trigger event for each schedule, then
  // posts it to /api/video/trigger which enqueues the video server-side.
  const checkAndFireSchedules = useCallback(async (state: VideoState | null) => {
    const config = scheduleConfigRef.current;
    if (!config?.schedules?.length) return;

    const now = Date.now() / 1000;
    const lastFired = lastScheduleFiredRef.current;
    const queue = state?.queue || [];

    // Derive idle node ID from config
    const idleNodeId = config.idleVideoId
      ? config.flowNodes.find((n) => n.videoId === config.idleVideoId)?.nodeId ?? null
      : null;

    for (const schedule of config.schedules) {
      if (schedule.enabled === false) continue;
      if (!schedule.intervalMinutes || !schedule.videoId) continue;

      const intervalSec = schedule.intervalMinutes * 60;
      const lastFiredAt = lastFired[schedule.id] ?? 0;
      if (now - lastFiredAt < intervalSec) continue;

      // Skip if this video is already waiting in the server queue
      if (queue.some((q) => (q.targetVideoId || q.videoId) === schedule.videoId)) continue;

      // Find target flow node
      const targetNode = config.flowNodes.find((n) => n.videoId === schedule.videoId);
      if (!targetNode) continue;

      // Find a flow connection from idle → target (prefer from idle, accept any)
      const connection =
        (idleNodeId
          ? config.flowConnections.find(
              (c) => c.fromNodeId === idleNodeId && c.toNodeId === targetNode.nodeId,
            )
          : null) ?? config.flowConnections.find((c) => c.toNodeId === targetNode.nodeId);
      if (!connection) continue;

      // Find the trigger for this connection
      const trigger = config.triggers.find(
        (t) => t.id === connection.triggerId && t.enabled !== false,
      );
      if (!trigger) continue;

      // Build the event body based on trigger type
      let eventBody: Record<string, unknown>;
      if (trigger.eventType === 'comment') {
        const keyword = trigger.conditions?.keyword;
        if (!keyword) continue;
        eventBody = { eventType: 'comment', data: { text: keyword } };
      } else if (trigger.eventType === 'gift') {
        const giftKey = trigger.conditions?.giftKey;
        if (!giftKey) continue;
        eventBody = { eventType: 'gift', data: { giftKey } };
      } else {
        continue; // Cannot synthesise other event types
      }

      // Record fire time BEFORE the fetch so a slow response doesn't double-fire
      lastFired[schedule.id] = now;
      lastScheduleFiredRef.current = lastFired;
      try { localStorage.setItem('odessa_schedule_lastfired', JSON.stringify(lastFired)); } catch { /* ignore */ }

      await fetch(apiUrl('/api/video/trigger'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody),
      }).catch(() => undefined);

      console.log(
        `[Odessa] Schedule fired (client): "${schedule.videoId}" via ${trigger.eventType} trigger`
          + ` (interval ${schedule.intervalMinutes}min)`,
      );
      break; // At most one schedule per poll
    }
  }, []);

  const transitionToClip = useCallback(
    async (clip: VideoClip, state?: VideoState | null) => {
      const key = clipKey(clip);
      if (!key || isTransitioning || key === currentKey) return;

      const nextSlot = activeSlotRef.current === 0 ? 1 : 0;
      const previousSlot = activeSlotRef.current;
      const nextElement = refs[nextSlot].current;
      const previousElement = refs[previousSlot].current;
      if (!nextElement) return;

      setIsTransitioning(true);
      endedRef.current = '';
      setSlotClips((current) => {
        const next: [VideoClip | null, VideoClip | null] = [...current] as [VideoClip | null, VideoClip | null];
        next[nextSlot] = clip;
        return next;
      });

      // Usa o blob pré-carregado (instantâneo, em memória) quando disponível;
      // senão cai no stream normal. Sem stall de fetch → sem trava ao disparar.
      nextElement.src = videoSrcFor(clip.videoId);
      nextElement.loop = shouldLoopClip(clip);
      nextElement.muted = (clip.audio?.mode || 'muted') !== 'original';
      nextElement.volume = Math.max(0, Math.min(1, clip.audio?.volume ?? 1));

      const play = async () => {
        const elapsed =
          state?.server_time && state?.start_ts ? Math.max(0, state.server_time - state.start_ts) : 0;
        const startSec = Math.max(0, clip.startSec || 0);
        const endSec = clip.endSec ?? Number.POSITIVE_INFINITY;
        const duration = Number.isFinite(nextElement.duration) ? nextElement.duration : 0;
        const loopDuration = Math.max(0, Math.min(endSec, duration || endSec) - startSec);
        const naturalEndSec = Number.isFinite(endSec) ? endSec : duration;
        // Idle whose loop was broken by a queued trigger: the idle may have been
        // looping for minutes, so `elapsed` >> `duration`. Use elapsed % duration to
        // find the position within the *current* cycle rather than skipping it.
        // returnToIdle === false is the reliable idle identifier (reactions have true).
        const isIdleLoopBreak = !shouldLoopClip(clip) && clip.returnToIdle === false && duration > 0;
        const effectiveElapsed = isIdleLoopBreak && loopDuration > 0 ? elapsed % loopDuration : elapsed;
        if (!shouldLoopClip(clip) && naturalEndSec > 0 && startSec + effectiveElapsed >= naturalEndSec - 0.1) {
          setIsTransitioning(false);
          await advanceAndRefresh(clip);
          return;
        }
        const targetTime =
          shouldLoopClip(clip) && loopDuration > 0
            ? startSec + (elapsed % loopDuration)
            : isIdleLoopBreak && loopDuration > 0
              // Resume idle at the current cycle position so the viewer sees the
              // rest of this cycle before the queued video plays.
              ? startSec + effectiveElapsed
              // Reactions / sequence clips always start from the beginning.
              : startSec;
        try {
          nextElement.currentTime = Math.min(targetTime, Math.max(0, endSec - 0.05));
        } catch {
          // Metadata timing can lag inside OBS Browser Source.
        }
        await nextElement.play().catch(() => undefined);
        nextElement.style.opacity = '1';
        if (previousElement) {
          previousElement.style.opacity = '0';
          previousElement.pause();
        }
        const audioElement = audioRef.current;
        if (audioElement) {
          if (clip.audio?.mode === 'track' && clip.audio.trackUrl) {
            audioElement.src = clip.audio.trackUrl;
            audioElement.volume = Math.max(0, Math.min(1, clip.audio.volume ?? 1));
            audioElement.currentTime = 0;
            await audioElement.play().catch(() => undefined);
          } else {
            audioElement.pause();
            audioElement.removeAttribute('src');
          }
        }
        setActiveSlot(nextSlot);
        setCurrentKey(key);
        window.setTimeout(() => setIsTransitioning(false), Math.max(60, clip.transitionMs || 220));
      };

      if (nextElement.readyState >= 1) {
        await play();
      } else {
        nextElement.addEventListener('loadedmetadata', () => void play(), { once: true });
        nextElement.load();
      }
    },
    [advanceAndRefresh, currentKey, isTransitioning, refs],
  );

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const state = await fetchVideoState();
      if (cancelled || !state) return;
      // Fire any due schedules before processing clip transitions so that the
      // trigger is already in the server queue when /video/advance is called.
      await checkAndFireSchedules(state);
      const nextClip =
        state.currentClip ||
        (state.current_video_id ? clipFromVideoId(state.current_video_id) : null);

      // TRAVA DE FLUXO: o overlay só toca o que está no FLUXO PUBLICADO. Se o
      // servidor mandar um vídeo que NÃO está no fluxo (ex.: um trigger/automação
      // velho disparado por um presente real do chat), não toca "por conta
      // própria" — empurra o servidor de volta pro idle (uma vez por vídeo rogue)
      // e mantém o que já está no ar. Só trava com a config carregada (senão,
      // no boot, deixa passar).
      const cfg = scheduleConfigRef.current;
      const inFlow =
        !nextClip ||
        !cfg ||
        cfg.idleVideoId === nextClip.videoId ||
        (cfg.flowNodes || []).some((n) => n.videoId === nextClip.videoId);
      if (nextClip && !inFlow) {
        if (rogueAdvancedRef.current !== nextClip.videoId) {
          rogueAdvancedRef.current = nextClip.videoId;
          console.warn(`[Odessa] vídeo fora do fluxo IGNORADO: ${nextClip.videoId}`);
          await advanceAndRefresh(nextClip);
        }
        return;
      }
      rogueAdvancedRef.current = '';

      if (nextClip && clipKey(nextClip) !== currentKey) {
        await transitionToClip(nextClip, state);
        playedVersionRef.current = videoVersion(nextClip.videoId);
      } else if (nextClip) {
        // Mesmo clipe no ar: se o operador TROCOU o conteúdo do vídeo, o blob novo
        // já foi baixado com versão nova — força recarregar pra trocar na hora,
        // em vez de continuar tocando o vídeo antigo (clipKey não muda sozinho).
        const ver = videoVersion(nextClip.videoId);
        if (playedVersionRef.current && ver && ver !== playedVersionRef.current) {
          playedVersionRef.current = ver;
          setCurrentKey(''); // o próximo tick re-transiciona pro conteúdo novo
        }
      }
    };

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [checkAndFireSchedules, currentKey, fetchVideoState, transitionToClip]);

  const handleProgress = (slotClip: VideoClip | null, element: HTMLVideoElement) => {
    if (!slotClip?.endSec) return;
    const key = clipKey(slotClip);
    if (element.currentTime >= slotClip.endSec && endedRef.current !== key) {
      endedRef.current = key;
      void advanceAndRefresh(slotClip);
    }
  };

  const handleEnded = (slotClip: VideoClip | null) => {
    if (!slotClip) return;
    if (shouldLoopClip(slotClip)) return;
    const key = clipKey(slotClip);
    if (endedRef.current === key) return;
    endedRef.current = key;
    void advanceAndRefresh(slotClip);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black">
      {slotClips.map((slotClip, index) => (
        <video
          key={index}
          ref={refs[index]}
          autoPlay
          muted={(slotClip?.audio?.mode || 'muted') !== 'original'}
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          preload="auto"
          loop={shouldLoopClip(slotClip)}
          src={slotClip ? videoSrcFor(slotClip.videoId) : undefined}
          onTimeUpdate={(event) => handleProgress(slotClip, event.currentTarget)}
          onEnded={() => handleEnded(slotClip)}
          className={cn(
            'absolute inset-0 w-full origin-top object-contain transition-opacity',
            activeSlot === index ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            height: '104%',
            transitionDuration: `${slotClip?.transitionMs ?? 220}ms`,
            willChange: 'opacity, transform',
            transform: 'translateZ(0)'
          }}
        />
      ))}

      <audio ref={audioRef} />

      <div className="absolute bottom-2 right-2 opacity-0 transition hover:opacity-100" style={{ zIndex: 11 }}>
        <span className="font-mono text-[10px] text-white/20">ODESSA_OVERLAY_SYNC_ACTIVE</span>
      </div>
    </div>
  );
}
