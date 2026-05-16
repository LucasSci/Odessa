import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import OdessaLiveCenter, { type AdvancedPanel } from './OdessaLiveCenter';
import PersonaOverlay from './PersonaOverlay';
import { getRecentEvents, replaceEvents } from './core/eventBus';
import { useAutopilotRuntime } from './core/useAutopilotRuntime';
import { apiUrl } from './lib/api';
import { clearAdminSessionToken, saveAdminSessionToken } from './lib/fetchCredentials';
import type { CapturedMessage } from './types';

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
const DEFAULT_ADMIN_EMAIL = 'lucasbatista.c.l@gmail.com';

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
  try {
    const raw = window.localStorage.getItem(LIVE_CONFIG_KEY);
    return {
      prepareObs: true,
      showStage: true,
      startAutomation: true,
      startCapture: false,
      startTransmission: false,
      actionMode: 'simulated',
      voiceEnabled: false,
      enableChat: false,
      ...(raw ? JSON.parse(raw) : {}),
    };
  } catch {
    return {
      prepareObs: true,
      showStage: true,
      startAutomation: true,
      startCapture: false,
      startTransmission: false,
      actionMode: 'simulated',
      voiceEnabled: false,
      enableChat: false,
    };
  }
}

export default function App() {
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'anonymous'>('checking');
  const [loginEmail, setLoginEmail] = useState(DEFAULT_ADMIN_EMAIL);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [requestedPanel, setRequestedPanel] = useState<AdvancedPanel>(() => getPanelFromHash());
  const [capturedText, setCapturedTextState] = useState<CapturedMessage[]>(() => getRecentEvents());
  const [liveConfigOpen, setLiveConfigOpen] = useState(false);
  const [liveConfig, setLiveConfig] = useState<LiveConfig>(() => loadLiveConfig());
  const [liveStartError, setLiveStartError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);

  const setCapturedText = useCallback<Dispatch<SetStateAction<CapturedMessage[]>>>((value) => {
    setCapturedTextState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      return replaceEvents(next);
    });
  }, []);

  const runtime = useAutopilotRuntime({ capturedText, setCapturedText });

  useEffect(() => {
    if (requestedPanel === ('overlay' as AdvancedPanel)) {
      setAuthStatus('authenticated');
      return;
    }
    let cancelled = false;
    const checkAuth = async () => {
      try {
        const response = await fetch(apiUrl('/auth/me'));
        if (cancelled) return;
        setAuthStatus(response.ok ? 'authenticated' : 'anonymous');
      } catch {
        if (!cancelled) setAuthStatus('anonymous');
      }
    };
    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, [requestedPanel]);

  const refreshAgentStatus = useCallback(async () => {
    try {
      if (isCloudHosted()) {
        try {
          const localResponse = await fetch(`${LOCAL_AGENT_URL}/status`, { credentials: 'omit' });
          if (localResponse.ok) {
            setAgentStatus((await localResponse.json()) as AgentStatus);
            return;
          }
        } catch {
          // Fall back to the cloud heartbeat status below.
        }
      }
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
    if (authStatus !== 'authenticated') return undefined;
    void refreshAgentStatus();
    const interval = window.setInterval(() => void refreshAgentStatus(), 5000);
    return () => window.clearInterval(interval);
  }, [authStatus, refreshAgentStatus]);

  const logout = async () => {
    await fetch(apiUrl('/auth/logout'), { method: 'POST' }).catch(() => undefined);
    clearAdminSessionToken(apiUrl('/auth/me'));
    setAuthStatus('anonymous');
    runtime.pause();
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError(null);
    try {
      const response = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        sessionToken?: string;
        detail?: string;
      };
      if (!response.ok || !data.sessionToken) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }
      saveAdminSessionToken(data.sessionToken, apiUrl('/auth/me'));
      setLoginPassword('');
      setAuthStatus('authenticated');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Falha ao entrar');
    } finally {
      setLoginBusy(false);
    }
  };

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
    const hostedOnVercel = isCloudHosted();
    if ((liveConfig.actionMode || 'simulated') !== 'real') {
      try {
        await fetch(apiUrl('/obs/start-live/dry-run'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(liveConfig),
        });
      } catch {
        // Dry-run visibility is helpful, but it should not block a local simulated start.
      }
      setLiveStartError('Iniciar Live esta em modo seguro/simulado. Altere para "Real ao clicar" em Configuracoes para executar OBS/transmissao.');
      return;
    }

    if (hostedOnVercel) {
      try {
        const localResponse = await fetch(`${LOCAL_AGENT_URL}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({
            type: 'live.start',
            payload: liveConfig,
          }),
        });
        const localResult = (await localResponse.json().catch(() => ({}))) as {
          ok?: boolean;
          result?: { error?: string | null };
        };
        if (localResponse.ok && localResult.ok) {
          await refreshAgentStatus();
          setLiveStartError('Comando executado pelo Odessa Agent local.');
          return;
        }
        const response = await fetch(apiUrl('/agent?action=commands'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'live.start',
            payload: liveConfig,
          }),
        });
        const result = (await response.json().catch(() => ({}))) as { ok?: boolean; queueSize?: number; detail?: string };
        if (!response.ok || !result.ok) {
          setLiveStartError(
            localResult.result?.error ||
              result.detail ||
              'Nao foi possivel acionar o Odessa Agent local. Verifique se npm run dev:agent esta rodando.',
          );
          return;
        }
        await refreshAgentStatus();
        setLiveStartError(`Comando enviado para o Odessa Agent. Fila atual: ${result.queueSize ?? 1}.`);
      } catch (err) {
        setLiveStartError(err instanceof Error ? err.message : 'Falha ao acionar o Odessa Agent.');
      }
      return;
    }

    if (liveConfig.prepareObs !== false) {
      try {
        const response = await fetch(apiUrl('/obs/live-health'));
        const obsHealth = (await response.json().catch(() => ({}))) as ObsHealth;
        let obsReady = response.ok && obsHealth.ok;

        if (!obsReady) {
          const setupResponse = await fetch(apiUrl('/obs/setup-live-scene'), { method: 'POST' });
          const setup = (await setupResponse.json().catch(() => ({}))) as { ok?: boolean; error?: string | null };
          obsReady = setupResponse.ok && !!setup.ok;
          if (!obsReady) {
            setLiveStartError(
              setup.error ||
                obsHealth.error ||
                'Nao foi possivel preparar a Mesa OBS. Verifique se o OBS esta aberto e se o WebSocket esta ativo.',
            );
            return;
          }
        }

        if (liveConfig.showStage !== false) {
          const stageResponse = await fetch(apiUrl('/obs/show-stage'), { method: 'POST' });
          const stage = (await stageResponse.json().catch(() => ({}))) as { ok?: boolean; error?: string | null };
          if (!stageResponse.ok || !stage.ok) {
            setLiveStartError(stage.error || 'Nao foi possivel colocar o palco ao vivo no OBS.');
            return;
          }
        }
      } catch (err) {
        setLiveStartError(
          err instanceof Error
            ? `Nao foi possivel preparar a Mesa OBS: ${err.message}`
            : 'Nao foi possivel iniciar a live assistida: OBS WebSocket indisponivel.',
        );
        return;
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

    if (liveConfig.startAutomation !== false) {
      runtime.start({ voiceEnabled: liveConfig.voiceEnabled, toolPatches });
    }

  if (liveConfig.startTransmission) {
      fetch(apiUrl('/obs/transmission/start'), { method: 'POST' }).catch(() => undefined);
    }
  };

  if (requestedPanel === ('overlay' as AdvancedPanel)) {
    return <PersonaOverlay />;
  }

  if (authStatus !== 'authenticated') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
        <form
          onSubmit={login}
          className="w-full max-w-sm space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
        >
          <div>
            <h1 className="text-xl font-bold">Odessa Admin</h1>
            <p className="mt-1 text-sm text-slate-400">
              Entre para acessar Biblioteca, Fluxo Reativo e controles da live.
            </p>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-300">Email</span>
            <input
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              autoComplete="username"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-blue-500"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-300">Senha</span>
            <input
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-blue-500"
            />
          </label>
          {loginError && (
            <div className="rounded-lg border border-rose-400/30 bg-rose-950/60 px-3 py-2 text-sm text-rose-100">
              {loginError}
            </div>
          )}
          <button
            type="submit"
            disabled={loginBusy || authStatus === 'checking'}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {authStatus === 'checking' ? 'Verificando...' : loginBusy ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </main>
    );
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
      onRefreshAgentStatus={refreshAgentStatus}
      onLiveConfigOpenChange={setLiveConfigOpen}
      onLiveConfigChange={setLiveConfig}
      onStartLive={startLiveWithConfig}
      onLogout={logout}
    />
  );
}

