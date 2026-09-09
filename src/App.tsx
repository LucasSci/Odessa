import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import LoginScreen from './LoginScreen';
import OdessaLiveCenter, { type AdvancedPanel } from './OdessaLiveCenter';
import PersonaOverlay from './PersonaOverlay';
import { getRecentEvents, replaceEvents } from './core/eventBus';
import { useAutopilotRuntime } from './core/useAutopilotRuntime';
import { TangoChatSessionProvider } from './core/tangoChatSession';
import { apiUrl } from './lib/api';
import { installCredentialedFetch } from './lib/fetchCredentials';
import { startAutoLogin, ensureFreshSession } from './lib/autoLogin';
import { connectObs, disconnectObs } from './lib/obsWebSocket';
import {
  routeSetupLiveScene,
  routeShowStage,
  routeStartTransmission,
  routeLiveHealth,
} from './lib/obsCommandRouter';
import type { CapturedMessage } from './types';

type ObsSettingsState = {
  websocketUrl?: string;
  websocketPassword?: string;
  startupSceneName?: string;
  liveSceneName?: string;
  stageSourceName?: string;
  chatSourceName?: string;
  stageUrl?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  transmissionMode?: string;
  ocrSourceName?: string;
  enabled?: boolean;
};

installCredentialedFetch();
// Mantém a sessão sempre fresca em segundo plano (login automático opt-in),
// pra o app nunca pedir login — lives 24/7 e acesso de vários dispositivos.
startAutoLogin();

type LiveConfig = {
  voiceEnabled?: boolean;
  enableChat?: boolean;
  prepareObs?: boolean;
  showStage?: boolean;
  startAutomation?: boolean;
  startCapture?: boolean;
  startTransmission?: boolean;
  actionMode?: 'simulated' | 'approval_required' | 'real';
};

const LIVE_CONFIG_KEY = 'odessa:live-config:v1';
// Agent removed — browser connects to OBS directly via WebSocket

function getPanelFromHash(): AdvancedPanel {
  if (window.location.hash === '#capture') return 'capture';
  if (window.location.hash === '#persona') return 'overview';
  if (window.location.hash === '#content') return 'content';
  if (window.location.hash === '#runtime') return 'runtime';
  if (window.location.hash === '#settings') return 'settings';
  if (window.location.hash === '#canvas') return 'canvas';
  if (window.location.hash === '#overlay') return 'overlay' as AdvancedPanel;
  return 'overview';
}

function loadLiveConfig(): LiveConfig {
  const defaults: LiveConfig = {
    prepareObs: true,
    showStage: true,
    startAutomation: true,
    startCapture: false,
    startTransmission: true,
    voiceEnabled: false,
    enableChat: false,
  };
  try {
    const raw = window.localStorage.getItem(LIVE_CONFIG_KEY);
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as Partial<LiveConfig>;
    // Migrate: old configs had these as false — force true so Iniciar Live works
    if (stored.startAutomation === false) delete stored.startAutomation;
    if (stored.startTransmission === false) delete stored.startTransmission;
    // Remove deprecated actionMode
    delete stored.actionMode;
    return { ...defaults, ...stored };
  } catch {
    return defaults;
  }
}

