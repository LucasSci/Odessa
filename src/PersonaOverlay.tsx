import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from './lib/api';
import { cn } from './lib/utils';

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

type VideoState = {
  current_video_id?: string;
  start_ts?: number;
  server_time?: number;
  currentClip?: VideoClip | null;
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

      nextElement.src = apiUrl(`/api/video/play/${clip.videoId}`);
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
      const nextClip =
        state.currentClip ||
        (state.current_video_id ? clipFromVideoId(state.current_video_id) : null);
      if (nextClip && clipKey(nextClip) !== currentKey) {
        await transitionToClip(nextClip, state);
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
  }, [currentKey, fetchVideoState, transitionToClip]);

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
          src={slotClip ? apiUrl(`/api/video/play/${slotClip.videoId}`) : undefined}
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
