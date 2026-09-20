import { useEffect, useRef } from 'react';

export interface PollingOptions {
  /** Liga/desliga o polling (ex.: só quando a aba do painel está ativa). Padrão: true. */
  enabled?: boolean;
  /** Roda uma vez logo ao ligar, sem esperar o primeiro intervalo. Padrão: true. */
  immediate?: boolean;
  /**
   * Pausa enquanto a aba do navegador está oculta e refaz uma consulta ao voltar.
   * Padrão: true. Use `false` no que alimenta a live (a aba do operador pode ficar
   * em segundo plano com o OBS na frente).
   */
  pauseWhenHidden?: boolean;
  /** Teto do espaçamento crescente depois de falhas. Padrão: 8x o intervalo. */
  maxBackoffMs?: number;
  /** Quando muda (ex.: id da persona ou filtro), reinicia e consulta de novo na hora. */
  restartKey?: unknown;
}

/** Próximo espaçamento: dobra a cada falha seguida, limitado a `maxMs`; sucesso volta ao normal. */
export function nextPollDelay(intervalMs: number, failures: number, maxMs: number): number {
  if (failures <= 0) return intervalMs;
  return Math.min(maxMs, intervalMs * 2 ** Math.min(failures, 10));
}

/**
 * Consulta periódica sem os defeitos dos `setInterval` soltos:
 * - a próxima consulta só é agendada quando a anterior termina (nada de pedidos empilhados
 *   quando o backend está lento);
 * - falha (exceção/rejeição) espaça as tentativas em vez de martelar um backend caído;
 * - pausa com a aba oculta (opcional) e retoma na hora ao voltar;
 * - cancela o pedido em andamento (AbortSignal) ao desmontar ou desligar.
 *
 * `callback` pode mudar a cada render: sempre roda a versão mais recente, sem reiniciar o timer.
 */
export function usePolling(
  callback: (signal: AbortSignal) => unknown | Promise<unknown>,
  intervalMs: number,
  options: PollingOptions = {},
): void {
  const { enabled = true, immediate = true, pauseWhenHidden = true, maxBackoffMs, restartKey } = options;
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    const maxMs = maxBackoffMs ?? intervalMs * 8;
    let stopped = false;
    let timer: number | undefined;
    let running = false;
    let failures = 0;
    let controller = new AbortController();

    const hidden = () => pauseWhenHidden && document.visibilityState === 'hidden';

    const schedule = () => {
      if (stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, nextPollDelay(intervalMs, failures, maxMs));
    };

    async function tick() {
      if (stopped || running) return;
      if (hidden()) return; // reagendado pelo visibilitychange
      running = true;
      controller = new AbortController();
      try {
        await latest.current(controller.signal);
        failures = 0;
      } catch {
        if (!stopped) failures += 1;
      } finally {
        running = false;
        schedule();
      }
    }

    const onVisibility = () => {
      if (stopped || hidden()) return;
      window.clearTimeout(timer);
      void tick();
    };

    if (pauseWhenHidden) document.addEventListener('visibilitychange', onVisibility);
    if (immediate) void tick();
    else schedule();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      controller.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs, immediate, pauseWhenHidden, maxBackoffMs, restartKey]);
}
