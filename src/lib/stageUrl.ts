/**
 * Endereço do overlay que o OBS abre na fonte de navegador do palco.
 *
 * O padrão antigo era `http://localhost:3000/#overlay` (o servidor de
 * desenvolvimento). No Odessa instalado nada responde na 3000 e o OBS mostrava
 * a fonte vazia. Agora: vazio ou o padrão antigo = "automático", que é o próprio
 * endereço em que o app está aberto (127.0.0.1:8000 no instalado, 3000 em dev).
 * Uma URL escolhida à mão continua valendo.
 */
const LEGACY_DEV_URLS = new Set(['http://localhost:3000/#overlay', 'http://127.0.0.1:3000/#overlay']);

export function resolveStageUrl(configured: string | undefined | null, origin: string): string {
  const url = (configured || '').trim();
  const auto = `${origin.replace(/\/$/, '')}/#overlay`;
  if (!url) return auto;
  if (LEGACY_DEV_URLS.has(url) && !/^https?:\/\/(localhost|127\.0\.0\.1):3000$/.test(origin)) return auto;
  return url;
}
