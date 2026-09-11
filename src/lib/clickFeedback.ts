/**
 * installClickFeedback — efeito ripple global.
 *
 * Ao pressionar qualquer elemento interativo (botões, tabs, toggles), cria
 * uma onda que expande do ponto clicado e some suavemente. Só afeta o
 * elemento clicado (overflow hidden é aplicado nele, não em wrappers),
 * então dropdowns irmãos continuam funcionando normalmente.
 */

const INTERACTIVE_SELECTOR =
  'button, [role="button"], .od-toggle, .od-tab, .odsa-tab, .od-iconbtn';

let installed = false;

export function installClickFeedback() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as HTMLElement | null;
      const host = target?.closest<HTMLElement>(INTERACTIVE_SELECTOR);
      if (!host) return;
      if (host.hasAttribute('disabled') || host.getAttribute('aria-disabled') === 'true') return;

      const rect = host.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.2;
      const ripple = document.createElement('span');
      ripple.className = 'od-ripple';
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`;

      host.classList.add('od-ripple-host');
      host.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
      // Fallback: se a aba estiver oculta (timeline congelada), o animationend
      // pode não disparar — garante que o ripple nunca acumula no DOM.
      window.setTimeout(() => ripple.remove(), 900);
    },
    { passive: true },
  );
}
