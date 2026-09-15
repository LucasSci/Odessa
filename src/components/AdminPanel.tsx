/**
 * AdminPanel — painel administrativo de diagnóstico do programa.
 *
 * Verifica o funcionamento de cada parte do sistema (API, IA, OBS, memória,
 * TTS, automação) e aponta o que precisa de manutenção ou correção:
 * serviço offline, modelo ausente, config incompleta da persona ativa etc.
 */
import { useCallback, useEffect, useState } from 'react';
import { Activity, Plug, RefreshCw, Wrench } from 'lucide-react';
import { apiUrl } from '../lib/api';
import { SystemHealthCard, type ServiceHealth } from './SystemHealthCard';
import { ValidationChecklist, type ValidationCheck } from './ValidationChecklist';
import { cn } from '../lib/utils';

type AiStatus = {
  provider?: string;
  ollama?: { reachable?: boolean; model?: string; modelInstalled?: boolean; url?: string };
  claude?: { configured?: boolean; model?: string };
};

type OllamaConnectResult = {
  ok: boolean;
  started: boolean;
  reachable: boolean;
  modelInstalled: boolean;
  pulling: boolean;
  model: string;
  message: string;
};

type PersonaMetaLite = { id: string; name: string; personality?: string; avatarUrl?: string };

type PersonaConfigLite = {
  videos?: Array<{ id: string }>;
  idleVideoId?: string;
};

type ObsSettings = {
  startupSceneName?: string;
  liveSceneName?: string;
  chatSourceName?: string;
};

type DiagnosticsResult = {
  checkedAt: string;
  services: ServiceHealth[];
  checks: ValidationCheck[];
  stats: { personas: number; activePersona: string; videos: number; problems: number };
  ollama: { online: boolean; modelInstalled: boolean; model?: string };
};

async function probe<T>(path: string): Promise<{ ok: boolean; data: T | null; latencyMs: number; error?: string }> {
  const started = performance.now();
  try {
    const res = await fetch(apiUrl(path), { signal: AbortSignal.timeout(6000) });
    const latencyMs = Math.round(performance.now() - started);
    if (!res.ok) return { ok: false, data: null, latencyMs, error: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as T, latencyMs };
  } catch (err) {
    return { ok: false, data: null, latencyMs: Math.round(performance.now() - started), error: err instanceof Error ? err.message : 'Falha desconhecida' };
  }
}

