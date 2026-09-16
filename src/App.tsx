import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import LoginScreen from './LoginScreen';
import OdessaLiveCenter, { type AdvancedPanel } from './OdessaLiveCenter';
import PersonaOverlay from './PersonaOverlay';
import { clearEvents, replaceEvents } from './core/eventBus';
import { useAutopilotRuntime } from './core/useAutopilotRuntime';
import { TangoChatSessionProvider } from './core/tangoChatSession';
import { apiUrl } from './lib/api';
import { getActivePersona } from './core/personaManager';
import { installCredentialedFetch } from './lib/fetchCredentials';
import { startAutoLogin } from './lib/autoLogin';
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
  if (window.location.hash === '#capture') return 'settings';
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
    startCapture: true,
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
  // O app roda localmente e entra direto no painel; o login continua disponível
  // apenas quando solicitado explicitamente por #login.
  const [authenticated, setAuthenticated] = useState(true);
  const [requestedPanel, setRequestedPanel] = useState<AdvancedPanel>(() => getPanelFromHash());
  // Eventos de uma execução anterior não pertencem ao feed da live atual.
  const [capturedText, setCapturedTextState] = useState<CapturedMessage[]>([]);
  const [liveConfigOpen, setLiveConfigOpen] = useState(false);
  const [liveConfig, setLiveConfig] = useState<LiveConfig>(() => loadLiveConfig());
  const [liveStartError, setLiveStartError] = useState<string | null>(null);

  const [obsSettings, setObsSettings] = useState<ObsSettingsState | null>(null);

  useEffect(() => {
    clearEvents();
  }, []);

  // Direct OBS WebSocket connection — works both local and cloud.
  // Fetches OBS settings from API, then connects to ws://localhost:<port>.
  useEffect(() => {
    if (!authenticated) return;
    void (async () => {
      let settings: ObsSettingsState | null = null;
      try {
        const res = await fetch(apiUrl('/obs/settings'));
        const data = (res.ok ? await res.json() : null) as { ok?: boolean; settings?: ObsSettingsState } | null;
        if (data?.ok && data?.settings) settings = data.settings;
      } catch { /* segue com settings=null; fallback abaixo conecta com defaults */ }

      // As cenas/sources do OBS sao configuradas por persona (aba Personas >
      // Configuracao de Transmissao) — só a URL/senha do WebSocket e global.
      // Sobrepoe aqui pra já carregar com a persona ativa, sem precisar trocar
      // de persona uma vez pra "destravar" a config certa.
      try {
        const { config } = await getActivePersona();
        const transmissionConfig = (config as { transmissionConfig?: Partial<ObsSettingsState> } | null)
          ?.transmissionConfig;
        if (transmissionConfig) settings = { ...(settings ?? {}), ...transmissionConfig };
      } catch { /* usa so a config global se a persona ativa falhar ao carregar */ }

      if (!settings) {
        connectObs('ws://localhost:4455');
        return;
      }
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
    })();
  }, [authenticated]);

  const setCapturedText = useCallback<Dispatch<SetStateAction<CapturedMessage[]>>>((value) => {
    setCapturedTextState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      return replaceEvents(next);
    });
  }, []);

  // Só usado pra gatear pollings do autopilot runtime que só interessam na
  // aba "Ao Vivo" (ver useAutopilotRuntime.ts) — atualizado via callback do
  // OdessaLiveCenter sempre que o usuário troca de aba.
  const [isLiveTabActive, setIsLiveTabActive] = useState(true);
  const runtime = useAutopilotRuntime({ capturedText, setCapturedText, isLiveTabActive });

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

    // Cada live começa com uma sessão limpa. Eventos persistidos pertencem a
    // uma execução anterior e não podem reaparecer como chat atual.
    clearEvents();
    setCapturedTextState([]);

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

    // O provider da bridge escuta este evento e inicia a conexão do chat junto
    // com a live, mantendo o CTA principal como ponto único de partida.
    window.dispatchEvent(new CustomEvent('odessa:start-chat-bridge'));

    // 2. Start capture if configured
    if (liveConfig.startCapture) {
      try {
        window.dispatchEvent(new CustomEvent('odessa:start-live', { detail: { prefer: 'monitor' } }));
      } catch { /* Capture can still be started manually. */ }
    }

    // 3. OBS preparation + transmission. This is deliberately awaited: the
    // live must not report success while OBS is still disconnected or half-ready.
    if (liveConfig.prepareObs !== false || liveConfig.startTransmission !== false) {
      if (!obsSettings?.enabled) {
        const message = 'OBS esta desabilitado. Ative o OBS nas configuracoes antes de iniciar a live.';
        setLiveStartError(message);
        runtime.pause();
        return;
      }

      try {
        let port = '4455';
        try {
          const parsed = new URL(obsSettings.websocketUrl || 'ws://localhost:4455');
          port = parsed.port || '4455';
        } catch { /* usa a porta padrao do OBS */ }
        const connected = await connectObs(`ws://localhost:${port}`, obsSettings.websocketPassword || '');
        if (!connected) {
          throw new Error('OBS indisponivel. Abra o OBS, habilite o WebSocket na porta configurada e tente novamente.');
        }
        const health = await routeLiveHealth(obsSettings);
        if (health.connected === false) {
          throw new Error(`OBS indisponivel: ${health.error}`);
        }

        if (liveConfig.prepareObs !== false) {
          const setup = await routeSetupLiveScene(obsSettings);
          if (!setup.ok) throw new Error(`Falha ao preparar OBS: ${setup.error || 'erro desconhecido'}`);
        }
        if (liveConfig.showStage !== false) {
          const stage = await routeShowStage(obsSettings);
          if (!stage.ok) throw new Error(`Falha ao colocar palco ao vivo: ${stage.error || 'erro desconhecido'}`);
        }
        if (liveConfig.startTransmission !== false) {
          const transmission = await routeStartTransmission(obsSettings);
          if (!transmission.ok) throw new Error(`Falha ao iniciar transmissao: ${transmission.error || 'erro desconhecido'}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Odessa] Falha ao iniciar live:', message);
        setLiveStartError(message);
        runtime.pause();
      }
    }
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
        onActiveTabChange={(tab) => setIsLiveTabActive(tab === 'live')}
        onStartLive={startLiveWithConfig}
        onEndLive={() => {
          window.dispatchEvent(new CustomEvent('odessa:end-live'));
          runtime.pause();
        }}
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
