import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import LoginScreen from './LoginScreen';
import OdessaLiveCenter, { type AdvancedPanel } from './OdessaLiveCenter';
import PersonaOverlay from './PersonaOverlay';
import { getRecentEvents, replaceEvents } from './core/eventBus';
import { useAutopilotRuntime } from './core/useAutopilotRuntime';
import { apiUrl } from './lib/api';
import { installCredentialedFetch } from './lib/fetchCredentials';
import { connectObs, disconnectObs, onObsStatus, type ObsDirectStatus } from './lib/obsWebSocket';
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

type ObsHealth = {
  ok?: boolean;
  connected?: boolean;
  sourceReady?: boolean;
  screenshotReady?: boolean;
  sourceName?: string;
  error?: string | null;
};

type AgentStatus = {
  ok?: boolean;
  agentConnected?: boolean;
  queueSize?: number;
  message?: string;
  agent?: {
    agentId?: string;
    host?: string;
    version?: string;
    lastSeenAt?: string;
    capabilities?: string[];
    health?: {
      obsConnected?: boolean;
      obs?: { error?: string | null; ok?: boolean; connected?: boolean };
    };
  } | null;
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
  // Login desabilitado: começa autenticado e nunca desconecta sozinho — essencial
  // pra lives 24/7 (a tela de login travava a live ao expirar). Pra refazer o
  // login sob demanda, abra a rota #login.
  const [authenticated, setAuthenticated] = useState<boolean | null>(true);
  const [requestedPanel, setRequestedPanel] = useState<AdvancedPanel>(() => getPanelFromHash());
  const [capturedText, setCapturedTextState] = useState<CapturedMessage[]>(() => getRecentEvents());
  const [liveConfigOpen, setLiveConfigOpen] = useState(false);
  const [liveConfig, setLiveConfig] = useState<LiveConfig>(() => loadLiveConfig());
  const [liveStartError, setLiveStartError] = useState<string | null>(null);
  // Agent removed — status always null (direct OBS connection replaces agent)
  const agentStatus = null as AgentStatus | null;

  const [obsDirectStatus, setObsDirectStatus] = useState<ObsDirectStatus | null>(null);
  const [obsSettings, setObsSettings] = useState<ObsSettingsState | null>(null);

  useEffect(() => {
    // Login desabilitado — o app nunca bloqueia/desconecta sozinho (lives 24/7).
    // Não checamos /auth/me (que faria a tela de login aparecer ao expirar).
    // A sessão (token em localStorage) é usada nas chamadas que precisam; a live
    // em si roda via endpoints públicos, então não depende do login.
    setAuthenticated(true);
  }, []);

  // Direct OBS WebSocket connection — works both local and cloud.
  // Fetches OBS settings from API, then connects to ws://localhost:<port>.
  useEffect(() => {
    if (!authenticated) return;
    const unsub = onObsStatus(setObsDirectStatus);

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

    return unsub;
  }, [authenticated]);

  const setCapturedText = useCallback<Dispatch<SetStateAction<CapturedMessage[]>>>((value) => {
    setCapturedTextState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      return replaceEvents(next);
    });
  }, []);

  const runtime = useAutopilotRuntime({ capturedText, setCapturedText });


  // Agent polling removed — no longer needed with direct OBS connection
  const refreshAgentStatus = useCallback(async () => {}, []);


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
      { capability: 'chat.reply', patch: { enabled: !!liveConfig.enableChat } },
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

  return (
    <OdessaLiveCenter
      capturedText={capturedText}
      setCapturedText={setCapturedText}
      runtime={runtime}
      requestedPanel={requestedPanel}
      liveConfig={liveConfig}
      liveConfigOpen={liveConfigOpen}
      liveStartError={liveStartError}
      agentStatus={agentStatus}
      obsDirectStatus={obsDirectStatus}
      obsSettingsFromApp={obsSettings}
      onRefreshAgentStatus={refreshAgentStatus}
      onLiveConfigOpenChange={setLiveConfigOpen}
      onLiveConfigChange={setLiveConfig}
      onStartLive={startLiveWithConfig}
      onObsSettingsChanged={(newSettings) => {
        setObsSettings(newSettings);
        let port = '4455';
        try {
          const parsed = new URL(newSettings.websocketUrl || 'ws://localhost:4455');
          port = parsed.port || '4455';
        } catch {}
        disconnectObs();
        connectObs(`ws://localhost:${port}`, newSettings.websocketPassword || '');
      }}
    />
  );
}

