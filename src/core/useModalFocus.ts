import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Elementos que o Tab alcança dentro de `root`, na ordem do documento. */
export function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Acessibilidade de diálogo modal:
 * - leva o foco para dentro ao abrir (o container precisa de `tabIndex={-1}`);
 * - prende o Tab/Shift+Tab dentro do diálogo;
 * - devolve o foco ao elemento que abriu o diálogo ao fechar.
 */
export function useModalFocus(
  ref: RefObject<HTMLElement | null>,
  active = true,
  /** Seletor do que recebe o foco ao abrir (padrão: o próprio container). Use isto em vez de `autoFocus`, que roubaria o foco antes de sabermos quem abriu o diálogo. */
  initialFocus?: string,
): void {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root.contains(document.activeElement)) {
      const target = initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null;
      (target ?? root).focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusableElements(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!root.contains(current)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (current === first || current === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref, active, initialFocus]);
}
