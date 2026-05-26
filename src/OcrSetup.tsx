/**
 * OcrSetup — central de configuração e diagnóstico de captura OCR.
 * Layout: 3 colunas (config | preview | diagnóstico) quando fonte ativa,
 * ou onboarding guiado em 5 etapas quando nenhuma fonte está selecionada.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Layers,
  Monitor,
  Plus,
  RefreshCw,
  ScanText,
  Save,
  Settings,
  Trash2,
  Wifi,
} from 'lucide-react';
import { cn } from './lib/utils';
import { apiUrl } from './lib/api';
import { SystemHealthCard, type ServiceHealth } from './components/SystemHealthCard';
import { DebugLogPanel, logEntry, type LogEntry } from './components/DebugLogPanel';

// ─── Types ────────────────────────────────────────────────────────────────────

type ZoneRole = 'chat' | 'gift' | 'system' | 'custom';
type SourceType = 'window' | 'obs' | 'direct';
type OnboardingStep = 1 | 2 | 3 | 4 | 5;
type StepStatus = 'pending' | 'configured' | 'error' | 'ready';

interface OcrZone {
  id: string;
  name: string;
  role: ZoneRole;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
}

interface OcrConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  interval_ms: number;
  enabled: boolean;
}

const ZONE_COLORS: Record<ZoneRole, string> = {
  chat:   '#3b82f6',
  gift:   '#f59e0b',
  system: '#8b5cf6',
  custom: '#10b981',
};

const ZONE_SAMPLE: Record<ZoneRole, string> = {
  gift:   'Lucas enviou Rosa',
  chat:   'Maria: linda demais!',
  system: 'Live iniciando...',
  custom: 'Texto de exemplo',
};

const ROLE_LABELS: Record<ZoneRole, string> = {
  chat:   'Chat',
  gift:   'Presentes',
  system: 'Sistema',
  custom: 'Customizado',
};

const SOURCE_LABELS: Record<SourceType, { label: string; desc: string; icon: React.ReactNode }> = {
  window: {
    label: 'Janela / Tela',
    desc: 'Captura uma janela ou região da tela do sistema. Ideal para TikTok Live no browser.',
    icon: <Monitor className="h-4 w-4" />,
  },
  obs: {
    label: 'OBS',
    desc: 'Lê diretamente de uma Browser Source no OBS via WebSocket. Mais estável durante a live.',
    icon: <Wifi className="h-4 w-4" />,
  },
  direct: {
    label: 'Link direto',
    desc: 'Aponta para um endpoint HTTP que retorna texto (stream de eventos do TikTok).',
    icon: <Layers className="h-4 w-4" />,
  },
};

const ONBOARDING_STEPS: { label: string; description: string }[] = [
  { label: 'Escolha a fonte',          description: 'Janela, OBS ou link direto' },
  { label: 'Selecione a janela',        description: 'Qual janela/URL será capturada' },
  { label: 'Ajuste as zonas de leitura', description: 'Defina as regiões de chat e presentes' },
  { label: 'Teste o OCR',               description: 'Valide a leitura antes de ir ao ar' },
  { label: 'Salve o preset',            description: 'Guarde esta configuração para reutilizar' },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function OcrSetup() {
  // Config
  const [ocrConfig, setOcrConfig] = useState<OcrConfig>({
    x: 0, y: 0, width: 400, height: 600, interval_ms: 2000, enabled: false,
  });
  const [sourceType, setSourceType] = useState<SourceType>('obs');
  const [zones, setZones] = useState<OcrZone[]>([
    { id: 'zone-chat',  name: 'Chat',      role: 'chat',  color: ZONE_COLORS.chat,   x: 10, y: 50, width: 380, height: 400, enabled: true },
    { id: 'zone-gifts', name: 'Presentes', role: 'gift',  color: ZONE_COLORS.gift,   x: 10, y: 460, width: 320, height: 120, enabled: true },
  ]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Onboarding
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(1);
  const [stepStatuses, setStepStatuses] = useState<Record<OnboardingStep, StepStatus>>({
    1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending',
  });
  const [onboardingDone, setOnboardingDone] = useState(false);

  // Live zones from server
  const [liveZones, setLiveZones] = useState<Record<string, string>>({});

  // Simulation / test (generic ingest)
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<{ status: 'success' | 'error'; message: string } | null>(null);

  // Test zone (dry-run per-zone)
  const [testZoneText, setTestZoneText] = useState('');
  const [testZoneBusy, setTestZoneBusy] = useState(false);

  // Debug logs
  const [debugLogs, setDebugLogs] = useState<LogEntry[]>([]);
  const addLog = useCallback((entry: LogEntry) => setDebugLogs((prev) => [...prev.slice(-199), entry]), []);

  // Health
  const [health, setHealth] = useState<ServiceHealth[]>([
    { name: 'OCR Engine',  status: 'unknown' },
    { name: 'Backend API', status: 'unknown' },
    { name: 'IA Decision', status: 'offline' },
    { name: 'TTS',         status: 'offline' },
  ]);

  // Preset management
  const [activePreset, setActivePreset] = useState('live-chat');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch initial config ─────────────────────────────────────────────────
  useEffect(() => {
    fetch(apiUrl('/api/ocr/config'))
      .then((r) => r.ok ? r.json() : null)
      .then((data: OcrConfig | null) => {
        if (data) {
          setOcrConfig(data);
          if (data.enabled) setOnboardingDone(true);
        }
      })
      .catch(() => undefined);
  }, []);

  // ── Poll live zones ───────────────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(apiUrl('/api/ocr/zones'));
        if (r.ok) setLiveZones(await r.json() as Record<string, string>);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  // ── Health check ──────────────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      const checks: Array<{ name: string; url: string }> = [
        { name: 'OCR Engine',  url: apiUrl('/api/ocr/config') },
        { name: 'Backend API', url: apiUrl('/api/health') },
      ];
      const results = await Promise.all(
        checks.map(async ({ name, url }) => {
          const t = Date.now();
          try {
            const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
            return { name, status: (r.ok ? 'online' : 'degraded') as ServiceHealth['status'], latencyMs: Date.now() - t };
          } catch {
            return { name, status: 'offline' as ServiceHealth['status'], latencyMs: null };
          }
        }),
      );
      setHealth([
        ...results,
        { name: 'IA Decision', status: 'offline' },
        { name: 'TTS',         status: 'offline' },
      ]);
    };
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, []);

  // ── Save config ───────────────────────────────────────────────────────────
  const saveConfig = async () => {
    setIsSaving(true);
    try {
      await fetch(apiUrl('/api/ocr/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ocrConfig),
      });
      addLog(logEntry('sistema', 'Configuração salva', { status: 'ok' }));
    } catch {
      addLog(logEntry('erro', 'Erro ao salvar configuração', { status: 'error' }));
    } finally {
      setTimeout(() => setIsSaving(false), 600);
    }
  };

  // ── Toggle OCR ────────────────────────────────────────────────────────────
  const toggleOcr = async () => {
    const next = { ...ocrConfig, enabled: !ocrConfig.enabled };
    setOcrConfig(next);
    try {
      await fetch(apiUrl('/api/ocr/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      addLog(logEntry('ocr', next.enabled ? 'Motor OCR ativado' : 'Motor OCR desativado', { status: 'ok' }));
    } catch {
      addLog(logEntry('erro', 'Falha ao alternar motor OCR', { status: 'error' }));
    }
  };

  // ── Test OCR text ─────────────────────────────────────────────────────────
  const handleTestText = async () => {
    if (!testText.trim()) return;
    addLog(logEntry('parser', `Injetando texto: "${testText}"`, { status: 'info' }));
    try {
      const r = await fetch(
        apiUrl(`/api/automation/test-trigger?text=${encodeURIComponent(testText)}`),
        { method: 'POST' },
      );
      const data = await r.json() as Record<string, unknown>;
      setTestResult({ status: 'success', message: 'Texto processado com sucesso!' });
      addLog(logEntry('gatilho', 'Gatilho disparado via teste', { detail: JSON.stringify(data).slice(0, 80), status: 'ok' }));
      setTimeout(() => setTestResult(null), 3000);
    } catch {
      setTestResult({ status: 'error', message: 'Falha ao processar texto.' });
      addLog(logEntry('erro', 'Falha ao injetar texto de teste', { status: 'error' }));
    }
    setTestText('');
  };

  // ── Test zone (dry-run) ───────────────────────────────────────────────────
  const handleTestZone = async (zone: OcrZone) => {
    const text = testZoneText.trim() || ZONE_SAMPLE[zone.role];
    if (!text) return;
    setTestZoneBusy(true);
    addLog(logEntry('ocr', `Testando zona "${zone.name}" [${zone.role}]`, { detail: text, status: 'info' }));
    try {
      const r = await fetch(apiUrl('/api/ocr/test-zone'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone, sampleText: text, ocrConfig }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json() as {
        ok: boolean;
        dryRun: boolean;
        parsed: Array<{ line: string; eventType: string; giftKey: string | null; sender: string | null }>;
        matchedTriggers: Array<{ triggerName: string; targetVideoLabel: string | null; giftKey: string | null }>;
        noMatch: Array<{ line: string; reason: string }>;
        wouldFire: boolean;
        totalTriggers: number;
        zoneWarnings: string[];
        latencyMs: number;
      };

      // Log warnings
      for (const w of data.zoneWarnings ?? []) {
        addLog(logEntry('ocr', `⚠ ${w}`, { status: 'warn' }));
      }

      // Log parsed events
      for (const p of data.parsed ?? []) {
        const label = p.eventType === 'gift'
          ? `Parseado: presente "${p.giftKey ?? ''}" de ${p.sender ?? '?'}`
          : `Parseado: comentário de ${p.sender ?? 'anon'}`;
        addLog(logEntry('parser', label, { detail: p.line, status: 'ok' }));
      }

      // Log trigger matches
      if (data.wouldFire) {
        for (const m of data.matchedTriggers) {
          addLog(logEntry('gatilho', `✓ Gatilho "${m.triggerName}" → vídeo "${m.targetVideoLabel ?? m.giftKey ?? '?'}"`, { status: 'ok' }));
        }
      } else if (data.totalTriggers === 0) {
        addLog(logEntry('gatilho', 'Nenhum gatilho configurado no fluxo.', { status: 'warn' }));
      } else {
        for (const nm of data.noMatch ?? []) {
          addLog(logEntry('gatilho', `Sem match para "${nm.line}"`, { detail: nm.reason, status: 'warn' }));
        }
      }

      const summary = data.wouldFire
        ? `✓ ${data.matchedTriggers.length} gatilho(s) disparariam (dry-run, ${data.latencyMs}ms)`
        : `Sem gatilho para esta zona (${data.totalTriggers} configurados)`;
      addLog(logEntry('sistema', summary, { status: data.wouldFire ? 'ok' : 'warn' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      addLog(logEntry('erro', `Falha no teste de zona: ${msg}`, { status: 'error' }));
    } finally {
      setTestZoneBusy(false);
    }
  };

  // ── Zone helpers ──────────────────────────────────────────────────────────
  const addZone = () => {
    const id = `zone-${Date.now()}`;
    setZones((prev) => [
      ...prev,
      { id, name: 'Nova zona', role: 'custom', color: ZONE_COLORS.custom, x: 20, y: 20, width: 200, height: 100, enabled: true },
    ]);
    setSelectedZoneId(id);
  };

  const updateZone = (id: string, patch: Partial<OcrZone>) => {
    setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  };

  const deleteZone = (id: string) => {
    setZones((prev) => prev.filter((z) => z.id !== id));
    if (selectedZoneId === id) setSelectedZoneId(null);
  };

  // ── Export / import preset ────────────────────────────────────────────────
  const exportPreset = () => {
    const data = JSON.stringify({ name: activePreset, zones, ocrConfig }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr-preset-${activePreset}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importPreset = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as { zones?: OcrZone[]; ocrConfig?: OcrConfig };
        if (data.zones) setZones(data.zones);
        if (data.ocrConfig) setOcrConfig(data.ocrConfig);
        addLog(logEntry('sistema', `Preset "${file.name}" importado`, { status: 'ok' }));
      } catch {
        addLog(logEntry('erro', 'Falha ao importar preset', { status: 'error' }));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Mark onboarding step ──────────────────────────────────────────────────
  const markStep = (step: OnboardingStep, status: StepStatus) => {
    setStepStatuses((prev) => ({ ...prev, [step]: status }));
  };

  const advanceOnboarding = (next: OnboardingStep) => {
    markStep(onboardingStep, 'configured');
    setOnboardingStep(next);
  };

  const finishOnboarding = () => {
    markStep(5, 'ready');
    setOnboardingDone(true);
    void saveConfig();
  };

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render: onboarding
  // ─────────────────────────────────────────────────────────────────────────
  if (!onboardingDone) {
    return (
      <div className="flex h-full flex-col bg-[#0a0c10]">
        {/* Onboarding header */}
        <div className="border-b border-slate-800 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-bold text-white">
            <ScanText className="h-5 w-5 text-blue-400" />
            Configurar Captura OCR
          </h2>
          <p className="mt-1 text-sm text-slate-400">Siga as etapas para configurar a captura de eventos da live.</p>
        </div>

        {/* Steps sidebar + content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Steps list */}
          <div className="w-56 shrink-0 border-r border-slate-800 p-4 space-y-1">
            {ONBOARDING_STEPS.map((step, i) => {
              const n = (i + 1) as OnboardingStep;
              const st = stepStatuses[n];
              const isActive = onboardingStep === n;
              return (
                <button
                  key={n}
                  onClick={() => setOnboardingStep(n)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition',
                    isActive ? 'bg-blue-600/20 border border-blue-500/30' : 'hover:bg-slate-800/50',
                  )}
                >
                  <div className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    st === 'ready' || st === 'configured' ? 'bg-emerald-500 text-white' :
                    st === 'error' ? 'bg-red-500 text-white' :
                    isActive ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-400',
                  )}>
                    {st === 'ready' || st === 'configured' ? '✓' : st === 'error' ? '!' : n}
                  </div>
                  <div className="min-w-0">
                    <p className={cn('text-xs font-semibold truncate', isActive ? 'text-white' : 'text-slate-400')}>
                      {step.label}
                    </p>
                    <p className="text-[10px] text-slate-600 truncate">{step.description}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Step content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Step 1: Choose source */}
            {onboardingStep === 1 && (
              <div className="max-w-lg space-y-4">
                <h3 className="text-base font-bold text-white">Etapa 1 — Escolha a fonte de captura</h3>
                <div className="grid gap-3">
                  {(Object.keys(SOURCE_LABELS) as SourceType[]).map((src) => {
                    const info = SOURCE_LABELS[src];
                    return (
                      <button
                        key={src}
                        onClick={() => setSourceType(src)}
                        className={cn(
                          'flex items-start gap-3 rounded-xl border p-4 text-left transition',
                          sourceType === src
                            ? 'border-blue-500/50 bg-blue-500/10'
                            : 'border-slate-700/50 bg-slate-800/20 hover:border-slate-600',
                        )}
                      >
                        <span className={cn('mt-0.5', sourceType === src ? 'text-blue-400' : 'text-slate-500')}>
                          {info.icon}
                        </span>
                        <div>
                          <p className={cn('text-sm font-semibold', sourceType === src ? 'text-white' : 'text-slate-300')}>
                            {info.label}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">{info.desc}</p>
                        </div>
                        {sourceType === src && (
                          <CheckCircle2 className="ml-auto mt-0.5 h-4 w-4 text-blue-400 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => advanceOnboarding(2)}
                  className="mt-2 flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-500 transition"
                >
                  Próximo <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Step 2: Select window */}
            {onboardingStep === 2 && (
              <div className="max-w-lg space-y-4">
                <h3 className="text-base font-bold text-white">Etapa 2 — Selecione a janela / URL</h3>
                {sourceType === 'obs' && (
                  <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
                    <p className="text-sm text-slate-300">
                      A fonte OBS usa o WebSocket configurado em Settings. Certifique-se de que:
                    </p>
                    <ul className="text-xs text-slate-400 space-y-1 list-disc pl-4">
                      <li>OBS está aberto e o WebSocket Server está ativado</li>
                      <li>A Browser Source <code className="bg-slate-700 px-1 rounded">Odessa Chat OCR</code> está criada</li>
                      <li>A source aponta para a URL do chat da live</li>
                    </ul>
                    <SystemHealthCard services={health.slice(0, 2)} compact />
                  </div>
                )}
                {sourceType === 'window' && (
                  <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
                    <p className="text-sm text-slate-300">Configure as coordenadas da região de captura:</p>
                    <div className="grid grid-cols-2 gap-3">
                      {(['x', 'y', 'width', 'height'] as const).map((field) => (
                        <label key={field} className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-slate-500">{field.toUpperCase()}</span>
                          <input
                            type="number"
                            value={ocrConfig[field]}
                            onChange={(e) => setOcrConfig((p) => ({ ...p, [field]: parseInt(e.target.value) || 0 }))}
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {sourceType === 'direct' && (
                  <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-bold uppercase text-slate-500">URL do endpoint</span>
                      <input
                        type="url"
                        placeholder="http://localhost:8000/api/..."
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
                      />
                    </label>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setOnboardingStep(1)}
                    className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 transition"
                  >
                    Voltar
                  </button>
                  <button
                    onClick={() => advanceOnboarding(3)}
                    className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-500 transition"
                  >
                    Próximo <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Zones */}
            {onboardingStep === 3 && (
              <div className="max-w-2xl space-y-4">
                <h3 className="text-base font-bold text-white">Etapa 3 — Zonas de leitura</h3>
                <p className="text-sm text-slate-400">
                  Defina as regiões da tela que serão lidas. Use coordenadas relativas à janela capturada.
                </p>
                <div className="space-y-2">
                  {zones.map((zone) => (
                    <div
                      key={zone.id}
                      className={cn(
                        'rounded-xl border p-3 transition cursor-pointer',
                        selectedZoneId === zone.id
                          ? 'border-blue-500/40 bg-blue-500/8'
                          : 'border-slate-700/40 bg-slate-800/20 hover:border-slate-600',
                      )}
                      onClick={() => setSelectedZoneId(zone.id === selectedZoneId ? null : zone.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ background: zone.color }}
                        />
                        <span className="flex-1 text-sm font-semibold text-slate-200">{zone.name}</span>
                        <span className="text-[10px] text-slate-500">{ROLE_LABELS[zone.role]}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateZone(zone.id, { enabled: !zone.enabled }); }}
                          className="text-slate-500 hover:text-slate-300"
                        >
                          {zone.enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteZone(zone.id); }}
                          className="text-slate-600 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {selectedZoneId === zone.id && (
                        <div className="mt-3 grid grid-cols-4 gap-2">
                          {(['x', 'y', 'width', 'height'] as const).map((f) => (
                            <label key={f} className="space-y-0.5">
                              <span className="text-[9px] font-bold uppercase text-slate-600">{f.toUpperCase()}</span>
                              <input
                                type="number"
                                value={zone[f]}
                                onChange={(e) => updateZone(zone.id, { [f]: parseInt(e.target.value) || 0 })}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-blue-500"
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={addZone}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 py-2.5 text-sm text-slate-500 hover:border-slate-500 hover:text-slate-300 transition"
                  >
                    <Plus className="h-4 w-4" /> Adicionar zona
                  </button>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setOnboardingStep(2)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 transition">Voltar</button>
                  <button onClick={() => advanceOnboarding(4)} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-500 transition">Próximo <ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            )}

            {/* Step 4: Test */}
            {onboardingStep === 4 && (
              <div className="max-w-lg space-y-4">
                <h3 className="text-base font-bold text-white">Etapa 4 — Teste o OCR</h3>
                <p className="text-sm text-slate-400">
                  Injete um texto manualmente para testar se os gatilhos estão reagindo corretamente.
                </p>
                <div className="space-y-2">
                  <textarea
                    value={testText}
                    onChange={(e) => setTestText(e.target.value)}
                    placeholder='Ex: "Lucas enviou Rosa" ou "Maria comentou: linda!"'
                    className="w-full h-20 rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200 outline-none focus:border-blue-500 resize-none font-mono"
                  />
                  <button
                    onClick={() => void handleTestText()}
                    disabled={!testText.trim()}
                    className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-40 transition"
                  >
                    Testar
                  </button>
                  {testResult && (
                    <div className={cn(
                      'rounded-xl border px-4 py-3 text-sm font-mono',
                      testResult.status === 'success'
                        ? 'border-emerald-700 bg-emerald-900/20 text-emerald-300'
                        : 'border-red-700 bg-red-900/20 text-red-300',
                    )}>
                      {testResult.message}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setOnboardingStep(3)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 transition">Voltar</button>
                  <button onClick={() => advanceOnboarding(5)} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-500 transition">Próximo <ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            )}

            {/* Step 5: Save preset */}
            {onboardingStep === 5 && (
              <div className="max-w-lg space-y-4">
                <h3 className="text-base font-bold text-white">Etapa 5 — Salvar preset</h3>
                <p className="text-sm text-slate-400">
                  Dê um nome a esta configuração para reutilizar depois.
                </p>
                <label className="space-y-1 block">
                  <span className="text-[10px] font-bold uppercase text-slate-500">Nome do preset</span>
                  <input
                    type="text"
                    value={activePreset}
                    onChange={(e) => setActivePreset(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
                  />
                </label>
                <div className="flex gap-2">
                  <button onClick={() => setOnboardingStep(4)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 transition">Voltar</button>
                  <button
                    onClick={finishOnboarding}
                    className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 transition"
                  >
                    <Save className="h-4 w-4" /> Finalizar configuração
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render: 3-column operational layout
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col bg-[#0a0c10]">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <ScanText className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-bold text-white">Fontes / OCR</span>
          <span className="text-[10px] text-slate-600">|</span>
          <span className="text-xs text-slate-500">{activePreset}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOnboardingDone(false)}
            className="text-[10px] text-slate-600 hover:text-slate-400 transition"
          >
            Reconfigurar
          </button>
          <button
            onClick={toggleOcr}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition',
              ocrConfig.enabled
                ? 'bg-emerald-600/20 border border-emerald-500/30 text-emerald-300'
                : 'border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700',
            )}
          >
            <Activity className={cn('h-3.5 w-3.5', ocrConfig.enabled && 'animate-pulse')} />
            {ocrConfig.enabled ? 'OCR: LIGADO' : 'OCR: DESLIGADO'}
          </button>
          <button
            onClick={() => void saveConfig()}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition disabled:opacity-50"
          >
            <Save className="h-3 w-3" />
            {isSaving ? 'Salvo!' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* 3-column body */}
      <div className="flex flex-1 min-h-0 divide-x divide-slate-800">

        {/* ── Column A: Config ── */}
        <div className="w-64 shrink-0 overflow-y-auto p-4 space-y-4">
          <SectionHeader icon={<Settings className="h-3.5 w-3.5" />} label="Configuração" />

          {/* Source selector */}
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase text-slate-600">Fonte</label>
            <div className="grid gap-1.5">
              {(Object.keys(SOURCE_LABELS) as SourceType[]).map((src) => (
                <button
                  key={src}
                  onClick={() => setSourceType(src)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition',
                    sourceType === src
                      ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                      : 'border-slate-700/40 text-slate-400 hover:border-slate-600',
                  )}
                >
                  <span className={sourceType === src ? 'text-blue-400' : 'text-slate-600'}>
                    {SOURCE_LABELS[src].icon}
                  </span>
                  {SOURCE_LABELS[src].label}
                </button>
              ))}
            </div>
          </div>

          {/* Capture region */}
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase text-slate-600">Região de captura</label>
            <div className="grid grid-cols-2 gap-2">
              {(['x', 'y', 'width', 'height'] as const).map((f) => (
                <label key={f} className="space-y-0.5">
                  <span className="text-[9px] font-bold uppercase text-slate-600">{f.toUpperCase()}</span>
                  <input
                    type="number"
                    value={ocrConfig[f]}
                    onChange={(e) => setOcrConfig((p) => ({ ...p, [f]: parseInt(e.target.value) || 0 }))}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Interval */}
          <div className="space-y-1">
            <label className="text-[9px] font-bold uppercase text-slate-600">
              Intervalo (ms): {ocrConfig.interval_ms}
            </label>
            <input
              type="range"
              min={500}
              max={5000}
              step={100}
              value={ocrConfig.interval_ms}
              onChange={(e) => setOcrConfig((p) => ({ ...p, interval_ms: parseInt(e.target.value) }))}
              className="w-full accent-blue-500"
            />
          </div>

          {/* Presets */}
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase text-slate-600">Presets</label>
            <select
              value={activePreset}
              onChange={(e) => setActivePreset(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none"
            >
              <option value="live-chat">Live Chat</option>
              <option value="obs-compact">OBS Compacto</option>
              <option value="eventos">Eventos</option>
              <option value={activePreset}>{activePreset}</option>
            </select>
            <div className="flex gap-1.5">
              <button
                onClick={exportPreset}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-700 py-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition"
              >
                <Download className="h-3 w-3" /> Exportar
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-700 py-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition"
              >
                <RefreshCw className="h-3 w-3" /> Importar
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={importPreset}
              />
            </div>
          </div>
        </div>

        {/* ── Column B: Preview + Zones ── */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center justify-between">
            <SectionHeader icon={<Eye className="h-3.5 w-3.5" />} label="Preview de Zonas" />
            <button
              onClick={addZone}
              className="flex items-center gap-1 rounded-lg border border-dashed border-slate-700 px-3 py-1 text-[10px] text-slate-500 hover:border-slate-500 hover:text-slate-300 transition"
            >
              <Plus className="h-3 w-3" /> Zona
            </button>
          </div>

          {/* Zone visual overlay */}
          <div
            className="relative rounded-xl border border-slate-700/50 bg-[#060810] overflow-hidden"
            style={{ height: 320 }}
          >
            <div className="absolute inset-0 opacity-20"
              style={{
                backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
                backgroundSize: '40px 40px',
              }}
            />
            {/* Scale zones to preview container */}
            {zones.filter((z) => z.enabled).map((zone) => {
              const scaleX = 100 / Math.max(ocrConfig.width, 1);
              const scaleY = 320 / Math.max(ocrConfig.height, 1);
              return (
                <div
                  key={zone.id}
                  onClick={() => setSelectedZoneId(zone.id === selectedZoneId ? null : zone.id)}
                  className={cn(
                    'absolute cursor-pointer rounded transition-all',
                    selectedZoneId === zone.id ? 'opacity-90' : 'opacity-50 hover:opacity-70',
                  )}
                  style={{
                    left: `${zone.x * scaleX}%`,
                    top: zone.y * scaleY,
                    width: `${zone.width * scaleX}%`,
                    height: zone.height * scaleY,
                    border: `2px solid ${zone.color}`,
                    backgroundColor: `${zone.color}22`,
                  }}
                >
                  <span
                    className="absolute left-1 top-1 rounded px-1 py-0.5 text-[9px] font-bold"
                    style={{ background: zone.color, color: '#000' }}
                  >
                    {zone.name}
                  </span>
                </div>
              );
            })}
            {/* Label hint */}
            <div className="absolute bottom-2 right-2 text-[9px] text-slate-700">
              {ocrConfig.width}×{ocrConfig.height}px
            </div>
          </div>

          {/* Zone list */}
          <div className="space-y-1.5">
            {zones.map((zone) => (
              <div
                key={zone.id}
                onClick={() => setSelectedZoneId(zone.id === selectedZoneId ? null : zone.id)}
                className={cn(
                  'flex items-center gap-3 rounded-xl border px-3 py-2 cursor-pointer transition',
                  selectedZoneId === zone.id
                    ? 'border-blue-500/30 bg-blue-500/8'
                    : 'border-slate-700/30 hover:border-slate-600/50',
                )}
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: zone.color }} />
                <span className="flex-1 text-xs font-medium text-slate-300">{zone.name}</span>
                <span className="text-[10px] text-slate-600">{ROLE_LABELS[zone.role]}</span>
                <span className="text-[10px] font-mono text-slate-700">
                  {zone.width}×{zone.height}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); updateZone(zone.id, { enabled: !zone.enabled }); }}
                  className="text-slate-600 hover:text-slate-400 transition"
                >
                  {zone.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteZone(zone.id); }}
                  className="text-slate-700 hover:text-red-400 transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Zone editor when selected */}
          {selectedZone && (
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: selectedZone.color }} />
                <span className="text-xs font-bold text-white">{selectedZone.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-0.5">
                  <span className="text-[9px] font-bold uppercase text-slate-600">Nome</span>
                  <input
                    type="text"
                    value={selectedZone.name}
                    onChange={(e) => updateZone(selectedZone.id, { name: e.target.value })}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[9px] font-bold uppercase text-slate-600">Tipo</span>
                  <select
                    value={selectedZone.role}
                    onChange={(e) => updateZone(selectedZone.id, { role: e.target.value as ZoneRole, color: ZONE_COLORS[e.target.value as ZoneRole] })}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none"
                  >
                    {(Object.keys(ROLE_LABELS) as ZoneRole[]).map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </label>
                {(['x', 'y', 'width', 'height'] as const).map((f) => (
                  <label key={f} className="space-y-0.5">
                    <span className="text-[9px] font-bold uppercase text-slate-600">{f.toUpperCase()}</span>
                    <input
                      type="number"
                      value={selectedZone[f]}
                      onChange={(e) => updateZone(selectedZone.id, { [f]: parseInt(e.target.value) || 0 })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-blue-500"
                    />
                  </label>
                ))}
              </div>
              {/* ── Test zone (dry-run) ── */}
              <div className="space-y-1.5 pt-1 border-t border-slate-800">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Testar zona</span>
                <input
                  type="text"
                  value={testZoneText}
                  onChange={(e) => setTestZoneText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleTestZone(selectedZone); }}
                  placeholder={ZONE_SAMPLE[selectedZone.role]}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-blue-500 font-mono"
                />
                <button
                  onClick={() => void handleTestZone(selectedZone)}
                  disabled={testZoneBusy}
                  className="w-full rounded-lg border border-blue-500/30 bg-blue-500/10 py-1.5 text-[10px] font-bold text-blue-300 hover:bg-blue-500/15 disabled:opacity-50 transition"
                >
                  {testZoneBusy ? '⟳ Testando…' : 'Testar OCR nesta zona'}
                </button>
              </div>
            </div>
          )}

          {/* Simulator */}
          <div className="space-y-2">
            <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} label="Simular evento" />
            <textarea
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              placeholder='"Lucas enviou Rosa" ou "Maria: linda!"'
              className="w-full h-16 rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 outline-none focus:border-blue-500 resize-none font-mono"
            />
            <button
              onClick={() => void handleTestText()}
              disabled={!testText.trim()}
              className="w-full rounded-xl bg-blue-600 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-40 transition"
            >
              Injetar texto
            </button>
            {testResult && (
              <div className={cn(
                'rounded-xl border px-3 py-2 text-xs font-mono',
                testResult.status === 'success'
                  ? 'border-emerald-700/50 bg-emerald-900/20 text-emerald-300'
                  : 'border-red-700/50 bg-red-900/20 text-red-300',
              )}>
                {testResult.message}
              </div>
            )}
          </div>
        </div>

        {/* ── Column C: Diagnostics ── */}
        <div className="w-72 shrink-0 overflow-y-auto p-4 space-y-4">
          <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} label="Diagnóstico" />

          {/* System health */}
          <SystemHealthCard services={health} />

          {/* Live OCR zones */}
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase text-slate-600 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Leitura ao vivo
            </label>
            <div className="rounded-xl border border-slate-700/40 bg-[#080a0e] p-3 space-y-2 min-h-[80px]">
              {Object.keys(liveZones).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-2 text-slate-600">
                  <RefreshCw className="h-5 w-5 mb-1 animate-spin opacity-30" />
                  <p className="text-[10px]">Aguardando captura...</p>
                </div>
              ) : (
                Object.entries(liveZones).map(([id, text]) => (
                  <div key={id} className="rounded-lg border border-slate-700/30 bg-slate-800/30 p-2">
                    <div className="mb-1 text-[9px] font-bold uppercase text-blue-400">{id}</div>
                    <div className="font-mono text-[10px] text-emerald-300 break-words line-clamp-3">
                      {text || <span className="text-slate-700 italic">vazio</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Alerts */}
          {!ocrConfig.enabled && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/8 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200">
                Motor OCR está desligado. Ative para começar a captura de eventos.
              </p>
            </div>
          )}

          {/* Debug console */}
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase text-slate-600">Console</label>
            <DebugLogPanel
              entries={debugLogs}
              onClear={() => setDebugLogs([])}
              height={200}
              title="Debug"
            />
          </div>

          {/* How it works */}
          <div className="rounded-xl border border-slate-700/30 bg-slate-800/20 p-3 space-y-1.5">
            <p className="text-[9px] font-bold uppercase text-slate-600">Como funciona</p>
            <ul className="space-y-1 text-[10px] text-slate-500 list-decimal pl-3.5">
              <li>OCR captura texto bruto da tela</li>
              <li>Parser transforma em evento estruturado</li>
              <li>Filtro remove duplicatas / ruído</li>
              <li>Motor de regras verifica gatilhos</li>
              <li><span className="text-violet-400">[IA]</span> Avalia contexto e prioridade</li>
              <li>Palco executa a transição</li>
              <li>Clipe retorna ao IDLE</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500">{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
    </div>
  );
}
