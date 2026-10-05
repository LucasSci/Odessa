/**
 * videoStateEvents — aviso imediato de que o estado do palco mudou.
 *
 * O servidor empurra o estado por SSE (/video/events) só quando ele muda. Uma
 * conexão por janela, compartilhada por quem precisar (overlay, Ao Vivo,
 * fluxo). Quem escuta continua consultando /video/state, mas devagar, como
 * reserva: antes eram 2 consultas/s do overlay + 1/s de cada tela, mesmo com
 * nada mudando.
 */
import { useEffect, useRef, useState } from 'react';
import { apiUrl } from './api';

type Listener = () => void;

const listeners = new Set<Listener>();
const connectionListeners = new Set<(connected: boolean) => void>();
let source: EventSource | null = null;
let connected = false;

function setConnected(next: boolean) {
  if (next === connected) return;
  connected = next;
  for (const listener of connectionListeners) listener(next);
}

function open() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource(apiUrl('/api/video/events'));
  source.onopen = () => setConnected(true);
  // O EventSource reconecta sozinho (retry de 3 s mandado pelo servidor);
  // enquanto isso, quem escuta volta à consulta rápida.
  source.onerror = () => setConnected(false);
  source.onmessage = () => {
    for (const listener of listeners) listener();
  };
}

function closeIfUnused() {
  if (listeners.size > 0 || !source) return;
  source.close();
  source = null;
  setConnected(false);
}

/** Avisa `listener` a cada mudança de estado do palco. Devolve o cancelamento. */
export function subscribeVideoState(listener: Listener): () => void {
  listeners.add(listener);
  open();
  return () => {
    listeners.delete(listener);
    // Quem reassina logo em seguida (efeito do React que roda de novo) reaproveita
    // a conexão em vez de fechar e reconectar.
    setTimeout(closeIfUnused, 2000);
  };
}

export function isVideoStateStreaming(): boolean {
  return connected;
}

/**
 * Chama `onChange` quando o estado do palco muda e diz se o aviso está
 * funcionando (para a tela espaçar a consulta de reserva).
 */
export function useVideoStateNudge(onChange: () => void, enabled = true): boolean {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  const [streaming, setStreaming] = useState(connected);

  useEffect(() => {
    if (!enabled) return;
    const onConnection = (next: boolean) => setStreaming(next);
    connectionListeners.add(onConnection);
    const unsubscribe = subscribeVideoState(() => latest.current());
    return () => {
      connectionListeners.delete(onConnection);
      unsubscribe();
    };
  }, [enabled]);

  return enabled && streaming;
}
