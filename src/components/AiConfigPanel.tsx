/**
 * AiConfigPanel — Configuração da inteligência da IA para respostas de chat.
 *
 * Três seções:
 * 1. Personalidade e Prompt — prompt de sistema customizável
 * 2. Regras de Resposta — cooldown, limite por minuto, confiança mínima
 * 3. Modelo e API Keys — provedor, chave Gemini, proxy URL
 *
 * Persiste em localStorage via aiConfig.
 */

import { useState } from 'react';
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  Cpu,
  ExternalLink,
  Key,
  RotateCcw,
  Sliders,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Button, Input } from './ui';
import { cn } from '../lib/utils';
import {
  getAiConfig,
  saveAiConfig,
  type AiLocalConfig,
  type AiProvider,
} from '../core/aiConfig';
import { callGeminiText } from '../core/aiDecisionContract';
import { apiUrl } from '../lib/api';
import { ActiveAiBadge } from './ActiveAiBadge';

/** Trocou para IA de nuvem: tira o modelo local da memória (libera RAM/GPU). */
async function unloadLocalAi(): Promise<string[]> {
  try {
    const res = await fetch(apiUrl('/ai/ollama/unload'), { method: 'POST', signal: AbortSignal.timeout(15_000) });
    const data = (await res.json()) as { unloaded?: string[] };
    return data.unloaded ?? [];
  } catch {
    return [];
  }
}

/** Quem responde o chat — só as opções reais (Auto/Mock saíram: confundiam). */
const PROVIDER_OPTIONS: Array<{ id: AiProvider; title: string; detail: string }> = [
  { id: 'local', title: 'Local (no seu PC)', detail: 'Ollama. Grátis e offline; qualidade limitada pelo modelo pequeno.' },
  { id: 'gemini', title: 'Google Gemini', detail: 'Ótimo português. Precisa de chave do Google AI Studio.' },
  { id: 'mistral', title: 'Mistral', detail: 'Ótimo português, conversa em turnos. Precisa de chave da Mistral.' },
  { id: 'claude', title: 'Claude (Anthropic)', detail: 'Chave configurada no servidor (.env).' },
];

type GeminiTest = { state: 'idle' | 'testing' | 'ok' | 'error'; message?: string };

/** Testa a chave da Mistral pelo mesmo caminho do chat (/ai/respond, sem cair na IA local). */
async function testMistralKey(key: string): Promise<string> {
  const started = performance.now();
  const res = await fetch(apiUrl('/ai/respond'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      persona_prompt: 'Responda apenas com a palavra: ok',
      chat_context: '',
      user_prompt: 'teste de conexão',
      temperature: 0,
      provider: 'mistral',
      provider_key: key,
    }),
    signal: AbortSignal.timeout(40_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    provider?: string;
    detail?: { errors?: string[] } | string;
  };
  if (!res.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : body.detail?.errors?.find((e) => e.startsWith('Mistral')) ?? `HTTP ${res.status}`;
    throw new Error(detail);
  }
  if (body.provider !== 'mistral') throw new Error('A Mistral não respondeu (o servidor usou outro provedor).');
  return `Conectado à Mistral (${Math.round(performance.now() - started)} ms).`;
}

