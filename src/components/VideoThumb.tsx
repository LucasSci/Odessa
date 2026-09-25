/**
 * VideoThumb — miniatura de um clip, usada na Biblioteca, no Fluxo e no Deck.
 *
 * - Só pede o vídeo quando a miniatura entra na tela (IntersectionObserver).
 *   Antes cada lista abria dezenas de <video> de uma vez, disputando as 6
 *   conexões HTTP/1.1 por origem com a API e o player do Palco.
 * - `#t=0.5` faz o navegador decodificar um quadro; sem isso o Chrome/Edge
 *   deixava a miniatura preta mesmo com o vídeo carregado.
 * - `previewOnHover`: toca o clip mudo, localmente, com o mouse em cima — uma
 *   prévia de verdade, que não mexe no que está no ar.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

const FRAME_TIME_SEC = 0.5;

export function VideoThumb({
  src,
  label,
  className,
  fit = 'cover',
  previewOnHover = false,
}: {
  src: string;
  /** Nome do clip, lido por leitor de tela. */
  label: string;
  className?: string;
  fit?: 'cover' | 'contain';
  previewOnHover?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Sem IntersectionObserver (jsdom, navegadores antigos) carrega direto.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  const [failed, setFailed] = useState(false);

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
      { rootMargin: '300px' },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [inView]);

  const startPreview = () => {
    const video = videoRef.current;
    if (!previewOnHover || !video) return;
    void video.play().catch(() => undefined);
  };
  const stopPreview = () => {
    const video = videoRef.current;
    if (!previewOnHover || !video) return;
    video.pause();
    video.currentTime = FRAME_TIME_SEC;
  };

  return (
    <div
      ref={boxRef}
      role="img"
      aria-label={label}
      className={cn('relative overflow-hidden bg-black', className)}
      onPointerEnter={startPreview}
      onPointerLeave={stopPreview}
    >
      {inView && !failed && (
        <video
          ref={videoRef}
          src={`${src}#t=${FRAME_TIME_SEC}`}
          muted
          playsInline
          loop={previewOnHover}
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
          className={cn('h-full w-full', fit === 'cover' ? 'object-cover' : 'object-contain')}
          onError={() => setFailed(true)}
        />
      )}
      {failed && (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--t3)]">sem prévia</span>
      )}
    </div>
  );
}
