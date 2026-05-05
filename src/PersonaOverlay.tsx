import { useEffect, useRef, useState, useCallback } from 'react';
import { apiUrl } from './lib/api';
import { cn } from './lib/utils';

interface VideoState {
  id: string;
  label: string;
}

export default function PersonaOverlay() {
  const videoRefA = useRef<HTMLVideoElement>(null);
  const videoRefB = useRef<HTMLVideoElement>(null);
  
  const [pendingVideoId, setPendingVideoId] = useState<string | null>(null);
  const [activePlayer, setActivePlayer] = useState<'A' | 'B'>('A');
  const [currentVideoId, setCurrentVideoId] = useState<string>('');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [videoPath] = useState('/api/video/play/');

  // SYNC LOGIC: Follow the Master (Studio) state
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(apiUrl('/api/video/state'));
        const state = await res.json();
        
        if (state.current_video_id && state.current_video_id !== currentVideoId && !isTransitioning) {
          transitionToVideo(state.current_video_id);
        }
      } catch (e) {}
    }, 500); // Polling mais rápido (0.5s)
    return () => clearInterval(interval);
  }, [currentVideoId, isTransitioning, activePlayer]);

  const transitionToVideo = useCallback(async (targetVideoId: string) => {
    if (isTransitioning || !targetVideoId) return;

    const nextPlayer = activePlayer === 'A' ? 'B' : 'A';
    const currRef = activePlayer === 'A' ? videoRefA : videoRefB;
    const nextRef = activePlayer === 'A' ? videoRefB : videoRefA;

    if (!currRef.current || !nextRef.current) return;

    setIsTransitioning(true);
    nextRef.current.src = apiUrl(`${videoPath}${targetVideoId}`);
    
    try {
      // 1. Pegar o tempo exato do Master ANTES de dar o play
      const res = await fetch(apiUrl('/api/video/state'));
      const state = await res.json();
      
      // 2. Play
      await nextRef.current.play();
      
      // 3. Ajustar o tempo para sincronia perfeita
      const elapsed = state.server_time - state.start_ts;
      if (elapsed > 0 && elapsed < nextRef.current.duration) {
        nextRef.current.currentTime = elapsed;
      }
      
      // 4. Swap
      nextRef.current.style.opacity = '1';
      currRef.current.style.opacity = '0';
      currRef.current.pause();
      
      setActivePlayer(nextPlayer);
      setCurrentVideoId(targetVideoId);
      setIsTransitioning(false);
      currRef.current.src = '';
    } catch (err) {
      console.error('[OVERLAY] Sync Transition failed:', err);
      setIsTransitioning(false);
    }
  }, [activePlayer, isTransitioning, videoPath]);

  // Initial load: Sync with current backend state
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch(apiUrl('/api/video/state'));
        const state = await res.json();
        const vid = state.current_video_id || 'grok-998cb92c-3b48-4c1a-ba60-51ffa08ae60e-720p';
        setCurrentVideoId(vid);
        if (videoRefA.current) videoRefA.current.src = apiUrl(`${videoPath}${vid}`);
      } catch (e) {}
    };
    init();
  }, [videoPath]);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden flex items-center justify-center">
      <video
        ref={videoRefA}
        autoPlay
        muted
        loop
        playsInline
        className={cn(
          "absolute inset-0 w-full h-full object-contain transition-opacity duration-0",
          activePlayer === 'A' ? "opacity-100" : "opacity-0"
        )}
        src={currentVideoId ? apiUrl(`${videoPath}${currentVideoId}`) : undefined}
      />
      <video
        ref={videoRefB}
        autoPlay
        muted
        loop
        playsInline
        className={cn(
          "absolute inset-0 w-full h-full object-contain transition-opacity duration-0",
          activePlayer === 'B' ? "opacity-100" : "opacity-0"
        )}
      />
      
      {/* Stealth Status Indicator (Optional, invisible to OBS) */}
      <div className="absolute bottom-2 right-2 opacity-0 hover:opacity-100 transition">
        <span className="text-[10px] text-white/20 font-mono">ODESSA_OVERLAY_SYNC_ACTIVE</span>
      </div>
    </div>
  );
}
