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
  ChevronDown,
  Key,
  RotateCcw,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { Input } from './ui';
import { cn } from '../lib/utils';
import {
  getAiConfig,
  saveAiConfig,
  type AiLocalConfig,
  type AiProvider,
} from '../core/aiConfig';

export function AiConfigPanel() {
  const [config, setConfig] = useState<AiLocalConfig>(() => getAiConfig());
  const [expanded, setExpanded] = useState(true);
  const [savedFlash, setSavedFlash] = useState(false);

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
          <Brain className="h-4 w-4 text-violet-400" />
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
              <Sparkles className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Personalidade e Prompt
              </span>
            </div>
            <textarea
              value={config.systemPrompt}
              onChange={(e) => update({ systemPrompt: e.target.value })}
              placeholder="Deixe vazio para usar o prompt padrão da Odessa…"
              className="h-28 w-full resize-y rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-slate-200 placeholder:text-slate-600 focus:border-violet-500/40 focus:outline-none"
            />
            <button
              onClick={() => update({ systemPrompt: '' })}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500 transition hover:text-violet-300"
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
                className="h-4 w-4 accent-violet-500"
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
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                  Provedor
                </span>
                <div className="flex gap-1.5">
                  {(['auto', 'gemini', 'local', 'mock'] as AiProvider[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => update({ provider: p })}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                        config.provider === p
                          ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                          : 'border-white/10 bg-black/40 text-slate-500 hover:text-slate-300',
                      )}
                    >
                      {p === 'auto' ? 'Auto' : p === 'gemini' ? 'Gemini' : p === 'local' ? 'Local' : 'Mock'}
                    </button>
                  ))}
                </div>
              </div>
              <Input
                label="Gemini API Key"
                type="password"
                value={config.geminiKey}
                onChange={(e) => update({ geminiKey: e.target.value })}
                placeholder="Cole sua chave Gemini aqui…"
                className="h-9 text-xs"
              />
              <Input
                label="Proxy URL (opcional)"
                value={config.geminiProxyUrl}
                onChange={(e) => update({ geminiProxyUrl: e.target.value })}
                placeholder="https://seu-worker.workers.dev"
                className="h-9 text-xs"
              />
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
