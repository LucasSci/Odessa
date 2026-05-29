/**
 * AiConfigPanel — aba central de controle da IA.
 *
 * Seções:
 *  1. Status       — modo atual (mock/simulado/online), por que, botão testar
 *  2. Chave da API — input Gemini, salvar em localStorage
 *  3. Personalidade — system prompt editável + seletor de provedor
 *  4. Parâmetros   — threshold de confiança com preview
 *  5. Teste manual — texto livre → exibe AiDecision completo em tempo real
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Brain, Zap, Key, Sliders, FlaskConical, CheckCircle, XCircle, AlertCircle, Loader2, Eye, EyeOff, RotateCcw, Bot, Activity, Pause, Radio, Sparkles, Gift, MessageCircle, Trash2, Film, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button, Input } from './ui';
import { AiDecisionPanel } from './AiDecisionPanel';
import {
  getChatInsights,
  summarizeChatLearning,
  clearChatLearning,
} from '../core/chatLearning';
import { getGiftLearning, clearGiftLearning, type GiftStat } from '../core/giftLearning';
import {
  getAiConfig,
  saveAiConfig,
  hasActiveGeminiKey,
  AI_SYSTEM_PROMPT_DEFAULT,
  type AiProvider,
  type AiAutonomyLevel,
} from '../core/aiConfig';
import {
  callAiDecision,
  callGeminiDirect,
  buildAiUserMessage,
  INTENT_LABELS,
  type AiDecision,
} from '../core/aiDecisionContract';
import {
  loadVideoPresets,
  getVideoPreset,
  saveVideoPreset,
  defaultProfile,
  videoCooldownRemaining,
  type VideoReactionProfile,
} from '../core/videoPresets';
import { buildOcrEvent } from '../core/ocrEventContract';
import type { OcrEvent } from '../core/ocrEventContract';
import type { AutopilotRuntimeState } from '../core/useAutopilotRuntime';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AiConfigPanelProps {
  videos: Array<{ id: string; label?: string; name?: string; title?: string }>;
  triggers: Array<{ id: string; name?: string; label?: string; enabled?: boolean }>;
  runtime: AutopilotRuntimeState;
}

// Tipos de evento selecionáveis no perfil de reação.
const EVENT_KIND_OPTIONS: Array<[string, string]> = [
  ['gift', 'Presente'],
  ['chat', 'Chat'],
  ['alert', 'Alerta'],
  ['follow', 'Seguidor'],
  ['system', 'Sistema'],
];

// Intenções selecionáveis (exclui 'unknown').
const INTENT_OPTIONS = (Object.keys(INTENT_LABELS) as Array<keyof typeof INTENT_LABELS>).filter(
  (k) => k !== 'unknown',
);

function videoDisplayName(v: { label?: string; name?: string; title?: string; id: string }): string {
  return v.label || v.title || v.name || v.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••••••' + key.slice(-4);
}

function deriveStatusInfo(provider: AiProvider): {
  label: string;
  sublabel: string;
  color: string;
  bg: string;
  border: string;
  icon: 'online' | 'mock' | 'warn';
} {
  const hasKey = hasActiveGeminiKey();
  const buildKey = (import.meta.env as Record<string, string>).VITE_GEMINI_API_KEY ?? '';

  if (provider === 'mock') {
    return {
      label: 'MOCK FORÇADO',
      sublabel: 'Modo mock ativo nas configurações. Nenhuma chamada real é feita.',
      color: 'text-amber-400',
      bg: 'bg-amber-500/8',
      border: 'border-amber-500/20',
      icon: 'warn',
    };
  }
  if (!hasKey) {
    return {
      label: 'SEM CHAVE DE API',
      sublabel: 'Cole a chave Gemini abaixo para ativar a IA real.',
      color: 'text-slate-500',
      bg: 'bg-slate-800/30',
      border: 'border-slate-700/30',
      icon: 'mock',
    };
  }
  return {
    label: buildKey ? 'GEMINI — CHAVE DE BUILD' : 'GEMINI — CHAVE LOCAL',
    sublabel: buildKey
      ? 'Chave embutida na build (VITE_GEMINI_API_KEY). Tem prioridade sobre a chave local.'
      : 'Chave salva no seu browser (localStorage). Funciona mesmo sem redeploy.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/8',
    border: 'border-emerald-500/20',
    icon: 'online',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-white/8 bg-[#0e1012] p-5 space-y-4', className)}>
      <div className="flex items-center gap-2">
        <span className="text-violet-400">{icon}</span>
        <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function StatusIcon({ kind }: { kind: 'online' | 'mock' | 'warn' }) {
  if (kind === 'online') return <CheckCircle className="h-4 w-4 text-emerald-400" />;
  if (kind === 'warn')   return <AlertCircle className="h-4 w-4 text-amber-400" />;
  return <XCircle className="h-4 w-4 text-slate-500" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const AUTONOMY_INFO: Record<AiAutonomyLevel, { label: string; desc: string }> = {
  manual: { label: 'Manual', desc: 'A IA sugere, mas nada executa sozinho — tudo espera sua aprovação.' },
  assistido: { label: 'Assistido', desc: 'Vídeo, voz e cena automáticos; moderação pede aprovação.' },
  auto: { label: 'Autônomo', desc: 'A Diretora conduz tudo sozinha dentro do que está habilitado.' },
};

export function AiConfigPanel({ videos, triggers, runtime }: AiConfigPanelProps) {
  const cfg = getAiConfig();

  // ── Status section ─────────────────────────────────────────────────────────
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');

  // ── API Key section ────────────────────────────────────────────────────────
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  // ── Personality section ────────────────────────────────────────────────────
  const [promptDraft, setPromptDraft] = useState(cfg.systemPrompt || '');
  const [provider, setProvider] = useState<AiProvider>(cfg.provider);
  const [personalitySaved, setPersonalitySaved] = useState(false);

  // ── Parameters section ─────────────────────────────────────────────────────
  const [threshold, setThreshold] = useState(cfg.confidenceThreshold);
  const [thresholdSaved, setThresholdSaved] = useState(false);

  // ── Test section ───────────────────────────────────────────────────────────
  const [testInput, setTestInput] = useState('');
  const [testDecision, setTestDecision] = useState<AiDecision | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testPrompt, setTestPrompt] = useState('');
  const testAbortRef = useRef<AbortController | null>(null);

  // ── Aprendizado (chat + presentes) ──────────────────────────────────────────
  const [chatInsights, setChatInsights] = useState(() => getChatInsights());
  const [giftStats, setGiftStats] = useState<GiftStat[]>(() => getGiftLearning());
  const [summarizing, setSummarizing] = useState(false);

  // ── Derived ────────────────────────────────────────────────────────────────
  const [currentProvider, setCurrentProvider] = useState<AiProvider>(cfg.provider);
  const statusInfo = deriveStatusInfo(currentProvider);
  const storedKey = cfg.geminiKey;

  // Atualiza os insights periodicamente (a rodada escreve nos stores enquanto no ar).
  useEffect(() => {
    const refresh = () => {
      setChatInsights(getChatInsights());
      setGiftStats(getGiftLearning());
      setVideoPresets(loadVideoPresets());
    };
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const handleSummarizeLearning = useCallback(async () => {
    setSummarizing(true);
    try {
      await summarizeChatLearning();
      setChatInsights(getChatInsights());
    } catch {
      // sem chave / falha de rede — silencioso (a UI mostra estado sem resumo)
    } finally {
      setSummarizing(false);
    }
  }, []);

  const handleClearChatLearning = useCallback(() => {
    clearChatLearning();
    setChatInsights(getChatInsights());
  }, []);

  const handleClearGiftLearning = useCallback(() => {
    clearGiftLearning();
    setGiftStats(getGiftLearning());
  }, []);

  // ── Reações por vídeo (Fase 3) ───────────────────────────────────────────────
  const [videoPresets, setVideoPresets] = useState(() => loadVideoPresets());
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const [draftPreset, setDraftPreset] = useState<VideoReactionProfile | null>(null);

  const toggleVideoAuto = useCallback((videoId: string) => {
    const p = getVideoPreset(videoId) ?? defaultProfile(videoId);
    saveVideoPreset({ ...p, enabled: !p.enabled });
    setVideoPresets(loadVideoPresets());
  }, []);

  const openPresetEditor = useCallback((videoId: string) => {
    setDraftPreset(getVideoPreset(videoId) ?? defaultProfile(videoId));
    setEditingVideoId(videoId);
  }, []);

  const savePresetDraft = useCallback(() => {
    if (draftPreset) {
      saveVideoPreset(draftPreset);
      setVideoPresets(loadVideoPresets());
    }
    setEditingVideoId(null);
    setDraftPreset(null);
  }, [draftPreset]);

  const toggleDraftArray = useCallback((field: 'eventKinds' | 'intents', value: string) => {
    setDraftPreset((d) =>
      d
        ? {
            ...d,
            [field]: d[field].includes(value)
              ? d[field].filter((x) => x !== value)
              : [...d[field], value],
          }
        : d,
    );
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleTestConnection = useCallback(async () => {
    setTestStatus('loading');
    setTestError('');
    try {
      const dummyEvent: OcrEvent = buildOcrEvent('teste de conexão', {
        eventType: 'comment',
        zone: 'chat',
        zoneName: 'Chat',
        confidence: 0.9,
      });
      const decision = await callGeminiDirect(dummyEvent);
      if (!decision) throw new Error('Nenhuma chave disponível para testar.');
      setTestStatus('ok');
    } catch (err) {
      setTestStatus('error');
      setTestError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }, []);

  const handleSaveKey = useCallback(() => {
    const trimmed = keyInput.trim();
    saveAiConfig({ geminiKey: trimmed });
    setKeyInput('');
    setKeySaved(true);
    setCurrentProvider(getAiConfig().provider);
    setTimeout(() => setKeySaved(false), 2500);
  }, [keyInput]);

  const handleClearKey = useCallback(() => {
    saveAiConfig({ geminiKey: '' });
    setKeyInput('');
    setCurrentProvider(getAiConfig().provider);
  }, []);

  const handleSavePersonality = useCallback(() => {
    saveAiConfig({ systemPrompt: promptDraft, provider });
    setCurrentProvider(provider);
    setPersonalitySaved(true);
    setTimeout(() => setPersonalitySaved(false), 2500);
  }, [promptDraft, provider]);

  const handleResetPrompt = useCallback(() => {
    setPromptDraft('');
  }, []);

  const handleSaveThreshold = useCallback(() => {
    saveAiConfig({ confidenceThreshold: threshold });
    setThresholdSaved(true);
    setTimeout(() => setThresholdSaved(false), 2500);
  }, [threshold]);

  const handleRunTest = useCallback(async () => {
    const text = testInput.trim();
    if (!text) return;

    testAbortRef.current?.abort();
    testAbortRef.current = new AbortController();

    setTestRunning(true);
    setTestDecision(null);

    // Monta o contexto que o usuário vai ver
    const ocrEvent: OcrEvent = buildOcrEvent(text, {
      eventType: /rosa|flor|coração|gift|presente|estrela/i.test(text) ? 'gift' : 'comment',
      zone: 'chat',
      zoneName: 'Chat',
      confidence: 0.95,
    });

    setTestPrompt(buildAiUserMessage(ocrEvent, { videos, triggers }));

    try {
      const decision = await callAiDecision(ocrEvent, { videos, triggers });
      setTestDecision(decision);
    } catch (err) {
      console.warn('[AiConfigPanel] test error:', err);
    } finally {
      setTestRunning(false);
    }
  }, [testInput, videos, triggers]);

  // ── Threshold preview label ────────────────────────────────────────────────
  function thresholdLabel(v: number): string {
    if (v >= 0.9) return 'Muito restritivo — só reage a eventos com altíssima confiança.';
    if (v >= 0.75) return 'Restritivo — reage com segurança, ignora dúvidas.';
    if (v >= 0.6) return 'Balanceado — padrão recomendado (0.65).';
    if (v >= 0.45) return 'Permissivo — reage mesmo com baixa confiança.';
    return 'Muito permissivo — pode gerar reações indesejadas.';
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4 lg:p-5">
      {/* Header */}
      <div className="mb-4 shrink-0 rounded-[34px] border border-white/10 bg-[#101114] p-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-sky-200/70">
          <Brain className="h-4 w-4" />
          Odessa console
        </div>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-white">
          Central de IA
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Configure a chave da API, personalidade e parâmetros da IA. Teste em tempo real antes de ir ao ar.
        </p>
      </div>

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[34px] border border-white/10 bg-[#07080a]">
        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">

          {/* ── 1. Status ─────────────────────────────────────────────────── */}
          <SectionCard icon={<Zap className="h-4 w-4" />} title="Status da IA" className="lg:col-span-2">
            <div className={cn('flex items-start gap-3 rounded-xl border p-4', statusInfo.bg, statusInfo.border)}>
              <StatusIcon kind={statusInfo.icon} />
              <div className="flex-1 min-w-0">
                <p className={cn('text-xs font-bold uppercase tracking-widest', statusInfo.color)}>
                  {statusInfo.label}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">{statusInfo.sublabel}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleTestConnection()}
                disabled={testStatus === 'loading' || !hasActiveGeminiKey() || currentProvider === 'mock'}
                className="shrink-0"
              >
                {testStatus === 'loading' ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-1" />Testando…</>
                ) : (
                  'Testar conexão'
                )}
              </Button>
            </div>
            {testStatus === 'ok' && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle className="h-3.5 w-3.5" />
                Gemini respondeu com sucesso — IA ativa!
              </p>
            )}
            {testStatus === 'error' && (
              <p className="flex items-center gap-1.5 text-xs text-red-400">
                <XCircle className="h-3.5 w-3.5" />
                Erro: {testError}
              </p>
            )}

            {/* Modo build-key info */}
            {(import.meta.env as Record<string, string>).VITE_GEMINI_API_KEY && (
              <p className="rounded-lg border border-sky-500/20 bg-sky-500/8 px-3 py-2 text-[11px] text-sky-300">
                ℹ️ <strong>VITE_GEMINI_API_KEY</strong> está embutida nesta build — ela tem prioridade sobre a chave local abaixo.
              </p>
            )}
          </SectionCard>

          {/* ── Diretora ao vivo (cockpit) ────────────────────────────────── */}
          <SectionCard icon={<Bot className="h-4 w-4" />} title="Diretora ao vivo" className="lg:col-span-2">
            {/* Estado + controle */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-[#0a0b0d] p-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest',
                    runtime.autopilotEnabled
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-700/40 text-slate-400',
                  )}
                >
                  <Radio className="h-3 w-3" />
                  {runtime.autopilotEnabled ? 'No ar' : 'Fora do ar'}
                </span>
                {runtime.isProcessing && (
                  <span className="flex items-center gap-1 text-[10px] text-violet-300">
                    <Loader2 className="h-3 w-3 animate-spin" /> decidindo…
                  </span>
                )}
                {!hasActiveGeminiKey() && (
                  <span className="text-[10px] text-amber-400">sem chave — usando regras locais</span>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => (runtime.autopilotEnabled ? runtime.pause() : runtime.start())}
              >
                {runtime.autopilotEnabled ? (
                  <><Pause className="h-3.5 w-3.5 mr-1" />Pausar Diretora</>
                ) : (
                  <><Activity className="h-3.5 w-3.5 mr-1" />Iniciar Diretora</>
                )}
              </Button>
            </div>

            {runtime.lastError && (
              <p className="flex items-center gap-1.5 text-[11px] text-red-400">
                <XCircle className="h-3.5 w-3.5" /> {runtime.lastError}
              </p>
            )}

            {/* Nível de autonomia */}
            <div className="space-y-2">
              <span className="text-[11px] font-medium text-slate-400">Nível de autonomia</span>
              <div className="flex flex-wrap gap-2">
                {(['manual', 'assistido', 'auto'] as AiAutonomyLevel[]).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => runtime.setAutonomyLevel(lvl)}
                    className={cn(
                      'rounded-lg border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition',
                      runtime.autonomyLevel === lvl
                        ? 'border-violet-500/50 bg-violet-500/15 text-violet-300'
                        : 'border-white/8 bg-transparent text-slate-500 hover:text-slate-300',
                    )}
                  >
                    {AUTONOMY_INFO[lvl].label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-600">{AUTONOMY_INFO[runtime.autonomyLevel].desc}</p>
            </div>

            {/* Feed de decisões da Diretora */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
                Últimas decisões
              </span>
              {runtime.cycles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/8 p-5 text-center text-[11px] text-slate-600">
                  Nenhuma decisão ainda. Inicie a Diretora e os eventos do chat aparecerão aqui.
                </div>
              ) : (
                <div className="space-y-2">
                  {runtime.cycles
                    .slice(-6)
                    .reverse()
                    .map((cycle) => (
                      <div
                        key={cycle.id}
                        className="rounded-xl border border-white/8 bg-[#0a0b0d] p-3 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-300 truncate">
                            <span className="text-slate-600">[{cycle.event?.kind || 'evento'}]</span>{' '}
                            {cycle.event?.text || '—'}
                          </span>
                          {cycle.decision && (
                            <span className="shrink-0 font-mono text-[10px] text-violet-300">
                              {Math.round((cycle.decision.confidence || 0) * 100)}%
                            </span>
                          )}
                        </div>
                        {cycle.decision?.speech && (
                          <p className="text-[11px] text-sky-200/80 italic">“{cycle.decision.speech}”</p>
                        )}
                        {cycle.decision?.reason && (
                          <p className="text-[10px] text-slate-500">{cycle.decision.reason}</p>
                        )}
                        {cycle.actions.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {cycle.actions.map((action) => (
                              <span
                                key={action.id}
                                className={cn(
                                  'rounded px-1.5 py-0.5 font-mono text-[9px]',
                                  action.status === 'done'
                                    ? 'bg-emerald-500/10 text-emerald-300'
                                    : action.status === 'error' || action.status === 'blocked'
                                      ? 'bg-red-500/10 text-red-300'
                                      : action.status === 'approval_required'
                                        ? 'bg-amber-500/10 text-amber-300'
                                        : 'bg-slate-700/30 text-slate-400',
                                )}
                                title={action.result || action.status}
                              >
                                {action.type}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </SectionCard>

          {/* ── Aprendizado (chat + presentes) ────────────────────────────── */}
          <SectionCard icon={<Sparkles className="h-4 w-4" />} title="Aprendizado" className="lg:col-span-2">
            <p className="text-[11px] text-slate-500">
              A Diretora aprende com a live: o que o chat fala/pede/curte e os presentes recebidos.
              Esses dados entram no contexto das decisões automaticamente.
            </p>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Chat */}
              <div className="rounded-xl border border-white/8 bg-[#0a0b0d] p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-3.5 w-3.5 text-sky-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Chat</span>
                  <span className="ml-auto font-mono text-[10px] text-slate-500">
                    {chatInsights.totalMessages} msgs · {chatInsights.questions} perguntas
                  </span>
                </div>

                {chatInsights.totalMessages === 0 ? (
                  <p className="text-[11px] text-slate-600">
                    Nada aprendido ainda. Inicie a Diretora e o aprendizado aparece aqui.
                  </p>
                ) : (
                  <>
                    {chatInsights.topRequests.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Pedidos frequentes</span>
                        {chatInsights.topRequests.map(([key, c]) => (
                          <div key={key} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate text-slate-300">{c.sample || key}</span>
                            <span className="shrink-0 font-mono text-[10px] text-violet-300">{c.count}x</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {chatInsights.topLikes.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">O chat curte</span>
                        <div className="flex flex-wrap gap-1">
                          {chatInsights.topLikes.map(([key, c]) => (
                            <span key={key} className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                              {key} · {c.count}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {chatInsights.topTopics.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Tópicos recorrentes</span>
                        <div className="flex flex-wrap gap-1">
                          {chatInsights.topTopics.map(([key, c]) => (
                            <span key={key} className="rounded bg-slate-700/40 px-1.5 py-0.5 text-[10px] text-slate-300">
                              {key} · {c.count}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {chatInsights.aiSummary && (
                      <p className="rounded-lg border border-sky-500/20 bg-sky-500/8 px-2.5 py-1.5 text-[11px] text-sky-200/90">
                        {chatInsights.aiSummary.text}
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleSummarizeLearning()}
                        disabled={summarizing || !hasActiveGeminiKey() || chatInsights.totalMessages === 0}
                      >
                        {summarizing ? (
                          <><Loader2 className="h-3 w-3 animate-spin mr-1" />Resumindo…</>
                        ) : (
                          <><Sparkles className="h-3 w-3 mr-1" />Resumo da IA</>
                        )}
                      </Button>
                      <button
                        onClick={handleClearChatLearning}
                        className="ml-auto flex items-center gap-1 text-[10px] text-slate-600 hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" /> Limpar
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Presentes */}
              <div className="rounded-xl border border-white/8 bg-[#0a0b0d] p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Gift className="h-3.5 w-3.5 text-pink-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Presentes</span>
                  <span className="ml-auto font-mono text-[10px] text-slate-500">{giftStats.length} tipos</span>
                </div>

                {giftStats.length === 0 ? (
                  <p className="text-[11px] text-slate-600">
                    Nenhum presente registrado ainda. Presentes novos são aprendidos automaticamente.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {giftStats.slice(0, 30).map((g) => (
                      <div key={g.key} className="flex items-center gap-2 text-[11px]">
                        <span className="truncate text-slate-300">{g.name}</span>
                        {g.learned && (
                          <span className="shrink-0 rounded bg-violet-500/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-violet-300">
                            novo
                          </span>
                        )}
                        {g.reactionVideoLabel && (
                          <span className="shrink-0 truncate text-[9px] text-slate-600">→ {g.reactionVideoLabel}</span>
                        )}
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-pink-300">
                          {g.count}x{g.totalQty > g.count ? ` · ${g.totalQty}un` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {giftStats.length > 0 && (
                  <button
                    onClick={handleClearGiftLearning}
                    className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" /> Limpar
                  </button>
                )}
              </div>
            </div>
          </SectionCard>

          {/* ── Reações por vídeo (pré-definições) ─────────────────────────── */}
          <SectionCard icon={<Film className="h-4 w-4" />} title="Reações por vídeo" className="lg:col-span-2">
            <p className="text-[11px] text-slate-500">
              Defina <strong>quando</strong> a Diretora pode usar cada vídeo: a que eventos/intenções ele
              responde, prioridade e um descanso (cooldown) para não repetir. Marque <strong>AUTO</strong>
              para liberar a escolha automática. Essas regras entram na decisão da IA.
            </p>

            {videos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/8 p-5 text-center text-[11px] text-slate-600">
                Nenhum vídeo na biblioteca ainda. Adicione vídeos na aba Biblioteca.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[28rem] overflow-y-auto pr-1">
                {videos.map((v) => {
                  const preset = videoPresets[v.id];
                  const enabled = preset?.enabled ?? false;
                  const cd = videoCooldownRemaining(v.id);
                  const isEditing = editingVideoId === v.id;
                  return (
                    <div key={v.id} className="rounded-xl border border-white/8 bg-[#0a0b0d] p-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleVideoAuto(v.id)}
                          className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide transition',
                            enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700/40 text-slate-500',
                          )}
                          title={enabled ? 'Escolha automática ligada' : 'Escolha automática desligada'}
                        >
                          {enabled ? 'Auto' : 'Off'}
                        </button>
                        <span className="truncate text-[11px] text-slate-300">{videoDisplayName(v)}</span>
                        {enabled && preset && (
                          <span className="shrink-0 font-mono text-[9px] text-slate-600">
                            {preset.eventKinds.length ? preset.eventKinds.join(',') : 'qualquer'} · P{preset.priority}
                          </span>
                        )}
                        {cd > 0 && (
                          <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-amber-400">
                            <Clock className="h-2.5 w-2.5" />{cd}s
                          </span>
                        )}
                        {!isEditing && (
                          <button
                            onClick={() => openPresetEditor(v.id)}
                            className="ml-auto shrink-0 text-[10px] text-slate-500 hover:text-violet-300"
                          >
                            Editar
                          </button>
                        )}
                      </div>

                      {isEditing && draftPreset && (
                        <div className="mt-2.5 space-y-2.5 border-t border-white/8 pt-2.5">
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Responde a eventos</span>
                            <div className="flex flex-wrap gap-1">
                              {EVENT_KIND_OPTIONS.map(([key, label]) => (
                                <button
                                  key={key}
                                  onClick={() => toggleDraftArray('eventKinds', key)}
                                  className={cn(
                                    'rounded px-2 py-0.5 text-[10px] transition',
                                    draftPreset.eventKinds.includes(key)
                                      ? 'bg-violet-500/15 text-violet-300 border border-violet-500/40'
                                      : 'bg-slate-800/40 text-slate-500 border border-transparent hover:text-slate-300',
                                  )}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Intenções</span>
                            <div className="flex flex-wrap gap-1">
                              {INTENT_OPTIONS.map((intent) => (
                                <button
                                  key={intent}
                                  onClick={() => toggleDraftArray('intents', intent)}
                                  className={cn(
                                    'rounded px-2 py-0.5 text-[10px] transition',
                                    draftPreset.intents.includes(intent)
                                      ? 'bg-violet-500/15 text-violet-300 border border-violet-500/40'
                                      : 'bg-slate-800/40 text-slate-500 border border-transparent hover:text-slate-300',
                                  )}
                                >
                                  {INTENT_LABELS[intent]}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Prioridade</span>
                                <span className="font-mono text-[10px] text-violet-300">{draftPreset.priority}</span>
                              </div>
                              <input
                                type="range"
                                min={1}
                                max={10}
                                step={1}
                                value={draftPreset.priority}
                                onChange={(e) => setDraftPreset((d) => (d ? { ...d, priority: Number(e.target.value) } : d))}
                                className="w-full accent-violet-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Cooldown (s)</span>
                              <input
                                type="number"
                                min={0}
                                max={600}
                                value={draftPreset.cooldownSec}
                                onChange={(e) => setDraftPreset((d) => (d ? { ...d, cooldownSec: Number(e.target.value) || 0 } : d))}
                                className="w-full rounded-lg border border-white/8 bg-[#07080a] px-2 py-1 text-[11px] text-slate-300 focus:border-violet-500/40 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">Quando usar (instrução livre)</span>
                            <input
                              type="text"
                              value={draftPreset.notes}
                              onChange={(e) => setDraftPreset((d) => (d ? { ...d, notes: e.target.value } : d))}
                              placeholder="ex: usar quando falarem de amor, ou agradecer presentes grandes"
                              className="w-full rounded-lg border border-white/8 bg-[#07080a] px-2 py-1 text-[11px] text-slate-300 focus:border-violet-500/40 focus:outline-none"
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <Button variant="primary" size="sm" onClick={savePresetDraft}>
                              <CheckCircle className="h-3.5 w-3.5 mr-1" />Salvar
                            </Button>
                            <button
                              onClick={() => { setEditingVideoId(null); setDraftPreset(null); }}
                              className="text-[10px] text-slate-500 hover:text-slate-300"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* ── 2. Chave da API ───────────────────────────────────────────── */}
          <SectionCard icon={<Key className="h-4 w-4" />} title="Chave da API (Gemini)">
            <p className="text-[11px] text-slate-500">
              Salva <strong>só no seu browser</strong> — nunca é enviada ao servidor.
              Obtenha em{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-400 hover:underline"
              >
                aistudio.google.com
              </a>
            </p>

            {storedKey && (
              <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-3 py-2">
                <span className="font-mono text-[11px] text-emerald-300">
                  {showKey ? storedKey : maskKey(storedKey)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowKey((v) => !v)}
                    className="text-slate-500 hover:text-slate-300"
                    title={showKey ? 'Ocultar' : 'Mostrar'}
                  >
                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={handleClearKey}
                    className="text-red-500/70 hover:text-red-400 text-[10px] font-semibold uppercase tracking-wide"
                  >
                    Limpar
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                label=""
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && keyInput.trim() && handleSaveKey()}
                placeholder={storedKey ? 'Substituir chave…' : 'Cole a chave aqui (AIzaSy…)'}
                type="password"
                className="flex-1 font-mono text-xs"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveKey}
                disabled={!keyInput.trim()}
                className="shrink-0"
              >
                {keySaved ? <><CheckCircle className="h-3.5 w-3.5 mr-1" />Salvo!</> : 'Salvar'}
              </Button>
            </div>
          </SectionCard>

          {/* ── 4. Parâmetros ─────────────────────────────────────────────── */}
          <SectionCard icon={<Sliders className="h-4 w-4" />} title="Parâmetros">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400">Confiança mínima para tocar vídeo</span>
                <span className="font-mono text-sm font-bold text-violet-300">{Math.round(threshold * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.3}
                max={0.95}
                step={0.05}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
              <div className="flex justify-between text-[9px] text-slate-600">
                <span>30% — permissivo</span>
                <span>95% — restritivo</span>
              </div>
              <p className="rounded-lg bg-slate-800/40 px-3 py-2 text-[11px] text-slate-400">
                {thresholdLabel(threshold)}
              </p>
              <p className="text-[10px] text-slate-600">
                Abaixo deste valor: ação <code className="text-slate-400">queue_video</code> em vez de <code className="text-slate-400">play_video</code>.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveThreshold}
              className="w-full"
            >
              {thresholdSaved ? <><CheckCircle className="h-3.5 w-3.5 mr-1" />Salvo!</> : 'Salvar parâmetros'}
            </Button>
          </SectionCard>

          {/* ── 3. Personalidade ──────────────────────────────────────────── */}
          <SectionCard icon={<Brain className="h-4 w-4" />} title="Personalidade (System Prompt)" className="lg:col-span-2">
            {/* Provider selector */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-500 shrink-0">Provedor:</span>
              {(['auto', 'gemini', 'mock'] as AiProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={cn(
                    'rounded-lg border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition',
                    provider === p
                      ? 'border-violet-500/50 bg-violet-500/15 text-violet-300'
                      : 'border-white/8 bg-transparent text-slate-500 hover:text-slate-300',
                  )}
                >
                  {p === 'auto' ? 'Auto (recomendado)' : p === 'gemini' ? 'Gemini' : 'Mock / Simulado'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-600">
              {provider === 'auto' && 'Usa Gemini se a chave estiver disponível; cai para Mock se não.'}
              {provider === 'gemini' && 'Força chamadas ao Gemini. Se a chave falhar, retorna erro (não usa Mock).'}
              {provider === 'mock' && 'Sempre usa simulação local. Nenhuma chamada à API é feita.'}
            </p>

            {/* Prompt textarea */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">System prompt enviado à IA a cada decisão</span>
                <button
                  onClick={handleResetPrompt}
                  className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400"
                  title="Restaurar prompt padrão"
                >
                  <RotateCcw className="h-3 w-3" />
                  Restaurar padrão
                </button>
              </div>
              <textarea
                value={promptDraft || AI_SYSTEM_PROMPT_DEFAULT}
                onChange={(e) => setPromptDraft(e.target.value === AI_SYSTEM_PROMPT_DEFAULT ? '' : e.target.value)}
                rows={12}
                className={cn(
                  'w-full rounded-xl border bg-[#0a0b0d] p-3 font-mono text-[11px] text-slate-300 leading-relaxed resize-y focus:outline-none focus:border-violet-500/40 transition',
                  promptDraft ? 'border-violet-500/30' : 'border-white/8',
                )}
                placeholder={AI_SYSTEM_PROMPT_DEFAULT}
                spellCheck={false}
              />
              {promptDraft && (
                <p className="text-[10px] text-violet-400">
                  ✏️ Prompt customizado ativo — diferente do padrão.
                </p>
              )}
            </div>

            <Button
              variant="primary"
              size="sm"
              onClick={handleSavePersonality}
              className="w-full"
            >
              {personalitySaved ? <><CheckCircle className="h-3.5 w-3.5 mr-1" />Salvo!</> : 'Salvar personalidade'}
            </Button>
          </SectionCard>

          {/* ── 5. Teste manual ───────────────────────────────────────────── */}
          <SectionCard icon={<FlaskConical className="h-4 w-4" />} title="Teste manual" className="lg:col-span-2">
            <p className="text-[11px] text-slate-500">
              Digite uma mensagem como se fosse do chat ao vivo. A IA decide como reagir — você vê o resultado aqui antes de ir ao ar.
            </p>

            <div className="flex gap-2">
              <Input
                label=""
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !testRunning && void handleRunTest()}
                placeholder="Ex: oi linda, mandei uma rosa, quanto custa a live…"
                className="flex-1"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleRunTest()}
                disabled={testRunning || !testInput.trim()}
                className="shrink-0"
              >
                {testRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Testar'}
              </Button>
            </div>

            {(testDecision || testRunning) && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                    Resultado da IA
                  </p>
                  <AiDecisionPanel
                    decision={testRunning ? null : testDecision}
                    className="h-full"
                  />
                </div>
                {testPrompt && (
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                      Contexto enviado à IA
                    </p>
                    <pre className="rounded-xl border border-white/8 bg-[#0a0b0d] p-3 font-mono text-[10px] text-slate-400 whitespace-pre-wrap overflow-y-auto max-h-64">
                      {testPrompt}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Empty state */}
            {!testDecision && !testRunning && (
              <div className="rounded-xl border border-dashed border-white/8 p-6 text-center text-[11px] text-slate-600">
                O resultado aparece aqui após o teste.
              </div>
            )}
          </SectionCard>

        </div>
      </div>
    </div>
  );
}