export default function App() {
  // A sessão é mantida viva por login automático (ver useEffect abaixo). Começa
  // "carregando" (null) até confirmar; o overlay (live) entra direto.
  // Login desativado por enquanto — entra direto no painel.
  const [authenticated, setAuthenticated] = useState<boolean | null>(true);
  const [requestedPanel, setRequestedPanel] = useState<AdvancedPanel>(() => getPanelFromHash());
  const [capturedText, setCapturedTextState] = useState<CapturedMessage[]>(() => getRecentEvents());
  const [liveConfigOpen, setLiveConfigOpen] = useState(false);
  const [liveConfig, setLiveConfig] = useState<LiveConfig>(() => loadLiveConfig());
  const [liveStartError, setLiveStartError] = useState<string | null>(null);

  const [obsSettings, setObsSettings] = useState<ObsSettingsState | null>(null);

  useEffect(() => {
    // Overlay (fonte do OBS) nunca precisa de login.
    if (getPanelFromHash() === ('overlay' as AdvancedPanel)) {
      setAuthenticated(true);
      return;
    }
    // Mantém a sessão viva via login automático (se configurado). Se a sessão
    // estiver válida → entra direto, sem tela de login (lives 24/7). Se a sessão
    // vencer e NÃO houver login automático, mostra o login — assim os dados
    // (vídeos/fluxo) nunca vêm vazios "em silêncio". A live (overlay) é auth-free.
    // Login desativado por enquanto — mantém a sessão fresca em segundo
    // plano, mas nunca bloqueia a entrada na tela de login.
    (async () => {
      await ensureFreshSession();
      setAuthenticated(true);
    })();
  }, []);

  // Direct OBS WebSocket connection — works both local and cloud.
  // Fetches OBS settings from API, then connects to ws://localhost:<port>.
  useEffect(() => {
    if (!authenticated) return;
    // Fetch settings from API and connect to OBS directly
    fetch(apiUrl('/obs/settings'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; settings?: ObsSettingsState } | null) => {
        if (!data?.ok || !data?.settings) return;
        const settings = data.settings;
        setObsSettings(settings);
        // Extract port from stored URL (might be ws://192.168.x.x:4455)
        let port = '4455';
        try {
          const parsed = new URL(settings.websocketUrl || 'ws://localhost:4455');
          port = parsed.port || '4455';
        } catch { /* use default */ }
        // Always connect via localhost (browser is on same machine as OBS)
        const directUrl = `ws://localhost:${port}`;
        connectObs(directUrl, settings.websocketPassword || '');
      })
      .catch(() => {
        // Fallback: try default OBS WebSocket without settings
        connectObs('ws://localhost:4455');
      });

  }, [authenticated]);

  const setCapturedText = useCallback<Dispatch<SetStateAction<CapturedMessage[]>>>((value) => {
    setCapturedTextState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      return replaceEvents(next);
    });
  }, []);

  const runtime = useAutopilotRuntime({ capturedText, setCapturedText });

  useEffect(() => {
    try {
      window.localStorage.setItem(LIVE_CONFIG_KEY, JSON.stringify(liveConfig));
    } catch {
      // Keep the app usable when storage is unavailable.
    }
  }, [liveConfig]);

  useEffect(() => {
    const handleHashChange = () => setRequestedPanel(getPanelFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const startLiveWithConfig = () => {
    setLiveStartError(null);

    // 1. ALWAYS start automation first — this is the primary action
    const toolPatches = [
      {
        capability: 'tts.speak',
        patch: { enabled: liveConfig.voiceEnabled ?? runtime.voiceEnabled },
      },
      {
        capability: 'chat.reply',
        patch: { enabled: !!liveConfig.enableChat, simulated: !liveConfig.enableChat },
      },
    ];
    runtime.start({ voiceEnabled: liveConfig.voiceEnabled, toolPatches });

    // 2. Start capture if configured
    if (liveConfig.startCapture) {
      try {
        window.dispatchEvent(new CustomEvent('odessa:start-live', { detail: { prefer: 'monitor' } }));
      } catch { /* Capture can still be started manually. */ }
    }

    // 3. OBS preparation + transmission — runs in background, never blocks
    (async () => {
      try {
        if (liveConfig.prepareObs !== false) {
          const health = await routeLiveHealth(obsSettings);
          if (!health.ok) {
            await routeSetupLiveScene(obsSettings);
          }
          if (liveConfig.showStage !== false) {
            await routeShowStage(obsSettings);
          }
        }
        // Start transmission
        if (liveConfig.startTransmission !== false) {
          await routeStartTransmission(obsSettings);
        }
      } catch (err) {
        console.warn('[Odessa] OBS:', err);
      }
    })();
  };

  if (requestedPanel === ('overlay' as AdvancedPanel)) {
    return <PersonaOverlay />;
  }

  // Porta dos fundos: a tela de login só aparece se você abrir #login de propósito
  // (pra renovar a sessão quando precisar salvar algo). Nunca é forçada.
  if (window.location.hash === '#login') {
    return (
      <LoginScreen
        onLogin={() => {
          window.location.hash = '';
          setAuthenticated(true);
        }}
      />
    );
  }

  if (authenticated === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg, #0a0a0f)' }}>
        <p style={{ color: 'var(--t3, #888)', fontSize: 14 }}>Carregando...</p>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen onLogin={() => setAuthenticated(true)} />;
  }

  // O TangoChatSessionProvider envolve a app inteira: a sessao do Tango Chat
  // (conexao SSE, mensagens, fila de respostas, disparo automatico de IA)
  // precisa sobreviver a qualquer troca de aba/painel dentro do Odessa.
  return (
    <TangoChatSessionProvider capturedText={capturedText}>
      <OdessaLiveCenter
        capturedText={capturedText}
        setCapturedText={setCapturedText}
        runtime={runtime}
        requestedPanel={requestedPanel}
        liveConfig={liveConfig}
        liveConfigOpen={liveConfigOpen}
        liveStartError={liveStartError}
        obsSettingsFromApp={obsSettings}
        onLiveConfigOpenChange={setLiveConfigOpen}
        onLiveConfigChange={setLiveConfig}
        onStartLive={startLiveWithConfig}
        onObsSettingsChanged={(newSettings) => {
          setObsSettings(newSettings);
          let port = '4455';
          try {
            const parsed = new URL((newSettings.websocketUrl as string | undefined) || 'ws://localhost:4455');
            port = parsed.port || '4455';
          } catch { /* URL do OBS invalida: usa porta padrao 4455 */ }
          disconnectObs();
          connectObs(`ws://localhost:${port}`, (newSettings.websocketPassword as string | undefined) || '');
        }}
      />
    </TangoChatSessionProvider>
  );
}
