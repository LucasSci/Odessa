/**
 * VideoThumb — miniatura de um clip, usada na Biblioteca, no Fluxo e no Deck.
 *
 * - Mostra um JPEG (/video/thumb/{id}), não o vídeo. Com dezenas de clips na
 *   tela, cada <video> segurava uma das 6 conexões por origem e a API ficava
 *   na fila. Se o JPEG ainda não existe, ele é gerado uma vez (ver
 *   lib/videoPoster.ts) e fica guardado no servidor.
 * - Só pede a imagem quando a miniatura chega perto da tela (IntersectionObserver).
 * - `previewOnHover`: com o mouse em cima, abre o vídeo e toca mudo, localmente
 *   — uma prévia de verdade, que não mexe no que está no ar. Ao sair, fecha.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import { generatePoster, posterUrl, videoIdFromSrc } from '../lib/videoPoster';

export function VideoThumb({
  src,
  videoId: videoIdProp,
  label,
  className,
  fit = 'cover',
  previewOnHover = false,
}: {
  src: string;
  /** Id do clip; sem ele, sai da URL /video/play/{id}. */
  videoId?: string;
  /** Nome do clip, lido por leitor de tela. */
  label: string;
  className?: string;
  fit?: 'cover' | 'contain';
  previewOnHover?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Sem IntersectionObserver (jsdom, navegadores antigos) carrega direto.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  const videoId = videoIdProp || videoIdFromSrc(src);
  const [imageSrc, setImageSrc] = useState<string | null>(() => (videoId ? posterUrl(videoId) : null));
  const [failed, setFailed] = useState(false);
  const [hovering, setHovering] = useState(false);

  // Outro clip no mesmo lugar: recomeça pela miniatura dele.
  const [shownId, setShownId] = useState(videoId);
  if (shownId !== videoId) {
    setShownId(videoId);
    setImageSrc(videoId ? posterUrl(videoId) : null);
    setFailed(false);
  }

  useEffect(() => {
    const box = boxRef.current;
    if (inView || !box) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [inView]);

  const onImageError = () => {
    if (!videoId || (imageSrc && imageSrc.startsWith('blob:'))) {
      setFailed(true);
      return;
    }
    void generatePoster(videoId, src).then((url) => {
      if (url) setImageSrc(url);
      else setFailed(true);
    });
  };

  const fitClass = fit === 'cover' ? 'object-cover' : 'object-contain';
  const showVideo = previewOnHover && hovering;

  return (
    <div
      ref={boxRef}
      role="img"
      aria-label={label}
      className={cn('relative overflow-hidden bg-black', className)}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      {inView && imageSrc && !failed && (
        <img
          src={imageSrc}
          alt=""
          aria-hidden="true"
          decoding="async"
          draggable={false}
          className={cn('h-full w-full', fitClass)}
          onError={onImageError}
        />
      )}
      {inView && showVideo && (
        <video
          src={src}
          muted
          playsInline
          autoPlay
          loop
          preload="auto"
          tabIndex={-1}
          aria-hidden="true"
          className={cn('absolute inset-0 h-full w-full', fitClass)}
        />
      )}
      {(failed || (inView && !imageSrc)) && !showVideo && (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--t3)]">sem prévia</span>
      )}
    </div>
  );
}
