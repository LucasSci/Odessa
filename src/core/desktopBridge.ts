/**
 * desktopBridge — o que o programa Odessa (Electron, desktop/shell) expõe à
 * interface: desligar tudo e esconder na bandeja. Fora dele (navegador, dev)
 * desligar cai no backend direto.
 */
import { apiFetch } from '../lib/apiFetch';

interface OdessaDesktop {
  isDesktop: true;
  /** Para o servidor, a bridge e a IA local e fecha o programa. */
  shutdown(): Promise<void>;
  hideToTray(): void;
  /** Avisa quando a janela some (minimizada, bandeja) ou volta. */
  onWindowVisibility?(callback: (visible: boolean) => void): void;
}

declare global {
  interface Window {
    odessaDesktop?: OdessaDesktop;
  }
}

/** Abre o diálogo "Desligar Odessa" (usado pela Paleta de Comandos). */
export const ASK_SHUTDOWN_EVENT = 'odessa:ask-shutdown';

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && window.odessaDesktop?.isDesktop === true;
}

/** Desliga o Odessa. 'desktop' = o programa fecha sozinho; 'browser' = a aba fica aberta, sem servidor. */
export async function shutdownOdessa(): Promise<'desktop' | 'browser'> {
  if (isDesktopApp()) {
    await window.odessaDesktop!.shutdown();
    return 'desktop';
  }
  await apiFetch('/system/shutdown', { method: 'POST' });
  return 'browser';
}

/** A live está no ar? (OBS transmitindo ou câmera virtual ligada). Sem OBS = não. */
export async function isLiveOnAir(): Promise<boolean> {
  try {
    const health = await apiFetch<{ transmission?: { streamActive?: boolean; virtualCameraActive?: boolean } | null }>(
      '/obs/live-health',
      { timeoutMs: 6000 },
    );
    return Boolean(health.transmission?.streamActive || health.transmission?.virtualCameraActive);
  } catch {
    return false;
  }
}
