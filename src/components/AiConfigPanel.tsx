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

import { useState, useCallback, useRef } from 'react';
import { Brain, Zap, Key, Sliders, FlaskConical, CheckCircle, XCircle, AlertCircle, Loader2, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button, Input } from './ui';
import { AiDecisionPanel } from './AiDecisionPanel';
import {
  getAiConfig,
  saveAiConfig,
  getEffectiveGeminiKey,
  hasActiveGeminiKey,
  AI_SYSTEM_PROMPT_DEFAULT,
  type AiProvider,
} from '../core/aiConfig';
import {
  callAiDecision,
  callGeminiDirect,
  buildAiUserMessage,
  EMPTY_AI_DECISION,
  type AiDecision,
} from '../core/aiDecisionContract';
import { buildOcrEvent } from '../core/ocrEventContract';
import type { OcrEvent } from '../core/ocrEventContract';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AiConfigPanelProps {
  videos: Array<{ id: string; label?: string; name?: string }>;
  triggers: Array<{ id: string; name?: string; label?: string; enabled?: boolean }>;
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

export function AiConfigPanel({ videos, triggers }: AiConfigPanelProps) {
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

  // ── Derived ────────────────────────────────────────────────────────────────
  const [currentProvider, setCurrentProvider] = useState<AiProvider>(cfg.provider);
  const statusInfo = deriveStatusInfo(currentProvider);
  const storedKey = cfg.geminiKey;

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