export function AiConfigPanel() {
  const [config, setConfig] = useState<AiLocalConfig>(() => getAiConfig());
  const [expanded, setExpanded] = useState(true);
  const [savedFlash, setSavedFlash] = useState(false);
  const [geminiTest, setGeminiTest] = useState<GeminiTest>({ state: 'idle' });
  const [switchNote, setSwitchNote] = useState<string | null>(null);

  const chooseProvider = (next: AiProvider) => {
    if (next === config.provider) return;
    update({ provider: next });
    setGeminiTest({ state: 'idle' });
    if (next === 'local') {
      setSwitchNote('IA local ligada: o modelo carrega na próxima resposta.');
      return;
    }
    setSwitchNote('Desligando a IA local…');
    void unloadLocalAi().then((unloaded) =>
      setSwitchNote(
        unloaded.length
          ? `IA local desligada (${unloaded.join(', ')} saiu da memória).`
          : 'IA local desligada: nenhum modelo local ficou na memória.',
      ),
    );
  };

  const testMistral = async () => {
    setGeminiTest({ state: 'testing' });
    try {
      setGeminiTest({ state: 'ok', message: await testMistralKey(config.mistralKey) });
    } catch (err) {
      setGeminiTest({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const testGemini = async () => {
    setGeminiTest({ state: 'testing' });
    const started = performance.now();
    try {
      const reply = await callGeminiText('Responda apenas com a palavra: ok', 'teste de conexão', { maxOutputTokens: 8 });
      if (!reply) throw new Error('Sem chave salva ou resposta vazia.');
      setGeminiTest({ state: 'ok', message: `Conectado ao Google (${Math.round(performance.now() - started)} ms).` });
    } catch (err) {
      setGeminiTest({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const update = (patch: Partial<AiLocalConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveAiConfig(patch);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1200);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-5 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-sky-400" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">
            Configuração da IA
          </h3>
          {savedFlash && (
            <span className="text-[10px] font-semibold text-emerald-400 animate-pulse">
              ✓ Salvo
            </span>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-slate-500 transition hover:text-slate-300"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-5">
          {/* ── 1. Personalidade e Prompt ── */}
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-sky-400" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Personalidade e Prompt
              </span>
            </div>
            <textarea
              value={config.systemPrompt}
              onChange={(e) => update({ systemPrompt: e.target.value })}
              placeholder="Deixe vazio para usar o prompt padrão da Odessa…"
              className="h-28 w-full resize-y rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-500/40 focus:outline-none"
            />
            <button
              onClick={() => update({ systemPrompt: '' })}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500 transition hover:text-sky-300"
            >
              <RotateCcw className="h-3 w-3" />
              Restaurar prompt padrão
            </button>
          </div>

          {/* ── 2. Regras de Resposta ── */}
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-sky-400" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Regras de Resposta
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Input
                label="Cooldown (seg)"
                type="number"
                value={Math.round(config.chatReplyCooldownMs / 1000)}
                onChange={(e) =>
                  update({ chatReplyCooldownMs: Math.max(3, Number(e.target.value)) * 1000 })
                }
                className="h-9 text-xs"
              />
              <Input
                label="Máx por minuto"
                type="number"
                value={config.chatReplyMaxPerMinute}
                onChange={(e) =>
                  update({ chatReplyMaxPerMinute: Math.max(1, Number(e.target.value)) })
                }
                className="h-9 text-xs"
              />
              <Input
                label="Confiança mín."
                type="number"
                step="0.05"
                min="0.1"
                max="0.99"
                value={config.chatReplyMinConfidence}
                onChange={(e) =>
                  update({ chatReplyMinConfidence: Number(e.target.value) })
                }
                className="h-9 text-xs"
              />
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={config.autoChatReplyEnabled}
                onChange={(e) => update({ autoChatReplyEnabled: e.target.checked })}
                className="h-4 w-4 accent-sky-500"
              />
              <span className="text-xs text-slate-300">
                Resposta automática no chat ativa
              </span>
            </label>
          </div>

          {/* ── 3. Modelo e API Keys ── */}
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Key className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Modelo e API Keys
              </span>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                    Quem responde o chat
                  </span>
                  <ActiveAiBadge />
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {PROVIDER_OPTIONS.map((opt) => {
                    const active = config.provider === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => chooseProvider(opt.id)}
                        className={cn(
                          'rounded-xl border p-3 text-left transition duration-150 ease-out active:scale-[0.98]',
                          active
                            ? 'border-sky-500/50 bg-sky-500/10'
                            : 'border-white/10 bg-black/40 hover:border-white/20',
                        )}
                      >
                        <span className={cn('block text-xs font-bold', active ? 'text-sky-200' : 'text-slate-300')}>
                          {opt.title}
                        </span>
                        <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">{opt.detail}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {switchNote && (
                <p key={switchNote} data-state="open" className="od-pop text-[11px] text-slate-400">
                  {switchNote}
                </p>
              )}

              {config.provider === 'gemini' && (
                <div data-state="open" className="od-pop space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
                  <Input
                    label="Chave da API do Google (Gemini)"
                    type="password"
                    autoComplete="off"
                    value={config.geminiKey}
                    onChange={(e) => {
                      update({ geminiKey: e.target.value.trim() });
                      setGeminiTest({ state: 'idle' });
                    }}
                    placeholder="Cole aqui a chave que começa com AIza…"
                    className="h-9 text-xs"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={geminiTest.state === 'testing'}
                      disabled={!config.geminiKey}
                      onClick={() => void testGemini()}
                    >
                      Testar conexão
                    </Button>
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[11px] text-sky-300 hover:underline"
                    >
                      Criar chave no Google AI Studio <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {geminiTest.state === 'ok' && (
                    <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {geminiTest.message} O chat já responde com a Gemini.
                    </p>
                  )}
                  {geminiTest.state === 'error' && (
                    <p className="flex items-start gap-1.5 text-[11px] text-red-300">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {geminiTest.message}
                    </p>
                  )}
                  {!config.geminiKey && (
                    <p className="text-[10px] leading-relaxed text-amber-300/90">
                      Sem chave, o chat continua respondendo com a IA local.
                    </p>
                  )}
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    A chave fica salva só neste navegador e vai ao Google pelo servidor do Odessa.
                  </p>
                  <details className="text-[11px] text-slate-400">
                    <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">Avançado</summary>
                    <div className="mt-2">
                      <Input
                        label="Proxy URL (opcional)"
                        value={config.geminiProxyUrl}
                        onChange={(e) => update({ geminiProxyUrl: e.target.value })}
                        placeholder="https://seu-worker.workers.dev"
                        className="h-9 text-xs"
                      />
                    </div>
                  </details>
                </div>
              )}

              {config.provider === 'mistral' && (
                <div data-state="open" className="od-pop space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
                  <Input
                    label="Chave da API da Mistral"
                    type="password"
                    autoComplete="off"
                    value={config.mistralKey}
                    onChange={(e) => {
                      update({ mistralKey: e.target.value.trim() });
                      setGeminiTest({ state: 'idle' });
                    }}
                    placeholder="Cole aqui a chave da Mistral…"
                    className="h-9 text-xs"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={geminiTest.state === 'testing'}
                      disabled={!config.mistralKey}
                      onClick={() => void testMistral()}
                    >
                      Testar conexão
                    </Button>
                    <a
                      href="https://console.mistral.ai/api-keys"
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[11px] text-sky-300 hover:underline"
                    >
                      Criar chave no console da Mistral <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {geminiTest.state === 'ok' && (
                    <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {geminiTest.message} O chat já responde com a Mistral.
                    </p>
                  )}
                  {geminiTest.state === 'error' && (
                    <p className="flex items-start gap-1.5 text-[11px] text-red-300">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {geminiTest.message}
                    </p>
                  )}
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    {config.mistralKey
                      ? 'Se a Mistral falhar (chave, cota), o chat cai para a IA local em vez de ficar sem resposta.'
                      : 'Sem chave, o chat continua respondendo com a IA local.'}{' '}
                    A chave fica salva só neste navegador.
                  </p>
                </div>
              )}

              {config.provider === 'claude' && (
                <p className="text-[10px] leading-relaxed text-slate-500">
                  A chave da Anthropic é configurada no servidor (arquivo .env, ANTHROPIC_API_KEY) — não
                  precisa colar nada aqui.
                </p>
              )}
            </div>
          </div>

          {/* ── 4. Modelo Local (Offline) ── */}
          {config.provider === 'local' && (
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Modelo Local (Offline)
                </span>
              </div>
              <div className="space-y-3">
                <Input
                  label="URL do servidor (Ollama, LM Studio, etc.)"
                  value={config.localModelUrl}
                  onChange={(e) => update({ localModelUrl: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="h-9 text-xs"
                />
                <Input
                  label="Nome do modelo"
                  value={config.localModelName}
                  onChange={(e) => update({ localModelName: e.target.value })}
                  placeholder="llama3, mistral, phi3…"
                  className="h-9 text-xs"
                />
                <Input
                  label="Temperatura (0–2)"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={config.localModelTemperature}
                  onChange={(e) => update({ localModelTemperature: Number(e.target.value) })}
                  className="h-9 text-xs"
                />
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Use um modelo local (Ollama, LM Studio, llama.cpp) em vez de APIs pagas.
                  O servidor precisa estar rodando e acessível na URL acima.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
