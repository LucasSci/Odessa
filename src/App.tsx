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
const LOCAL_AGENT_URL = 'http://127.0.0.1:8766';

function isCloudHosted() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h !== '' && h !== 'localhost' && h !== '127.0.0.1' && h !== '::1';
}

function getPanelFromHash(): AdvancedPanel {
  if (window.location.hash === '#capture') return 'capture';
  if (window.location.hash === '#persona') return 'overview';
  if (window.location.hash === '#content') return 'content';
  if (window.location.hash === '#runtime') return 'runtime';
  if (window.location.hash === '#settings') return 'settings';
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
    return { ...defaults, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return defaults;
  }
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [requestedPanel, setRequestedPanel] = useState<AdvancedPanel>(() => getPanelFromHash());
  const [capturedText, setCapturedTextState] = useState<CapturedMessage[]>(() => getRecentEvents());
  const [liveConfigOpen, setLiveConfigOpen] = useState(false);
  const [liveConfig, setLiveConfig] = useState<LiveConfig>(() => loadLiveConfig());
  const [liveStartError, setLiveStartError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);

  const [obsDirectStatus, setObsDirectStatus] = useState<ObsDirectStatus | null>(null);
  const [obsSettings, setObsSettings] = useState<ObsSettingsState | null>(null);

  useEffect(() => {
    // Skip auth check for overlay (OBS browser source)
    if (getPanelFromHash() === ('overlay' as AdvancedPanel)) {
      setAuthenticated(true);
      return;
    }
    fetch(apiUrl('/auth/me'), { credentials: 'include' })
      .then((res) => setAuthenticated(res.ok))
      .catch(() => setAuthenticated(false));
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


  const refreshAgentStatus = useCallback(async () => {
    try {
      // On localhost, try the local agent HTTP server first for faster response
      if (!isCloudHosted()) {
        try {
          const localResponse = await fetch(`${LOCAL_AGENT_URL}/status`, { credentials: 'omit' });
          if (localResponse.ok) {
            setAgentStatus((await localResponse.json()) as AgentStatus);
            return;
          }
        } catch {
          // Fall through to cloud API
        }
      }
      // Cloud or fallback: always use the Hostinger API (agent reports status via heartbeat)
      const response = await fetch(apiUrl('/agent?action=status'));
      if (!response.ok) {
        setAgentStatus(null);
        return;
      }
      setAgentStatus((await response.json()) as AgentStatus);
    } catch {
      setAgentStatus(null);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshAgentStatus(), 0);
    const interval = window.setInterval(() => void refreshAgentStatus(), 5000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [refreshAgentStatus]);


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

  const startLiveWithConfig = async () => {
    setLiveStartError(null);

    // OBS preparation — always attempt when enabled
    if (liveConfig.prepareObs !== false) {
      try {
        const health = await routeLiveHealth(obsSettings);
        let obsReady = health.ok;

        if (!obsReady) {
          const setup = await routeSetupLiveScene(obsSettings);
          obsReady = setup.ok;
          if (!obsReady) {
            // OBS not available — warn but don't block automation
            console.warn('[Odessa] OBS nao disponivel:', setup.error || health.error);
          }
        }

        if (obsReady && liveConfig.showStage !== false) {
          const stage = await routeShowStage(obsSettings);
          if (!stage.ok) {
            console.warn('[Odessa] Falha ao mostrar palco:', stage.error);
          }
        }
      } catch (err) {
        // OBS unavailable — log but don't block automation start
        console.warn('[Odessa] OBS WebSocket indisponivel:', err);
      }
    }

    const toolPatches = [
      {
        capability: 'tts.speak',
        patch: { enabled: liveConfig.voiceEnabled ?? runtime.voiceEnabled },
      },
      { capability: 'chat.reply', patch: { enabled: !!liveConfig.enableChat } },
    ];

    if (liveConfig.startCapture) {
      try {
        window.dispatchEvent(new CustomEvent('odessa:start-live', { detail: { prefer: 'monitor' } }));
      } catch {
        // Capture can still be started manually.
      }
    }

    // Always start automation
    if (liveConfig.startAutomation !== false) {
      runtime.start({ voiceEnabled: liveConfig.voiceEnabled, toolPatches });
    }

    // Start OBS transmission
    if (liveConfig.startTransmission !== false) {
      routeStartTransmission(obsSettings).catch((err) => {
        console.warn('[Odessa] Falha ao iniciar transmissao:', err);
      });
    }
  };

  if (requestedPanel === ('overlay' as AdvancedPanel)) {
    return <PersonaOverlay />;
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

