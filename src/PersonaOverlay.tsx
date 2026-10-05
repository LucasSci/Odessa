import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from './lib/api';
import { hideSlot, loadSource, revealSlot, seekTo, waitForPresentedFrame } from './lib/stageSlots';
import { preloadVideos, videoSrcFor, videoVersion } from './lib/videoPreload';
import { isVideoStateStreaming, subscribeVideoState } from './lib/videoStateEvents';

/** Com o aviso do servidor ligado, a consulta de reserva do palco. */
const STREAMING_TICK_MS = 2000;
import { clampFadeMs, nextSegmentStep, segmentSpeed } from './core/playback/clipTimeline';
import {
  DEFAULT_FRAME_SEC,
  SEAM_BLEND_MS,
  clipStartSec,
  isLastFrame,
  isStaleAfterSeam,
  nextFrameSec,
  sameFootage,
  seamStartSec,
  shouldWaitForNaturalEnd,
} from './core/playback/stageSeam';

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
  /** Cortes salvos no editor (vêm do servidor); a ordem do array é a ordem de reprodução. */
  segments?: Array<{ startSec: number; endSec: number; speed?: number }>;
  audio?: {
    mode?: 'muted' | 'original' | 'track';
    volume?: number;
    trackUrl?: string;
    trackLoop?: boolean;
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
  /** Próximos clipes naturais do fluxo (o primeiro é o que vem quando o atual acabar). */
  upcoming?: VideoClip[];
  queue?: TriggerQueueEntry[];
  /** Veredito do motor: o clip no ar é do fluxo que ele executa. */
  inFlow?: boolean;
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
    // Uma edição salva (cortes/velocidade) muda a chave e recarrega o clip no ar.
    (clip.segments || []).map((s) => `${s.startSec}-${s.endSec}x${s.speed ?? 1}`).join(','),
    // Include loop so the client re-transitions when the server breaks the idle
    // loop (trigger queued) — without this the video.loop attribute never updates
    // and handleEnded never fires, so triggers stay stuck in the queue forever.
    clip.loop ? 'loop' : 'once',
  ].join(':');
}

