/**
 * Emenda contínua do palco: regras puras de quando e onde o próximo clipe entra.
 *
 * Os clipes do fluxo são gerados em sequência: o primeiro quadro de cada um é o
 * último do anterior. Para a troca não aparecer, o próximo clipe já fica
 * carregado e parado no quadro certo na camada escondida, e entra no instante
 * em que o atual termina, sem esperar o servidor.
 */

export interface SeamClip {
  nodeId?: string | null;
  videoId: string;
  startSec?: number;
  endSec?: number | null;
  loop?: boolean;
  segments?: Array<{ startSec: number; endSec: number; speed?: number }>;
}

/**
 * Quadro padrão enquanto o vídeo no ar ainda não mostrou o dele. 1/24 s é o
 * quadro mais longo comum: com vídeo mais rápido, buscar 1/24 s pula no máximo
 * 1 quadro a mais, nunca fica no repetido.
 */
export const DEFAULT_FRAME_SEC = 1 / 24;

/** Mistura curta na emenda: esconde a diferença de textura entre os dois quadros iguais. */
export const SEAM_BLEND_MS = 90;

/** Se o clipe no ar termina em até isso, o próximo espera ele acabar em vez de cortá-lo. */
export const NATURAL_END_WINDOW_SEC = 2;

/** Início do clipe na reprodução (o do primeiro corte, quando há cortes). */
export function clipStartSec(clip: SeamClip): number {
  const cuts = clip.segments && clip.segments.length > 0 ? clip.segments : null;
  return Math.max(0, cuts ? cuts[0].startSec : clip.startSec || 0);
}

/**
 * Onde o próximo clipe começa numa emenda: um quadro depois do início, porque o
 * primeiro quadro repete o último do anterior (que acabou de ficar na tela).
 * Clipe com corte no início não repete quadro nenhum: começa no corte.
 */
export function seamStartSec(clip: SeamClip, frameSec: number): number {
  const start = clipStartSec(clip);
  if (start > 0) return start;
  const frame = Number.isFinite(frameSec) && frameSec > 0 && frameSec < 0.2 ? frameSec : DEFAULT_FRAME_SEC;
  // No meio do 2º quadro: a busca para no quadro com início <= t, e o meio
  // não cai no 1º por arredondamento.
  return frame * 1.5;
}

/** Os dois clipes são o mesmo vídeo no mesmo trecho (só o "repetir" mudou)? */
export function sameFootage(a: SeamClip | null | undefined, b: SeamClip | null | undefined): boolean {
  if (!a || !b) return false;
  const cuts = (c: SeamClip) => (c.segments || []).map((s) => `${s.startSec}-${s.endSec}x${s.speed ?? 1}`).join(',');
  return (
    (a.nodeId || '') === (b.nodeId || '') &&
    a.videoId === b.videoId &&
    (a.startSec || 0) === (b.startSec || 0) &&
    (a.endSec ?? null) === (b.endSec ?? null) &&
    cuts(a) === cuts(b)
  );
}

/**
 * O servidor já está no clipe seguinte, mas o daqui ainda não terminou (outro
 * player avisou o fim antes). Se falta pouco, deixa terminar: a emenda entra no
 * fim certo em vez de cortar o vídeo no meio.
 */
export function shouldWaitForNaturalEnd(args: {
  incomingKey: string;
  armedKey: string | null;
  activeLoops: boolean;
  remainingSec: number;
}): boolean {
  if (!args.armedKey || args.incomingKey !== args.armedKey || args.activeLoops) return false;
  return args.remainingSec > 0 && args.remainingSec <= NATURAL_END_WINDOW_SEC;
}

/**
 * Depois de uma emenda feita aqui, o servidor ainda mostra o clipe que acabou até
 * receber o aviso. Esse estado atrasado não pode puxar o palco de volta.
 */
export function isStaleAfterSeam(
  pending: { fromKey: string; at: number } | null,
  incomingKey: string,
  now: number,
  maxAgeMs = 5000,
): boolean {
  return Boolean(pending && pending.fromKey === incomingKey && now - pending.at < maxAgeMs);
}

/**
 * Duração de um quadro (em tempo do vídeo) a partir de dois quadros apresentados
 * em seguida. Com quadros pulados o salto é um múltiplo, então fica o menor visto.
 */
export function nextFrameSec(currentSec: number, deltaSec: number): number {
  if (!(deltaSec > 0.005 && deltaSec < 0.2)) return currentSec;
  return Math.min(currentSec, deltaSec);
}

/** O quadro apresentado é o último do vídeo? */
export function isLastFrame(mediaTimeSec: number, durationSec: number, frameSec: number): boolean {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return false;
  return mediaTimeSec >= durationSec - frameSec * 1.5;
}
