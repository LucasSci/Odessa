/**
 * windowVisibility — a janela do Odessa está à vista de alguém?
 *
 * No programa (Electron) a página roda com `backgroundThrottling: false` para o
 * chat da live continuar respondendo com a janela na bandeja. Efeito colateral:
 * `document.visibilityState` fica sempre "visible". O programa avisa quando a
 * janela some/volta (minimizar, bandeja) e aqui isso vira um sinal só, junto
 * com a visibilidade normal do navegador.
 *
 * Use para o que é só exibição (vídeo da aba do Tango, animação do fluxo).
 * O que alimenta a live NÃO deve parar com a janela escondida.
 */
import { useSyncExternalStore } from 'react';

let desktopVisible = true;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.odessaDesktop?.onWindowVisibility?.((visible) => {
    desktopVisible = visible;
    notify();
  });
}

export function isWindowVisible(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  return desktopVisible;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  document.addEventListener('visibilitychange', listener);
  return () => {
    listeners.delete(listener);
    document.removeEventListener('visibilitychange', listener);
  };
}

/** `true` enquanto a janela está na tela (não minimizada, fora da bandeja, aba visível). */
export function useWindowVisible(): boolean {
  return useSyncExternalStore(subscribe, isWindowVisible, () => true);
}
