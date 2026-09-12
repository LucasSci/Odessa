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

/** Classes que identificam botões de troca de persona (ripple violeta). */
const PERSONA_SELECTOR = '.od-persona-btn, [data-persona-switch]';

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
      const isPersona = host.matches(PERSONA_SELECTOR) || host.closest(PERSONA_SELECTOR) !== null;
      ripple.className = isPersona ? 'od-ripple od-ripple--persona' : 'od-ripple';
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

      // Bounce-back: adiciona a classe no pointerup (soltar o clique)
      const onPointerUp = () => {
        host.classList.add('od-click-bounce');
        host.addEventListener(
          'animationend',
          () => host.classList.remove('od-click-bounce'),
          { once: true },
        );
        window.setTimeout(() => host.classList.remove('od-click-bounce'), 400);
        host.removeEventListener('pointerup', onPointerUp);
        host.removeEventListener('pointerleave', onPointerUp);
      };
      host.addEventListener('pointerup', onPointerUp, { once: true });
      host.addEventListener('pointerleave', onPointerUp, { once: true });
    },
    { passive: true },
  );
}