async function runDiagnostics(): Promise<DiagnosticsResult> {
  const [personas, active, ai, obsScenes, obsSettings, memory, tts, automation] = await Promise.all([
    probe<{ personas: PersonaMetaLite[] }>('/personas'),
    probe<{ persona: PersonaMetaLite; config: PersonaConfigLite }>('/personas/active'),
    probe<AiStatus>('/ai/status'),
    probe<{ ok?: boolean; scenes?: string[]; currentScene?: string | null; error?: string }>('/obs/scenes'),
    probe<{ ok?: boolean; settings?: ObsSettings }>('/obs/settings'),
    probe<Record<string, unknown>>('/memory/stats'),
    probe<Record<string, unknown>>('/tts/voices'),
    probe<Record<string, unknown>>('/automation/metrics'),
  ]);

  const aiData = ai.data;
  const ollama = aiData?.ollama;
  const claude = aiData?.claude;
  const aiOnline = Boolean(ollama?.reachable);
  const services: ServiceHealth[] = [
    { name: 'API Odessa', status: personas.ok ? 'online' : 'offline', latencyMs: personas.latencyMs, detail: personas.error },
    {
      name: `IA local (Ollama${ollama?.model ? ` · ${ollama.model}` : ''})`,
      status: aiOnline ? (ollama?.modelInstalled ? 'online' : 'degraded') : 'offline',
      latencyMs: ai.latencyMs,
      detail: aiOnline ? (ollama?.modelInstalled ? undefined : 'modelo não instalado') : 'inacessível',
    },
    {
      name: `Claude (Anthropic${claude?.model ? ` · ${claude.model}` : ''})`,
      status: claude?.configured ? 'online' : 'offline',
      detail: claude?.configured ? undefined : 'ANTHROPIC_API_KEY não configurada no .env',
    },
    {
      name: 'OBS Studio',
      status: obsScenes.ok && obsScenes.data?.ok ? 'online' : 'offline',
      latencyMs: obsScenes.latencyMs,
      detail: obsScenes.data?.currentScene ? `cena: ${obsScenes.data.currentScene}` : (obsScenes.data?.error || obsScenes.error || 'não conectado'),
    },
    { name: 'Memória de contexto', status: memory.ok ? 'online' : 'offline', latencyMs: memory.latencyMs, detail: memory.error },
    { name: 'Vozes (TTS)', status: tts.ok ? 'online' : 'offline', latencyMs: tts.latencyMs, detail: tts.error },
    { name: 'Motor de automação', status: automation.ok ? 'online' : 'offline', latencyMs: automation.latencyMs, detail: automation.error },
  ];

  const persona = active.data?.persona;
  const config = active.data?.config;
  const videos = config?.videos || [];
  const settings = obsSettings.data?.settings;
  const idleVideoId = config?.idleVideoId;
  const idleOk = Boolean(idleVideoId && videos.some((video) => video.id === idleVideoId));
  const sceneNames = [settings?.startupSceneName, settings?.liveSceneName].filter(Boolean);

  const checks: ValidationCheck[] = [
    {
      id: 'persona-active',
      label: 'Persona ativa definida',
      detail: persona ? `Persona ativa: ${persona.name}` : undefined,
      status: persona ? 'ok' : 'error',
    },
    {
      id: 'persona-personality',
      label: 'Personalidade da persona preenchida',
      detail: persona?.personality ? undefined : 'Defina a personalidade na aba Personas — sem ela as respostas ficam genéricas.',
      status: persona?.personality ? 'ok' : 'warn',
    },
    {
      id: 'persona-avatar',
      label: 'Avatar/imagem da persona definido',
      detail: persona?.avatarUrl ? undefined : 'Envie uma imagem de rosto na aba Personas para a persona ter aparência própria.',
      status: persona?.avatarUrl ? 'ok' : 'warn',
    },
    {
      id: 'videos-configured',
      label: 'Vídeos da persona configurados',
      detail: videos.length ? `${videos.length} vídeo(s) na biblioteca da persona` : 'Nenhum vídeo configurado — a live não terá o que exibir no palco.',
      status: videos.length ? 'ok' : 'error',
    },
    {
      id: 'idle-video',
      label: 'Vídeo de idle válido',
      detail: idleOk ? undefined : idleVideoId ? `idleVideoId "${idleVideoId}" não existe na biblioteca` : 'Nenhum vídeo de idle definido',
      status: idleOk ? 'ok' : 'warn',
    },
    {
      id: 'obs-connected',
      label: 'OBS conectado',
      detail: obsScenes.data?.ok ? undefined : (obsScenes.data?.error || 'Abra o OBS com o websocket habilitado para a live funcionar.'),
      status: obsScenes.ok && obsScenes.data?.ok ? 'ok' : 'error',
    },
    {
      id: 'obs-scenes',
      label: 'Cenas de live configuradas no OBS',
      detail: sceneNames.length ? `Cenas: ${sceneNames.join(', ')}` : 'Defina as cenas de início e de live em Configurações → Transmissão.',
      status: sceneNames.length ? 'ok' : 'warn',
    },
    {
      id: 'ai-model',
      label: 'Modelo de IA instalado',
      detail: aiOnline ? (ollama?.modelInstalled ? undefined : `Rode "ollama pull ${ollama?.model}" para instalar o modelo.`) : 'Ollama inacessível — a persona não conseguirá responder.',
      status: aiOnline ? (ollama?.modelInstalled ? 'ok' : 'error') : 'error',
    },
  ];

  return {
    checkedAt: new Date().toLocaleTimeString('pt-BR'),
    services,
    checks,
    stats: {
      personas: personas.data?.personas.length || 0,
      activePersona: persona?.name || '-',
      videos: videos.length,
      problems: checks.filter((check) => check.status === 'error' || check.status === 'warn').length,
    },
    ollama: { online: aiOnline, modelInstalled: Boolean(ollama?.modelInstalled), model: ollama?.model },
  };
}

