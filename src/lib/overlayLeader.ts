/**
 * Só UM overlay ativo por vez.
 *
 * Duas fontes de navegador no OBS apontando para `#overlay` (ex.: uma cópia
 * esquecida) tocavam os vídeos em dobro e disputavam o avanço do fluxo — no
 * OBS isso vazava ~2 GB/min de memória de vídeo e travava o PC inteiro.
 *
 * As cópias conversam por BroadcastChannel: a MAIS ANTIGA manda (a fonte que
 * já está no ar continua no ar) e as outras ficam em branco, sem vídeo nem
 * polling. Se a líder fecha, a próxima assume em ~3 s. Sem BroadcastChannel
 * (ambiente antigo), cada cópia se considera líder — o comportamento de antes.
 */
import { useEffect, useState } from 'react';

const CHANNEL = 'odessa-overlay';
const HEARTBEAT_MS = 1000;
const TAKEOVER_MS = 3000;
const STARTUP_LISTEN_MS = 700;

type Beat = { type: 'leader'; id: string; since: number };

/** a "vence" b: começou antes (empate desfeito pelo id). */
export function outranks(a: { id: string; since: number }, b: { id: string; since: number }): boolean {
  return a.since < b.since || (a.since === b.since && a.id < b.id);
}

export function useOverlayLeader(): boolean {
  const [leader, setLeader] = useState(() => typeof BroadcastChannel === 'undefined');

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const me = { id: Math.random().toString(36).slice(2), since: Date.now() };
    const channel = new BroadcastChannel(CHANNEL);
    const startedAt = Date.now();
    let isLeader = false;
    let heardLeader = false;
    let lastForeignBeat = 0;

    const become = (next: boolean) => {
      if (isLeader === next) return;
      isLeader = next;
      setLeader(next);
      if (!next) console.info('[Odessa] Outro overlay já está ativo — esta cópia fica em espera (sem vídeo).');
    };

    channel.onmessage = (event: MessageEvent<Beat>) => {
      const beat = event.data;
      if (!beat || beat.type !== 'leader' || beat.id === me.id) return;
      if (outranks(beat, me)) {
        heardLeader = true;
        lastForeignBeat = Date.now();
        become(false);
      }
    };

    const tick = () => {
      if (isLeader) {
        channel.postMessage({ type: 'leader', ...me } satisfies Beat);
        return;
      }
      const now = Date.now();
      // Ao abrir, escuta um instante: se já há um overlay no ar, ele responde.
      // Depois, assume se a líder parar de dar sinal (fonte fechada/removida).
      const leaderGone = heardLeader ? now - lastForeignBeat > TAKEOVER_MS : now - startedAt >= STARTUP_LISTEN_MS;
      if (leaderGone) {
        become(true);
        channel.postMessage({ type: 'leader', ...me } satisfies Beat);
      }
    };
    const beat = setInterval(tick, HEARTBEAT_MS);

    return () => {
      clearInterval(beat);
      channel.close();
    };
  }, []);

  return leader;
}
