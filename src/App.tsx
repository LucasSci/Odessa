import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import OdessaLiveCenter, { type AdvancedPanel } from './OdessaLiveCenter';
import PersonaOverlay from './PersonaOverlay';
import { getRecentEvents, replaceEvents } from './core/eventBus';
import { useAutopilotRuntime } from './core/useAutopilotRuntime';
import { LOCAL_ODESSA_API_ORIGIN, apiUrl } from './lib/api';
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
  const [loginError, setLoginError] = useState<string | null>(null);
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

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/auth/me'));
      setAuthStatus(response.ok ? 'authenticated' : 'anonymous');
    } catch {
      setAuthStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

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

  const login = async (email: string, password: string) => {
    setLoginError(null);
    const response = await fetch(apiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const detail = typeof errorData?.detail === 'string' ? errorData.detail : 'Email ou senha invalidos.';
      setLoginError(detail);
      setAuthStatus('anonymous');
      return;
    }
    const data = await response.json().catch(() => null);
    saveAdminSessionToken(data?.sessionToken, window.location.origin);
    if (isCloudHosted()) {
      try {
        const localResponse = await fetch(`${LOCAL_ODESSA_API_ORIGIN}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({ email, password }),
        });
        const localData = await localResponse.json().catch(() => null);
        if (localResponse.ok) {
          saveAdminSessionToken(localData?.sessionToken, LOCAL_ODESSA_API_ORIGIN);
        }
      } catch {
        // The cloud shell still opens when the local full backend is offline.
      }
    }
    setAuthStatus('authenticated');
  };

  const logout = async () => {
    await fetch(apiUrl('/auth/logout'), { method: 'POST' }).catch(() => undefined);
    clearAdminSessionToken(window.location.origin);
    clearAdminSessionToken(LOCAL_ODESSA_API_ORIGIN);
    runtime.pause();
    setAuthStatus('anonymous');
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

  if (authStatus === 'checking') {
    return <AuthShell title="Odessa" subtitle="Verificando sessao..." />;
  }

  if (authStatus !== 'authenticated') {
    return <LoginScreen error={loginError} onSubmit={login} />;
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

function AuthShell({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#07090d] px-4 text-white">
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-[#0d1118] p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-cyan-400 text-lg font-black text-slate-950">
            O
          </div>
          <div>
            <h1 className="text-lg font-black">{title}</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{subtitle}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({
  error,
  onSubmit,
}: {
  error: string | null;
  onSubmit: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.trim().length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#07090d] px-4 text-white">
      <form
        className="w-full max-w-sm rounded-lg border border-white/10 bg-[#0d1118] p-6 shadow-2xl"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canSubmit) return;
          setBusy(true);
          try {
            await onSubmit(email.trim(), password);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-cyan-400 text-lg font-black text-slate-950">
            O
          </div>
          <div>
            <h1 className="text-lg font-black">Odessa</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Acesso administrador</p>
          </div>
        </div>

        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
          Email
        </label>
        <input
          className="mb-4 w-full rounded-md border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none ring-cyan-400/0 transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-400/20"
          type="email"
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
          Senha
        </label>
        <input
          className="mb-4 w-full rounded-md border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none ring-cyan-400/0 transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-400/20"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && (
          <div className="mb-4 rounded-md border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-100">
            {error}
          </div>
        )}
        <button
          className="w-full rounded-md bg-cyan-300 px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || !canSubmit}
          type="submit"
        >
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
