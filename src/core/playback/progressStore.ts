import { useSyncExternalStore } from 'react';

export interface PlaybackProgress {
  videoId: string;
  elapsedSec: number;
  totalSec: number;
}

// Store minúsculo fora do React: o player publica ~4x/s e só quem assina
// (a barra de progresso) re-renderiza — o Palco inteiro não.
let current: PlaybackProgress | null = null;
const listeners = new Set<() => void>();

export function publishProgress(next: PlaybackProgress | null): void {
  if (
    next &&
    current &&
    next.videoId === current.videoId &&
    next.totalSec === current.totalSec &&
    Math.abs(next.elapsedSec - current.elapsedSec) < 0.1
  ) {
    return;
  }
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PlaybackProgress | null {
  return current;
}

export function usePlaybackProgress(): PlaybackProgress | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
