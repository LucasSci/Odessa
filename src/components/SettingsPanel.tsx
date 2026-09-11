/**
 * SettingsPanel — Configurações gerais do Odessa (OBS, Webhooks, Live, APIs).
 *
 * Design renovado: seções colapsáveis, toggle switches, hierarquia visual
 * clara e layout otimizado para escanear e encontrar rápido.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Database,
  Link2,
  ListVideo,
  RefreshCw,
  RadioTower,
  Save,
  Settings,
  ShieldAlert,
  Trash2,
  VolumeX,
} from 'lucide-react';
import { apiUrl } from '../lib/api';
import { cn } from '../lib/utils';
import type { AutopilotRuntimeState } from '../core/useAutopilotRuntime';
import { Badge, Button, Input, StatusDot } from './ui';
import {
  DEFAULT_OBS_SETTINGS,
  EMPTY_WEBHOOK_DRAFT,
  WORKSPACE_SETTINGS_KEY,
  buildObsWebsocketUrl,
  headersToText,
  loadWorkspaceSettings,
  normalizeObsSettings,
  parseHeadersText,
  parseObsConnection,
  type LiveConfig,
  type ObsConnectionFields,
  type ObsHealthResult,
  type ObsSettings,
  type WebhookConfig,
  type WebhookDraft,
  type WorkspaceSettings,
} from '../OdessaLiveCenter';

/* ── Toggle Switch ─────────────────────────────────────────── */
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200',
        'focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40',
        'disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'bg-[image:var(--grad-live)]' : 'bg-[var(--bg4)]',
      )}
    >
      <span
        className={cn(
          'inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow-md transition-transform duration-200',
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
        )}
        style={{ height: 18, width: 18 }}
      />
    </button>
  );
}

/* ── Collapsible Section ────────────────────────────────────── */
function Section({
  icon,
  title,
  description,
  badge,
  defaultOpen = true,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-3xl border border-[var(--border2)] bg-[var(--bg1)] shadow-[0_8px_30px_rgba(0,0,0,0.3)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border2)] bg-[var(--bg2)] text-[var(--accent2)]">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-[var(--t1)]">{title}</h3>
            {badge}
          </div>
          {description && <p className="mt-0.5 truncate text-xs text-[var(--t3)]">{description}</p>}
        </div>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-[var(--t3)] transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && <div className="border-t border-[var(--border)] px-5 py-4">{children}</div>}
    </div>
  );
}

/* ── Toggle Row ─────────────────────────────────────────────── */
function ToggleRow({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg2)] px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-[var(--t3)]">{icon}</span>
        <div>
          <div className="text-sm font-medium text-[var(--t1)]">{label}</div>
          {description && <div className="mt-0.5 text-xs text-[var(--t3)]">{description}</div>}
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

/* ── Status Pill ───────────────────────────────────────────── */
function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg2)] px-3 py-2 text-sm">
      <span className="truncate text-[var(--t2)]">{label}</span>
      <StatusDot status={ok ? 'online' : 'idle'} />
    </div>
  );
}

/* ── Select Field ──────────────────────────────────────────── */
function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none transition focus:border-[var(--gold)]"
      >
        {children}
      </select>
    </label>
  );
}

/* ── Data Row ──────────────────────────────────────────────── */
function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg2)] px-3 py-2 text-sm">
      <span className="text-[var(--t3)]">{label}</span>
      <span className="font-medium text-[var(--t1)]">{value}</span>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────── */