/** Quanto falta para o clipe no ar terminar (tempo do vídeo). */
function remainingSec(clip: VideoClip, element: HTMLVideoElement, segmentIndex: number) {
  const cuts = clip.segments && clip.segments.length > 0 ? clip.segments : null;
  if (cuts) {
    return segmentIndex >= cuts.length - 1 ? cuts[cuts.length - 1].endSec - element.currentTime : Number.POSITIVE_INFINITY;
  }
  const end = clip.endSec ?? (Number.isFinite(element.duration) ? element.duration : Number.POSITIVE_INFINITY);
  return end - element.currentTime;
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
  const activeSlotRef = useRef<0 | 1>(0);
  const endedRef = useRef('');
  // Índice do corte em reprodução em cada slot (clips com edição salva).
  const segmentIndexRef = useRef<[number, number]>([0, 0]);
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

  // Espelhos síncronos do estado: as emendas acontecem em eventos do vídeo e não
  // podem esperar a próxima renderização do React.
  const slotClipsRef = useRef<[VideoClip | null, VideoClip | null]>([null, null]);
  const currentKeyRef = useRef('');
  const busyRef = useRef(false);
  // Próximo clipe já carregado e parado no quadro da emenda, na camada escondida.
  const armedRef = useRef<{ slot: 0 | 1; key: string; clip: VideoClip; ready: boolean } | null>(null);
  // Emenda feita aqui antes do servidor saber: o estado atrasado não puxa de volta.
  const pendingSeamRef = useRef<{ fromKey: string; at: number } | null>(null);
  // Duração de um quadro do vídeo no ar (medida), para pular o quadro repetido.
  const frameSecRef = useRef(DEFAULT_FRAME_SEC);
  // Muda a cada troca: uma preparação antiga que termina depois não mexe no palco.
  const generationRef = useRef(0);

  const slotElement = useCallback((slot: 0 | 1) => (slot === 0 ? videoRefA : videoRefB).current, []);

  const setSlotClip = useCallback((slot: 0 | 1, clip: VideoClip | null) => {
    const next: [VideoClip | null, VideoClip | null] = [...slotClipsRef.current] as [VideoClip | null, VideoClip | null];
    next[slot] = clip;
    slotClipsRef.current = next;
    setSlotClips(next);
  }, []);

  const commitActive = useCallback((slot: 0 | 1, key: string) => {
    activeSlotRef.current = slot;
    currentKeyRef.current = key;
    setActiveSlot(slot);
    setCurrentKey(key);
  }, []);

  const fetchVideoState = useCallback(async (): Promise<VideoState | null> => {
    try {
      // Tempo limite: com o servidor engasgado, um pedido pendurado não pode
      // segurar o palco (nem as conexões do navegador) para sempre.
      const response = await fetch(apiUrl('/api/video/state'), { signal: AbortSignal.timeout(4000) });
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

  /** Configura uma camada para o clipe (fonte, repetir, som, velocidade) e aguarda os metadados. */
  const loadClipInto = useCallback(async (element: HTMLVideoElement, slot: 0 | 1, clip: VideoClip) => {
    const cuts = clip.segments && clip.segments.length > 0 ? clip.segments : null;
    segmentIndexRef.current[slot] = 0;
    element.loop = shouldLoopClip(clip);
    element.muted = (clip.audio?.mode || 'muted') !== 'original';
    element.volume = Math.max(0, Math.min(1, clip.audio?.volume ?? 1));
    // Usa o blob pré-carregado (instantâneo, em memória) quando disponível;
    // senão cai no stream normal. Sem stall de fetch → sem trava ao disparar.
    await loadSource(element, videoSrcFor(clip.videoId));
    element.playbackRate = segmentSpeed(cuts?.[0]);
  }, []);

  const applyAudio = useCallback(async (clip: VideoClip) => {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    if (clip.audio?.mode === 'track' && clip.audio.trackUrl) {
      audioElement.src = clip.audio.trackUrl;
      audioElement.loop = Boolean(clip.audio.trackLoop);
      audioElement.volume = Math.max(0, Math.min(1, clip.audio.volume ?? 1));
      audioElement.currentTime = 0;
      await audioElement.play().catch(() => undefined);
    } else {
      audioElement.pause();
      audioElement.removeAttribute('src');
    }
  }, []);

  /**
   * Deixa o próximo clipe esperado pronto na camada escondida, parado no quadro
   * da emenda. Quando o atual terminar, ele entra na hora.
   */
  const armNext = useCallback(
    async (state: VideoState) => {
      if (busyRef.current) return;
      const activeIdx = activeSlotRef.current;
      const activeClip = slotClipsRef.current[activeIdx];
      if (!activeClip || shouldLoopClip(activeClip) || clipKey(activeClip) !== currentKeyRef.current) return;
      // Sem próximo no fluxo o servidor volta ao idle; se o idle é o próprio
      // clipe, ele recomeça — a emenda é com ele mesmo.
      const expected = state.upcoming?.[0] ?? activeClip;
      const key = clipKey(expected);
      if (armedRef.current?.key === key) return;
      const slot: 0 | 1 = activeIdx === 0 ? 1 : 0;
      const element = slotElement(slot);
      if (!element) return;
      const generation = generationRef.current;
      armedRef.current = { slot, key, clip: expected, ready: false };
      element.pause();
      hideSlot(element);
      setSlotClip(slot, expected);
      await loadClipInto(element, slot, expected);
      if (generation !== generationRef.current || armedRef.current?.key !== key) return;
      await seekTo(element, seamStartSec(expected, frameSecRef.current));
      if (generation !== generationRef.current || armedRef.current?.key !== key) return;
      armedRef.current = { slot, key, clip: expected, ready: true };
    },
    [loadClipInto, setSlotClip, slotElement],
  );

  /**
   * O clipe no ar terminou. Com o próximo já pronto, ele entra no mesmo
   * instante (o servidor fica sabendo em paralelo); sem, avisa o servidor e
   * a troca vem pelo caminho normal.
   */
  const finishClip = useCallback(
    (slot: 0 | 1, endedClip: VideoClip) => {
      if (slot !== activeSlotRef.current) return;
      const endedKey = clipKey(endedClip);
      if (endedRef.current === endedKey) return;
      endedRef.current = endedKey;
      const armed = armedRef.current;
      const incoming = armed ? slotElement(armed.slot) : null;
      const outgoing = slotElement(slot);
      if (!armed || !armed.ready || armed.slot === slot || !incoming || busyRef.current) {
        void advanceAndRefresh(endedClip);
        return;
      }
      armedRef.current = null;
      busyRef.current = true;
      generationRef.current += 1;
      setIsTransitioning(true);
      void incoming.play().catch(() => undefined);
      // O quadro parado da camada pronta já é o seguinte ao último do clipe que
      // acabou: ela pode aparecer agora, sem esperar o play.
      const revealed = revealSlot(incoming, outgoing, SEAM_BLEND_MS);
      pendingSeamRef.current = { fromKey: endedKey, at: Date.now() };
      endedRef.current = '';
      commitActive(armed.slot, armed.key);
      playedVersionRef.current = videoVersion(armed.clip.videoId);
      void applyAudio(armed.clip);
      void advanceAndRefresh(endedClip).finally(() => {
        pendingSeamRef.current = null;
      });
      void revealed.then(() => {
        busyRef.current = false;
        setIsTransitioning(false);
      });
    },
    [advanceAndRefresh, applyAudio, commitActive, slotElement],
  );

  const transitionToClip = useCallback(
    async (clip: VideoClip, state?: VideoState | null) => {
      const key = clipKey(clip);
      if (!key || busyRef.current || key === currentKeyRef.current) return;

      const previousSlot = activeSlotRef.current;
      const previousElement = slotElement(previousSlot);
      const activeClip = slotClipsRef.current[previousSlot];

      if (previousElement && activeClip && currentKeyRef.current) {
        // Mesmo vídeo, mesmo trecho — só o "repetir" mudou (o idle teve o loop
        // quebrado por um gatilho): segue tocando na mesma camada, sem troca.
        if (sameFootage(activeClip, clip)) {
          previousElement.loop = shouldLoopClip(clip);
          setSlotClip(previousSlot, clip);
          commitActive(previousSlot, key);
          return;
        }
        // Outro player avisou o fim antes deste: o próximo já está pronto aqui e
        // o atual está no finzinho — deixa terminar e emendar no quadro certo.
        if (
          !previousElement.paused &&
          shouldWaitForNaturalEnd({
            incomingKey: key,
            armedKey: armedRef.current?.ready ? armedRef.current.key : null,
            activeLoops: previousElement.loop,
            remainingSec: remainingSec(activeClip, previousElement, segmentIndexRef.current[previousSlot]),
          })
        ) {
          return;
        }
      }

      const nextSlot: 0 | 1 = previousSlot === 0 ? 1 : 0;
      const nextElement = slotElement(nextSlot);
      if (!nextElement) return;

      busyRef.current = true;
      generationRef.current += 1;
      const generation = generationRef.current;
      setIsTransitioning(true);
      endedRef.current = '';
      const finish = () => {
        busyRef.current = false;
        setIsTransitioning(false);
      };

      const armed = armedRef.current;
      armedRef.current = null;
      const cuts = clip.segments && clip.segments.length > 0 ? clip.segments : null;
      const startSec = clipStartSec(clip);

      if (armed && armed.key === key && armed.ready && armed.slot === nextSlot) {
        // Já está pronto na camada escondida (parado no início).
      } else {
        nextElement.pause();
        hideSlot(nextElement);
        setSlotClip(nextSlot, clip);
        await loadClipInto(nextElement, nextSlot, clip);
        if (generation !== generationRef.current) return finish();

        const elapsed =
          state?.server_time && state?.start_ts ? Math.max(0, state.server_time - state.start_ts) : 0;
        const endSec = clip.endSec ?? Number.POSITIVE_INFINITY;
        // Com cortes, "já acabou?" é medido em tempo de relógio (velocidade por corte).
        const cutsClockSec = cuts
          ? cuts.reduce((sum, s) => sum + Math.max(0, s.endSec - s.startSec) / segmentSpeed(s), 0)
          : 0;
        const duration = Number.isFinite(nextElement.duration) ? nextElement.duration : 0;
        const loopDuration = Math.max(0, Math.min(endSec, duration || endSec) - startSec);
        const naturalEndSec = Number.isFinite(endSec) ? endSec : duration;
        // Idle whose loop was broken by a queued trigger: the idle may have been
        // looping for minutes, so `elapsed` >> `duration`. Use elapsed % duration to
        // find the position within the *current* cycle rather than skipping it.
        // returnToIdle === false is the reliable idle identifier (reactions have true).
        const isIdleLoopBreak = !shouldLoopClip(clip) && clip.returnToIdle === false && duration > 0;
        const effectiveElapsed = isIdleLoopBreak && loopDuration > 0 ? elapsed % loopDuration : elapsed;
        const alreadyOver = cuts
          ? effectiveElapsed >= cutsClockSec - 0.1
          : naturalEndSec > 0 && startSec + effectiveElapsed >= naturalEndSec - 0.1;
        if (!shouldLoopClip(clip) && alreadyOver) {
          finish();
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
        await seekTo(nextElement, Math.min(targetTime, Math.max(0, endSec - 0.05)));
        if (generation !== generationRef.current) return finish();
      }

      await nextElement.play().catch(() => undefined);
      // Só aparece com um quadro novo já na tela: nada de quadro preto.
      await waitForPresentedFrame(nextElement);
      if (generation !== generationRef.current) return finish();
      const revealed = revealSlot(nextElement, previousElement, clampFadeMs(clip.transitionMs ?? 220));
      commitActive(nextSlot, key);
      void applyAudio(clip);
      await revealed;
      finish();
    },
    [advanceAndRefresh, applyAudio, commitActive, loadClipInto, setSlotClip, slotElement],
  );

  // O laço do palco monta UMA vez e lê os valores atuais por esta ref. Antes ele
  // dependia de currentKey/transitionToClip, que mudam a cada troca de clip: o
  // efeito era recriado ~3 vezes por transição, cada vez com uma consulta
  // imediata (o overlay pedia o estado ~1,3×/s mesmo com o palco parado).
  const loopRef = useRef({ advanceAndRefresh, armNext, checkAndFireSchedules, fetchVideoState, transitionToClip });
  useEffect(() => {
    loopRef.current = { advanceAndRefresh, armNext, checkAndFireSchedules, fetchVideoState, transitionToClip };
  });
  const tickNowRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let lastTickAt = 0;
    const guardedTick = async () => {
      // Um tick por vez: antes, com o servidor lento, um novo pedido saía a
      // cada 500 ms mesmo com os anteriores pendentes, e eles se empilhavam.
      if (inFlight) return;
      inFlight = true;
      lastTickAt = Date.now();
      try {
        await tick();
      } finally {
        inFlight = false;
      }
    };
    const tick = async () => {
      const { advanceAndRefresh, armNext, checkAndFireSchedules, fetchVideoState, transitionToClip } = loopRef.current;
      const state = await fetchVideoState();
      if (cancelled || !state) return;
      // Fire any due schedules before processing clip transitions so that the
      // trigger is already in the server queue when /video/advance is called.
      await checkAndFireSchedules(state);
      const nextClip =
        state.currentClip ||
        (state.current_video_id ? clipFromVideoId(state.current_video_id) : null);

      // TRAVA DE FLUXO: o overlay só toca o que é do fluxo. Se o servidor mandar
      // um vídeo fora dele (ex.: um trigger/automação velho disparado por um
      // presente real do chat), não toca — empurra o servidor adiante (uma vez
      // por vídeo) e mantém o que já está no ar.
      // Quem decide é o MOTOR (`inFlow`, calculado com a config que ele executa).
      // Antes a trava comparava com o fluxo publicado baixado a cada 2 min e,
      // no boot, com uma config vazia embutida no build: tudo — até o idle —
      // parecia "fora do fluxo" e era pulado. Servidor antigo sem o campo: passa.
      const inFlow = !nextClip || state.inFlow !== false;
      if (nextClip && !inFlow) {
        if (rogueAdvancedRef.current !== nextClip.videoId) {
          rogueAdvancedRef.current = nextClip.videoId;
          console.warn(`[Odessa] vídeo fora do fluxo IGNORADO: ${nextClip.videoId}`);
          await advanceAndRefresh(nextClip);
        }
        return;
      }
      rogueAdvancedRef.current = '';
      if (!nextClip) return;
      const nextKey = clipKey(nextClip);

      // A emenda já trocou o clipe aqui; o servidor ainda não registrou o fim.
      if (isStaleAfterSeam(pendingSeamRef.current, nextKey, Date.now())) return;

      if (nextKey !== currentKeyRef.current) {
        await transitionToClip(nextClip, state);
        playedVersionRef.current = videoVersion(nextClip.videoId);
      } else {
        // Mesmo clipe no ar: se o operador TROCOU o conteúdo do vídeo, o blob novo
        // já foi baixado com versão nova — força recarregar pra trocar na hora,
        // em vez de continuar tocando o vídeo antigo (clipKey não muda sozinho).
        const ver = videoVersion(nextClip.videoId);
        if (playedVersionRef.current && ver && ver !== playedVersionRef.current) {
          playedVersionRef.current = ver;
          armedRef.current = null;
          currentKeyRef.current = '';
          setCurrentKey(''); // o próximo tick re-transiciona pro conteúdo novo
          return;
        }
        if (!cancelled) await armNext(state);
      }
    };

    tickNowRef.current = () => void guardedTick();
    void guardedTick();
    // O servidor avisa (SSE) quando o palco muda: o tick roda na hora. A
    // consulta de 500 ms vira reserva de 2 s enquanto o aviso funciona (ela
    // ainda cuida das automações agendadas e de quedas do aviso).
    const unsubscribe = subscribeVideoState(() => void guardedTick());
    const interval = window.setInterval(() => {
      if (isVideoStateStreaming() && Date.now() - lastTickAt < STREAMING_TICK_MS) return;
      void guardedTick();
    }, 500);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(interval);
    };
  }, []);

  // Fim de uma transição (ou clip marcado para recarregar): confere o palco na
  // hora — e deixa o próximo clipe pronto para a emenda.
  useEffect(() => {
    if (!isTransitioning) tickNowRef.current();
  }, [isTransitioning, currentKey]);

  const handleProgress = useCallback(
    (index: 0 | 1, element: HTMLVideoElement) => {
      const slotClip = slotClipsRef.current[index];
      if (!slotClip || index !== activeSlotRef.current) return;
      const cuts = slotClip.segments && slotClip.segments.length > 0 ? slotClip.segments : null;
      if (cuts) {
        const step = nextSegmentStep(cuts, segmentIndexRef.current[index], element.currentTime);
        if (step.action === 'jump') {
          segmentIndexRef.current[index] = step.index;
          element.playbackRate = step.speed;
          try {
            element.currentTime = step.startSec;
          } catch {
            // seek pode falhar por um instante no OBS — tenta de novo no próximo quadro
          }
        } else if (step.action === 'end') {
          finishClip(index, slotClip);
        }
        return;
      }
      if (slotClip.endSec && element.currentTime >= slotClip.endSec) finishClip(index, slotClip);
    },
    [finishClip],
  );

  const handleEnded = useCallback(
    (index: 0 | 1) => {
      const slotClip = slotClipsRef.current[index];
      if (!slotClip || shouldLoopClip(slotClip)) return;
      finishClip(index, slotClip);
    },
    [finishClip],
  );

  // A cada quadro apresentado: mede a duração do quadro e confere o fim de
  // cortes/trechos (o timeupdate só vem a cada ~250 ms e passava do ponto).
  useEffect(() => {
    const handles: Array<() => void> = [];
    ([0, 1] as const).forEach((index) => {
      const element = slotElement(index) as
        | (HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
            cancelVideoFrameCallback?: (handle: number) => void;
          })
        | null;
      if (!element?.requestVideoFrameCallback) return;
      let lastMedia = -1;
      let handle = 0;
      let stopped = false;
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        if (stopped) return;
        if (lastMedia >= 0) frameSecRef.current = nextFrameSec(frameSecRef.current, meta.mediaTime - lastMedia);
        lastMedia = meta.mediaTime;
        handleProgress(index, element);
        // Último quadro do vídeo na tela: a emenda entra exatamente um quadro
        // depois, sem esperar o evento "ended" (que chega atrasado).
        const slotClip = slotClipsRef.current[index];
        if (
          slotClip &&
          index === activeSlotRef.current &&
          !element.loop &&
          !slotClip.endSec &&
          !slotClip.segments?.length &&
          isLastFrame(meta.mediaTime, element.duration, frameSecRef.current)
        ) {
          window.setTimeout(() => handleEnded(index), (frameSecRef.current * 1000) / (element.playbackRate || 1));
        }
        handle = element.requestVideoFrameCallback!(onFrame);
      };
      handle = element.requestVideoFrameCallback(onFrame);
      handles.push(() => {
        stopped = true;
        element.cancelVideoFrameCallback?.(handle);
      });
    });
    return () => handles.forEach((stop) => stop());
  }, [handleEnded, handleProgress, slotElement]);


  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black">
      {slotClips.map((slotClip, index) => (
        // Fonte, repetir, som e visibilidade são controlados direto no elemento
        // (stageSlots): o React reaplicar `src` recarregava o vídeo depois da
        // busca, e `autoPlay` faria a camada pronta sair tocando escondida.
        <video
          key={index}
          ref={index === 0 ? videoRefA : videoRefB}
          muted
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          preload="auto"
          data-clip={slotClip?.videoId || ''}
          data-active={activeSlot === index}
          onTimeUpdate={(event) => handleProgress(index as 0 | 1, event.currentTarget)}
          onEnded={() => handleEnded(index as 0 | 1)}
          className="absolute inset-0 w-full origin-top object-contain"
          style={{
            height: '104%',
            opacity: 0,
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
