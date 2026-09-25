import { useEffect, useState } from 'react';

/** Duração da saída — espelha --motion-exit em ux-polish.css. */
export const EXIT_MS = 140;

/**
 * usePresence — mantém um elemento montado durante a animação de saída.
 *
 * `{open && <Modal />}` desmonta na hora e a saída some sem transição. Com o
 * hook, o elemento fica montado com `data-state="closed"` por `exitMs` (o CSS
 * anima a saída) e só então desmonta.
 *
 *   const presence = usePresence(open);
 *   if (!presence.mounted) return null;
 *   return <div className="od-pop" data-state={presence.state}>…</div>;
 */
export function usePresence(open: boolean, exitMs = EXIT_MS): { mounted: boolean; state: 'open' | 'closed' } {
  const [mounted, setMounted] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);

  // Abrir monta na mesma renderização (sem esperar um efeito).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setMounted(true);
  }

  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, mounted, exitMs]);

  return { mounted: open || mounted, state: open ? 'open' : 'closed' };
}