export function SettingsPanel({
  health,
  onRefreshHealth,
  liveConfig,
  onLiveConfigChange,
  onSaved,
  onObsSettingsChanged,
}: {
  health: AutopilotRuntimeState['health'];
  onRefreshHealth: () => Promise<void>;
  liveConfig: LiveConfig;
  onLiveConfigChange?: Dispatch<SetStateAction<LiveConfig>>;
  onSaved: () => void;
  onObsSettingsChanged?: (settings: Record<string, unknown>) => void;
}) {
  const [obsSettings, setObsSettings] = useState<ObsSettings>(DEFAULT_OBS_SETTINGS);
  const [obsConnection, setObsConnection] = useState<ObsConnectionFields>(() =>
    parseObsConnection(DEFAULT_OBS_SETTINGS),
  );
  const [workspace, setWorkspace] = useState<WorkspaceSettings>(() => loadWorkspaceSettings());
  const [passwordInput, setPasswordInput] = useState('');
  const [obsHealth, setObsHealth] = useState<ObsHealthResult | null>(null);
  const [availableScenes, setAvailableScenes] = useState<string[]>([]);
  const [selectedSceneTest, setSelectedSceneTest] = useState('');
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [webhookDraft, setWebhookDraft] = useState<WebhookDraft>(EMPTY_WEBHOOK_DRAFT);
  const [webhookHeaderText, setWebhookHeaderText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sceneTesting, setSceneTesting] = useState(false);
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [webhookMessage, setWebhookMessage] = useState<string | null>(null);
  const [obsProfiles, setObsProfiles] = useState<Array<{ id: string; name: string; updatedAt?: string }>>([]);
  const [obsProfileName, setObsProfileName] = useState('');
  const [activeObsProfileId, setActiveObsProfileId] = useState('');

  const loadObsSettings = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl('/obs/settings'));
      const data = (await response.json()) as {
        ok?: boolean;
        settings?: Partial<ObsSettings>;
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const normalized = normalizeObsSettings(data.settings);
      setObsSettings(normalized);
      setObsConnection(parseObsConnection(normalized));
      setSelectedSceneTest((current) => current || normalized.allowedScenes[0] || '');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao carregar configuracoes do OBS');
    } finally {
      setLoading(false);
    }
  }, []);

  // OBS profiles persisted in localStorage (per-device).
  const OBS_PROFILES_KEY = 'odessa:obs-profiles:v1';

  const readObsProfilesFromStorage = () => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(OBS_PROFILES_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };

  const writeObsProfilesToStorage = (list: typeof obsProfiles) => {
    try { if (typeof window !== 'undefined') window.localStorage.setItem(OBS_PROFILES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  };

  const loadObsProfiles = useCallback(async () => {
    setObsProfiles(readObsProfilesFromStorage());
  }, []);

  const saveObsProfile = async (name: string) => {
    if (!name.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const snapshot: ObsSettings = {
        ...obsSettings,
        websocketUrl: buildObsWebsocketUrl(obsConnection),
        passwordConfigured: obsConnection.authenticationEnabled,
        websocketPassword: passwordInput.trim() || obsSettings.websocketPassword || '',
      };
      const existing = readObsProfilesFromStorage();
      const existingIdx = existing.findIndex((p) => p.name === name);
      const profile = {
        id: existingIdx >= 0 ? existing[existingIdx].id : `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        settings: snapshot,
        createdAt: existingIdx >= 0 ? existing[existingIdx].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const next = existingIdx >= 0 ? existing.map((p, i) => i === existingIdx ? profile : p) : [...existing, profile];
      writeObsProfilesToStorage(next);
      setObsProfiles(next);
      setActiveObsProfileId(profile.id);
      setObsProfileName('');
      const hasPwd = Boolean(snapshot.websocketPassword);
      setMessage(
        snapshot.passwordConfigured && !hasPwd
          ? `Perfil "${name}" salvo. Dica: digite a senha do OBS antes de salvar para guarda-la no perfil.`
          : `Perfil "${name}" salvo (local).`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao salvar perfil');
    } finally {
      setSaving(false);
    }
  };

  const applyObsProfile = async (id: string) => {
    const profile = readObsProfilesFromStorage().find((p) => p.id === id);
    if (!profile?.settings) {
      setMessage('Perfil nao encontrado.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const normalized = normalizeObsSettings(profile.settings);
      setObsSettings(normalized);
      setObsConnection(parseObsConnection(normalized));
      setActiveObsProfileId(id);
      const storedPwd = (profile.settings as Partial<ObsSettings>).websocketPassword || '';
      if (storedPwd) setPasswordInput(storedPwd);
      setMessage(
        storedPwd
          ? `Perfil "${profile.name}" carregado. Clique em "Salvar OBS" para conectar.`
          : `Perfil "${profile.name}" carregado. Confira a senha do OBS e clique em "Salvar OBS".`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao aplicar perfil');
    } finally {
      setSaving(false);
    }
  };

  const deleteObsProfile = async (id: string) => {
    try {
      const next = readObsProfilesFromStorage().filter((p) => p.id !== id);
      writeObsProfilesToStorage(next);
      setObsProfiles(next);
      if (activeObsProfileId === id) setActiveObsProfileId('');
    } catch { /* ignore */ }
  };

  const loadWebhooks = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/webhooks'));
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        webhooks?: WebhookConfig[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhooks(Array.isArray(data.webhooks) ? data.webhooks : []);
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao carregar webhooks');
    }
  }, []);

  const testObs = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({
        sourceName: obsSettings.chatSourceName || obsSettings.ocrSourceName,
      });
      const response = await fetch(apiUrl(`/obs/health?${query.toString()}`));
      const data = (await response.json()) as ObsHealthResult;
      setObsHealth(data);
      setAvailableScenes(Array.isArray(data.availableScenes) ? data.availableScenes : []);
      if (Array.isArray(data.allowedScenes)) {
        setObsSettings((current) => ({
          ...current,
          sceneWhitelist: data.allowedScenes || current.sceneWhitelist,
          allowedScenes: data.allowedScenes || current.allowedScenes,
        }));
      }
      if (!response.ok || !data.ok) {
        setMessage(data.error || 'OBS/source ainda nao esta pronto para iniciar a live');
        return;
      }
      setMessage('OBS pronto para captura OCR persistente.');
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Falha ao testar OBS';
      setObsHealth({ ok: false, connected: false, sourceReady: false, screenshotReady: false, error });
      setMessage(error);
    } finally {
      setLoading(false);
    }
  }, [obsSettings.chatSourceName, obsSettings.ocrSourceName]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadObsSettings();
      void loadObsProfiles();
      void loadWebhooks();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadObsSettings, loadWebhooks]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify(workspace));
  }, [workspace]);

  const saveObsSettings = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Partial<ObsSettings> = {
        enabled: obsSettings.enabled,
        websocketUrl: buildObsWebsocketUrl(obsConnection),
        ocrSourceName: obsSettings.chatSourceName || obsSettings.ocrSourceName,
        chatSourceName: obsSettings.chatSourceName || obsSettings.ocrSourceName,
        stageSourceName: obsSettings.stageSourceName,
        stageUrl: obsSettings.stageUrl,
        startupSceneName: obsSettings.startupSceneName,
        liveSceneName: obsSettings.liveSceneName,
        transmissionMode: obsSettings.transmissionMode,
        canvasWidth: obsSettings.canvasWidth,
        canvasHeight: obsSettings.canvasHeight,
        sceneWhitelist: obsSettings.allowedScenes,
        allowedScenes: obsSettings.allowedScenes,
      };
      if (obsConnection.authenticationEnabled && passwordInput.trim()) {
        payload.websocketPassword = passwordInput;
      }
      if (!obsConnection.authenticationEnabled) {
        payload.websocketPassword = '';
      }
      const response = await fetch(apiUrl('/obs/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        settings?: Partial<ObsSettings>;
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const normalized = normalizeObsSettings(data.settings);
      setObsSettings(normalized);
      setObsConnection(parseObsConnection(normalized));
      setSelectedSceneTest((current) => current || normalized.allowedScenes[0] || '');
      setPasswordInput('');
      setMessage('Configuracoes do OBS salvas.');
      onSaved();
      if (onObsSettingsChanged) {
        onObsSettingsChanged(payload as Record<string, unknown>);
      }
      void onRefreshHealth();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao salvar configuracoes');
    } finally {
      setSaving(false);
    }
  };

  const updateWorkspace = (patch: Partial<WorkspaceSettings>) => {
    setWorkspace((current) => ({ ...current, ...patch }));
  };

  const syncObsScenes = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl('/obs/scenes'));
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        scenes?: string[];
        currentScene?: string | null;
        allowedScenes?: string[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const scenes = Array.isArray(data.scenes) ? data.scenes : [];
      setAvailableScenes(scenes);
      setObsHealth((current) => ({
        ...(current || {}),
        connected: true,
        availableScenes: scenes,
        allowedScenes: data.allowedScenes || obsSettings.allowedScenes,
        currentScene: data.currentScene || current?.currentScene || null,
        sceneSwitchReady: Boolean((data.allowedScenes || obsSettings.allowedScenes).length),
      }));
      setMessage(`Cenas sincronizadas: ${scenes.length}. Marque as cenas que as automacoes podem usar.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao sincronizar cenas do OBS');
    } finally {
      setLoading(false);
    }
  };

  const toggleAllowedScene = (scene: string) => {
    setObsSettings((current) => {
      const exists = current.allowedScenes.some((item) => item.toLowerCase() === scene.toLowerCase());
      const next = exists
        ? current.allowedScenes.filter((item) => item.toLowerCase() !== scene.toLowerCase())
        : [...current.allowedScenes, scene];
      return { ...current, sceneWhitelist: next, allowedScenes: next };
    });
    setSelectedSceneTest((current) => current || scene);
  };

  const testSceneSwitch = async () => {
    const sceneName = selectedSceneTest || obsSettings.allowedScenes[0] || '';
    if (!sceneName) {
      setMessage('Selecione uma cena permitida para testar a troca.');
      return;
    }
    setSceneTesting(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl('/obs/switch-scene'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneName }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        currentScene?: string;
        sceneName?: string;
        scene?: string;
        error?: string;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(`Cena alterada no OBS: ${data.currentScene || data.sceneName || data.scene || sceneName}`);
      void testObs();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao trocar cena no OBS');
    } finally {
      setSceneTesting(false);
    }
  };

  const saveWebhook = async () => {
    setWebhookSaving(true);
    setWebhookMessage(null);
    try {
      const payload = {
        ...webhookDraft,
        headers: parseHeadersText(webhookHeaderText),
      };
      const response = await fetch(apiUrl('/webhooks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        webhook?: WebhookConfig;
        webhooks?: WebhookConfig[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhooks(Array.isArray(data.webhooks) ? data.webhooks : []);
      setWebhookDraft({ ...payload, id: data.webhook?.id || payload.id });
      setWebhookMessage('Webhook salvo.');
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao salvar webhook');
    } finally {
      setWebhookSaving(false);
    }
  };

  const editWebhook = (webhook: WebhookConfig) => {
    setWebhookDraft(webhook);
    setWebhookHeaderText(headersToText(webhook.headers));
    setWebhookMessage(null);
  };

  const deleteWebhook = async (webhookId: string) => {
    setWebhookSaving(true);
    setWebhookMessage(null);
    try {
      const response = await fetch(apiUrl(`/webhooks/${encodeURIComponent(webhookId)}`), {
        method: 'DELETE',
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        webhooks?: WebhookConfig[];
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhooks(Array.isArray(data.webhooks) ? data.webhooks : []);
      if (webhookDraft.id === webhookId) {
        setWebhookDraft(EMPTY_WEBHOOK_DRAFT);
        setWebhookHeaderText('');
      }
      setWebhookMessage('Webhook removido.');
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao remover webhook');
    } finally {
      setWebhookSaving(false);
    }
  };

  const testWebhook = async (webhookId: string) => {
    setWebhookSaving(true);
    setWebhookMessage(null);
    try {
      const response = await fetch(apiUrl(`/webhooks/${encodeURIComponent(webhookId)}/test`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: { text: 'Teste manual do Centro de Acoes', kind: 'test' },
          action: { type: 'webhook', capability: 'webhook.call', payload: { webhookId } },
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        statusCode?: number;
        error?: string | null;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setWebhookMessage(`Webhook executado: HTTP ${data.statusCode || 'ok'}.`);
    } catch (err) {
      setWebhookMessage(err instanceof Error ? err.message : 'Falha ao testar webhook');
    } finally {
      setWebhookSaving(false);
    }
  };

  const obsReady =
    !!obsHealth?.ok && !!obsHealth.connected && !!obsHealth.sourceReady && !!obsHealth.screenshotReady;
  const sceneSwitchReady = !!obsHealth?.connected && !!obsHealth.sceneSwitchReady;
  const apiRows = [
    { label: 'Gemini', ok: !!health?.gemini_configured },
    { label: 'OpenAI texto', ok: !!health?.openai_ai_configured },
    { label: 'OpenAI TTS', ok: !!health?.openai_tts_configured },
    { label: 'Kokoro TTS', ok: !!health?.kokoro_tts_configured },
  ];

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg)]/80 px-5 py-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border2)] bg-[var(--bg2)] text-[var(--accent2)]">
            <Settings className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-[var(--t1)]">Configurações</h1>
            <p className="text-xs text-[var(--t3)]">OBS, webhooks, APIs e diagnósticos</p>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-5">
        {/* ── OBS WebSocket ── */}
        <Section
          icon={<Settings className="h-4 w-4" />}
          title="Conexão OBS"
          description="WebSocket, fontes e cenas do OBS Studio"
          badge={
            <Badge variant={obsReady ? 'success' : obsHealth ? 'danger' : 'default'}>
              {obsReady ? 'pronto' : obsHealth ? 'pendente' : 'não testado'}
            </Badge>
          }
        >
          {/* Profiles */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {obsProfiles.length > 0 ? (
              <>
                <select
                  className="h-9 cursor-pointer rounded-xl border border-[var(--border2)] bg-[var(--bg2)] px-3 pr-7 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]/40"
                  value={activeObsProfileId}
                  onChange={(e) => { if (e.target.value) void applyObsProfile(e.target.value); else setActiveObsProfileId(''); }}
                >
                  <option value="">Selecionar perfil...</option>
                  {obsProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {activeObsProfileId && (
                  <button
                    onClick={() => void deleteObsProfile(activeObsProfileId)}
                    className="rounded-lg p-1.5 text-[var(--t3)] transition-colors hover:bg-red-500/15 hover:text-red-400"
                    title="Excluir perfil"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <div className="mx-1 h-5 w-px bg-[var(--border)]" />
              </>
            ) : (
              <span className="text-xs font-semibold uppercase tracking-widest text-[var(--t3)]">Perfis</span>
            )}
            <Input
              value={obsProfileName}
              onChange={(e) => setObsProfileName(e.target.value)}
              placeholder="Novo perfil..."
              className="max-w-[200px]"
              onKeyDown={(e) => { if (e.key === 'Enter') void saveObsProfile(obsProfileName); }}
            />
            <Button size="sm" variant="secondary" disabled={!obsProfileName.trim() || saving} onClick={() => void saveObsProfile(obsProfileName)}>
              <Save className="h-4 w-4" />
            </Button>
          </div>

          {/* Toggles */}
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            <ToggleRow
              icon={<RadioTower className="h-4 w-4" />}
              label="Exigir OBS na live"
              checked={obsSettings.enabled}
              onChange={(v) => setObsSettings((c) => ({ ...c, enabled: v }))}
            />
            <ToggleRow
              icon={<Settings className="h-4 w-4" />}
              label="Autenticação"
              checked={obsConnection.authenticationEnabled}
              onChange={(v) => setObsConnection((c) => ({ ...c, authenticationEnabled: v }))}
            />
          </div>

          {/* Connection fields */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Host"
              value={obsConnection.host}
              placeholder="localhost"
              onChange={(e) => setObsConnection((c) => ({ ...c, host: e.target.value }))}
            />
            <Input
              label="Porta"
              type="number"
              min="1"
              max="65535"
              value={obsConnection.port}
              placeholder="4455"
              onChange={(e) => setObsConnection((c) => ({ ...c, port: e.target.value }))}
            />
            <Input
              label="Source do chat/OCR"
              value={obsSettings.chatSourceName}
              onChange={(e) =>
                setObsSettings((c) => ({ ...c, chatSourceName: e.target.value, ocrSourceName: e.target.value }))
              }
            />
            <Input
              label="Senha do servidor"
              type="password"
              value={passwordInput}
              disabled={!obsConnection.authenticationEnabled}
              placeholder={
                !obsConnection.authenticationEnabled
                  ? 'Auth desativada'
                  : obsSettings.passwordConfigured
                    ? 'Senha configurada — vazio para manter'
                    : 'Senha do OBS WebSocket'
              }
              onChange={(e) => setPasswordInput(e.target.value)}
            />
            <Input
              label="Source do palco"
              value={obsSettings.stageSourceName}
              onChange={(e) => setObsSettings((c) => ({ ...c, stageSourceName: e.target.value }))}
            />
            <Input
              label="URL do palco"
              value={obsSettings.stageUrl}
              onChange={(e) => setObsSettings((c) => ({ ...c, stageUrl: e.target.value }))}
            />
            <Input
              label="Cena inicial"
              value={obsSettings.startupSceneName}
              onChange={(e) => setObsSettings((c) => ({ ...c, startupSceneName: e.target.value }))}
            />
            <Input
              label="Cena ao vivo"
              value={obsSettings.liveSceneName}
              onChange={(e) => setObsSettings((c) => ({ ...c, liveSceneName: e.target.value }))}
            />
            <Input
              label="Largura palco"
              type="number"
              value={obsSettings.canvasWidth}
              onChange={(e) => setObsSettings((c) => ({ ...c, canvasWidth: Number(e.target.value) || 1080 }))}
            />
            <Input
              label="Altura palco"
              type="number"
              value={obsSettings.canvasHeight}
              onChange={(e) => setObsSettings((c) => ({ ...c, canvasHeight: Number(e.target.value) || 1920 }))}
            />
          </div>

          {/* Generated URL */}
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-black/30 px-3 py-2 text-xs">
            <span className="text-[var(--t3)]">URL:</span>
            <span className="font-mono font-semibold text-[var(--t1)]">
              {buildObsWebsocketUrl(obsConnection)}
            </span>
            <Badge variant={obsConnection.authenticationEnabled ? 'gold' : 'default'} className="ml-auto">
              {obsConnection.authenticationEnabled ? 'auth' : 'sem auth'}
            </Badge>
          </div>

          {/* Transmission + Prepare */}
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <SelectField
              label="Transmissão"
              value={obsSettings.transmissionMode}
              onChange={(v) => setObsSettings((c) => ({ ...c, transmissionMode: v as ObsSettings['transmissionMode'] }))}
            >
              <option value="stream">OBS Stream</option>
              <option value="virtual_camera">Câmera virtual</option>
              <option value="none">Não iniciar automaticamente</option>
            </SelectField>
            <Button
              variant="secondary"
              loading={loading}
              onClick={async () => {
                setLoading(true);
                setMessage(null);
                try {
                  const response = await fetch(apiUrl('/obs/setup-live-scene'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chatSourceName: obsSettings.chatSourceName,
                      stageSourceName: obsSettings.stageSourceName,
                      stageUrl: obsSettings.stageUrl,
                      startupSceneName: obsSettings.startupSceneName,
                      liveSceneName: obsSettings.liveSceneName,
                      transmissionMode: obsSettings.transmissionMode,
                      canvasWidth: obsSettings.canvasWidth,
                      canvasHeight: obsSettings.canvasHeight,
                    }),
                  });
                  const data = (await response.json().catch(() => ({}))) as {
                    ok?: boolean;
                    layout?: Partial<ObsSettings>;
                    allowedScenes?: string[];
                    error?: string | null;
                  };
                  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
                  if (data.layout) setObsSettings((current) => normalizeObsSettings({ ...current, ...data.layout }));
                  if (Array.isArray(data.allowedScenes)) {
                    setObsSettings((current) => ({
                      ...current,
                      allowedScenes: data.allowedScenes || current.allowedScenes,
                      sceneWhitelist: data.allowedScenes || current.sceneWhitelist,
                    }));
                  }
                  setMessage('Mesa OBS preparada: cenas, palco e chat sincronizados.');
                  void testObs();
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : 'Falha ao preparar Mesa OBS');
                } finally {
                  setLoading(false);
                }
              }}
            >
              <RadioTower className="h-4 w-4" />
              Preparar mesa
            </Button>
          </div>

          {/* Scenes */}
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-black/20 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                  Cenas permitidas para automações
                </div>
                <div className="mt-1 text-xs text-[var(--t3)]">
                  Sincronize do OBS e marque apenas as cenas que podem ser acionadas.
                </div>
              </div>
              <Button variant="secondary" loading={loading} onClick={() => void syncObsScenes()}>
                <RefreshCw className="h-4 w-4" />
                Sincronizar
              </Button>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {availableScenes.length ? (
                availableScenes.map((scene) => {
                  const allowed = obsSettings.allowedScenes.some(
                    (item) => item.toLowerCase() === scene.toLowerCase(),
                  );
                  return (
                    <label
                      key={scene}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--t1)] transition-colors hover:border-[var(--border2)]"
                    >
                      <span className="truncate">{scene}</span>
                      <Toggle checked={allowed} onChange={() => toggleAllowedScene(scene)} />
                    </label>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-4 text-sm text-[var(--t3)] md:col-span-2">
                  Nenhuma cena sincronizada. Use o botão acima com o OBS aberto.
                </div>
              )}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <select
                value={selectedSceneTest}
                onChange={(e) => setSelectedSceneTest(e.target.value)}
                className="h-10 rounded-xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
              >
                <option value="">Selecionar cena para teste</option>
                {obsSettings.allowedScenes.map((scene) => (
                  <option key={scene} value={scene}>{scene}</option>
                ))}
              </select>
              <Button variant="secondary" loading={sceneTesting} onClick={() => void testSceneSwitch()}>
                <RadioTower className="h-4 w-4" />
                Testar troca
              </Button>
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" loading={saving} onClick={() => void saveObsSettings()}>
              <CheckCircle2 className="h-4 w-4" />
              Salvar OBS
            </Button>
            <Button variant="secondary" loading={loading} onClick={() => void testObs()}>
              <RefreshCw className="h-4 w-4" />
              Testar source
            </Button>
            <Button variant="secondary" loading={loading} onClick={() => void loadObsSettings()}>
              <RefreshCw className="h-4 w-4" />
              Recarregar
            </Button>
          </div>

          {message && (
            <div
              className={cn(
                'mt-4 rounded-xl border px-3 py-2 text-sm',
                obsReady
                  ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                  : 'border-amber-400/25 bg-amber-500/10 text-amber-100',
              )}
            >
              {message}
            </div>
          )}
        </Section>

        {/* ── Iniciar Live ── */}
        <Section
          icon={<ClipboardCheck className="h-4 w-4" />}
          title="Iniciar Live"
          description="Voz IA e resposta automática no chat"
          defaultOpen={false}
        >
          <p className="mb-3 text-sm text-[var(--t3)]">
            O botão <strong className="text-[var(--t1)]">"Iniciar live"</strong> no topo ativa tudo automaticamente:
            prepara o OBS, inicia a automação, a captura do chat e a transmissão.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              icon={<VolumeX className="h-4 w-4" />}
              label="Voz IA (TTS)"
              checked={!!liveConfig.voiceEnabled}
              onChange={(v) => onLiveConfigChange?.((c) => ({ ...c, voiceEnabled: v }))}
            />
            <ToggleRow
              icon={<RadioTower className="h-4 w-4" />}
              label="Resposta automática no chat"
              checked={!!liveConfig.enableChat}
              onChange={(v) => onLiveConfigChange?.((c) => ({ ...c, enableChat: v }))}
            />
          </div>
        </Section>

        {/* ── Webhooks ── */}
        <Section
          icon={<Link2 className="h-4 w-4" />}
          title="Webhooks"
          description="Endpoints para gatilhos — n8n entra como webhook comum"
          badge={
            <Badge variant={webhooks.length ? 'success' : 'default'}>
              {webhooks.length ? `${webhooks.length} ativo(s)` : 'vazio'}
            </Badge>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
            {/* List */}
            <div className="space-y-2">
              {webhooks.length ? (
                webhooks.map((webhook) => (
                  <div
                    key={webhook.id}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--bg2)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button className="min-w-0 text-left" onClick={() => editWebhook(webhook)}>
                        <div className="truncate text-sm font-semibold text-[var(--t1)]">{webhook.name}</div>
                        <div className="mt-0.5 truncate text-xs text-[var(--t3)]">{webhook.id}</div>
                      </button>
                      <Badge variant={webhook.enabled ? 'success' : 'warning'}>
                        {webhook.enabled ? 'ativo' : 'pausado'}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" loading={webhookSaving} onClick={() => void testWebhook(webhook.id)}>
                        Testar
                      </Button>
                      <Button size="sm" variant="danger" loading={webhookSaving} onClick={() => void deleteWebhook(webhook.id)}>
                        Remover
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] px-3 py-4 text-sm text-[var(--t3)]">
                  Nenhum webhook salvo.
                </div>
              )}
            </div>

            {/* Form */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Nome"
                value={webhookDraft.name}
                onChange={(e) => setWebhookDraft((c) => ({ ...c, name: e.target.value }))}
              />
              <SelectField
                label="Método"
                value={webhookDraft.method}
                onChange={(v) => setWebhookDraft((c) => ({ ...c, method: v }))}
              >
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </SelectField>
              <Input
                label="URL"
                value={webhookDraft.url}
                placeholder="https://..."
                className="sm:col-span-2"
                onChange={(e) => setWebhookDraft((c) => ({ ...c, url: e.target.value }))}
              />
              <Input
                label="Timeout (ms)"
                type="number"
                min="500"
                max="15000"
                value={webhookDraft.timeoutMs}
                onChange={(e) => setWebhookDraft((c) => ({ ...c, timeoutMs: Number(e.target.value) || 2500 }))}
              />
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg2)] px-4 py-2.5">
                <span className="text-sm text-[var(--t1)]">Ativo</span>
                <Toggle
                  checked={webhookDraft.enabled}
                  onChange={(v) => setWebhookDraft((c) => ({ ...c, enabled: v }))}
                />
              </div>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                  Headers
                </span>
                <textarea
                  value={webhookHeaderText}
                  onChange={(e) => setWebhookHeaderText(e.target.value)}
                  className="min-h-20 w-full resize-y rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 text-sm text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                  placeholder="Authorization: Bearer ..."
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                  Body template
                </span>
                <textarea
                  value={webhookDraft.bodyTemplate}
                  onChange={(e) => setWebhookDraft((c) => ({ ...c, bodyTemplate: e.target.value }))}
                  className="min-h-28 w-full resize-y rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 py-2 font-mono text-xs text-[var(--t1)] outline-none focus:border-[var(--gold)]"
                />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button variant="primary" loading={webhookSaving} onClick={() => void saveWebhook()}>
                  <CheckCircle2 className="h-4 w-4" />
                  Salvar webhook
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setWebhookDraft(EMPTY_WEBHOOK_DRAFT);
                    setWebhookHeaderText('');
                    setWebhookMessage(null);
                  }}
                >
                  Novo
                </Button>
              </div>
              {webhookMessage && (
                <div className="rounded-xl border border-[var(--border)] bg-black/25 px-3 py-2 text-sm text-[var(--t2)] sm:col-span-2">
                  {webhookMessage}
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* ── APIs & Automações ── */}
        <div className="grid gap-3 lg:grid-cols-2">
          <Section
            icon={<Database className="h-4 w-4" />}
            title="Consumo de APIs"
            description="Perfil de custo e status dos provedores"
          >
            <div className="space-y-3">
              <SelectField
                label="Perfil de custo"
                value={workspace.apiBudgetMode}
                onChange={(v) => updateWorkspace({ apiBudgetMode: v as WorkspaceSettings['apiBudgetMode'] })}
              >
                <option value="economico">Econômico</option>
                <option value="normal">Normal</option>
                <option value="agressivo">Agressivo</option>
              </SelectField>
              <div className="grid grid-cols-2 gap-2">
                {apiRows.map((row) => (
                  <StatusPill key={row.label} ok={row.ok} label={row.label} />
                ))}
              </div>
              <Button variant="secondary" onClick={() => void onRefreshHealth()}>
                <RefreshCw className="h-4 w-4" />
                Atualizar health
              </Button>
            </div>
          </Section>

          <Section
            icon={<RadioTower className="h-4 w-4" />}
            title="Automações"
            description="Modo operacional e métricas"
          >
            <div className="space-y-3">
              <SelectField
                label="Modo operacional"
                value={workspace.automationMode}
                onChange={(v) => updateWorkspace({ automationMode: v as WorkspaceSettings['automationMode'] })}
              >
                <option value="manual">Manual</option>
                <option value="assistido">Assistido</option>
                <option value="automatico">Automático</option>
              </SelectField>
              <div className="grid grid-cols-2 gap-2">
                <DataRow label="Regras" value={health ? 'online' : 'aguardando'} />
                <DataRow label="Cenas permitidas" value={String(obsSettings.allowedScenes.length)} />
              </div>
            </div>
          </Section>
        </div>

        {/* ── Erros & Telemetria ── */}
        <Section
          icon={<ShieldAlert className="h-4 w-4" />}
          title="Relatório de erros"
          description="Preferências de diagnóstico e telemetria"
          defaultOpen={false}
        >
          <div className="space-y-2">
            <ToggleRow
              icon={<ShieldAlert className="h-4 w-4" />}
              label="Salvar diagnósticos locais"
              checked={workspace.errorReports}
              onChange={(v) => updateWorkspace({ errorReports: v })}
            />
            <ToggleRow
              icon={<Database className="h-4 w-4" />}
              label="Telemetria de uso"
              checked={workspace.telemetry}
              onChange={(v) => updateWorkspace({ telemetry: v })}
            />
            <div className="rounded-xl border border-[var(--border)] bg-black/25 p-3 text-xs leading-5 text-[var(--t3)]">
              Estas preferências ficam locais. A estrutura já deixa o painel pronto para plugar
              provedores de erro, custos de API e novas automações.
            </div>
          </div>
        </Section>

        {/* ── Diagnóstico OBS ── */}
        <Section
          icon={<ListVideo className="h-4 w-4" />}
          title="Diagnóstico OBS"
          description="Status detalhado da conexão e fontes"
          defaultOpen={false}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <DataRow label="Conectado" value={obsHealth?.connected ? 'sim' : 'não'} />
            <DataRow label="Source pronta" value={obsHealth?.sourceReady ? 'sim' : 'não'} />
            <DataRow label="Screenshot" value={obsHealth?.screenshotReady ? 'sim' : 'não'} />
            <DataRow label="Troca de cena" value={sceneSwitchReady ? 'sim' : 'não'} />
            <DataRow label="Cenas OBS" value={String(availableScenes.length || obsHealth?.availableScenes?.length || 0)} />
            <DataRow label="Cenas permitidas" value={String(obsSettings.allowedScenes.length)} />
            <DataRow
              label="Resolução"
              value={
                obsHealth?.imageWidth && obsHealth?.imageHeight
                  ? `${obsHealth.imageWidth}x${obsHealth.imageHeight}`
                  : '-'
              }
            />
            <DataRow label="Cena atual" value={obsHealth?.currentScene || '-'} />
          </div>
          {obsHealth?.error && (
            <div className="mt-3 rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {obsHealth.error}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