function StatTile({ label, value, tone }: { label: string; value: string | number; tone?: 'ok' | 'warn' | 'error' }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#101114] px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className={cn(
        'mt-1 text-xl font-semibold',
        tone === 'ok' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : tone === 'error' ? 'text-red-300' : 'text-white',
      )}>{value}</div>
    </div>
  );
}

export function AdminPanel() {
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectingOllama, setConnectingOllama] = useState(false);
  const [ollamaConnectMessage, setOllamaConnectMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    void runDiagnostics()
      .then(setResult)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const connectOllama = useCallback(async () => {
    setConnectingOllama(true);
    setOllamaConnectMessage(null);
    try {
      const res = await fetch(apiUrl('/ai/ollama/connect'), {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await res.json().catch(() => null)) as OllamaConnectResult | { detail?: string } | null;
      if (!res.ok) {
        const detail = data && 'detail' in data ? data.detail : undefined;
        setOllamaConnectMessage(detail || `Falha ao conectar o Ollama (HTTP ${res.status}).`);
      } else if (data && 'message' in data) {
        setOllamaConnectMessage(data.message);
      }
    } catch (err) {
      setOllamaConnectMessage(err instanceof Error ? err.message : 'Falha ao conectar o Ollama.');
    } finally {
      setConnectingOllama(false);
      refresh();
    }
  }, [refresh]);

  const errors = result?.checks.filter((check) => check.status === 'error') || [];
  const warns = result?.checks.filter((check) => check.status === 'warn') || [];
  const ollamaNeedsAttention = Boolean(result) && (!result!.ollama.online || !result!.ollama.modelInstalled);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
      <div className="mb-5 rounded-2xl border border-white/10 bg-[#101114] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200/70">
              <Activity className="h-4 w-4" />
              Painel administrativo
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">Diagnóstico do sistema</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Verifica cada parte do programa e aponta o que precisa de manutenção ou correção.
              {result && ` Última verificação: ${result.checkedAt}.`}
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Reexecutar diagnóstico
          </button>
        </div>
      </div>

      {result && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Personas" value={result.stats.personas} />
            <StatTile label="Persona ativa" value={result.stats.activePersona} />
            <StatTile label="Vídeos da persona" value={result.stats.videos} />
            <StatTile
              label="Problemas detectados"
              value={result.stats.problems === 0 ? 'Nenhum' : `${errors.length} erro(s), ${warns.length} aviso(s)`}
              tone={errors.length ? 'error' : warns.length ? 'warn' : 'ok'}
            />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                <Activity className="h-3.5 w-3.5 text-emerald-400" /> Saúde dos serviços
              </div>
              <SystemHealthCard services={result.services} />
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                <Wrench className="h-3.5 w-3.5 text-emerald-400" /> Manutenção e correções
              </div>
              <ValidationChecklist checks={result.checks} title="Pendências do sistema" />
            </div>
          </div>

          {ollamaNeedsAttention && (
            <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-300">
                    <Plug className="h-3.5 w-3.5" /> Ollama não está pronto
                  </div>
                  <p className="mt-1 max-w-2xl text-sm text-slate-400">
                    {!result.ollama.online
                      ? 'O Ollama não está acessível — a persona não consegue responder no chat.'
                      : `O modelo ${result.ollama.model || 'configurado'} ainda não está instalado.`}
                    {' '}Clique para tentar conectar e configurar automaticamente.
                  </p>
                  {ollamaConnectMessage && (
                    <p className="mt-1.5 text-xs text-slate-300">{ollamaConnectMessage}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={connectOllama}
                  disabled={connectingOllama}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plug className={cn('h-4 w-4', connectingOllama && 'animate-pulse')} />
                  {connectingOllama ? 'Conectando…' : 'Conectar Ollama'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {!result && loading && (
        <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-8 text-center text-sm text-slate-500">
          Executando diagnóstico...
        </div>
      )}
    </div>
  );
}
