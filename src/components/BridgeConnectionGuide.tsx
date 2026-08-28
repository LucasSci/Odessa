/**
 * BridgeConnectionGuide — Diagnóstico e guia de resolução da bridge.
 *
 * Mostra claramente:
 * 1. O que está funcionando e o que não está (diagnóstico em tempo real)
 * 2. Por que a bridge não conecta no ambiente atual
 * 3. Passos exatos para resolver (rodar localmente vs preview)
 * 4. Alternativa: usar o Painel Unificado sem bridge
 *
 * Resolve a queixa do usuário: "sem uma definição clara de como resolver
 * o problema" — agora há um diagnóstico visual com o caminho exato.
 */

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Lightbulb,
  Monitor,
  Radio,
  Terminal,
  XCircle,
} from 'lucide-react';
import { Badge, Button } from './ui';
import { cn } from '../lib/utils';

export interface BridgeConnectionGuideProps {
  /** Chrome com debug ativo na porta 9222? */
  chromeRunning: boolean;
  /** Processo da bridge (tango_chat.py) rodando? */
  processRunning: boolean;
  /** Bridge conectada à aba do Tango? */
  bridgeConnected: boolean;
  /** Bridge alcançável (processo rodando mas não conectou à aba)? */
  bridgeReachable: boolean;
  /** Navegar para o Painel Unificado */
  onGoUnified: () => void;
  /** Iniciar a bridge */
  onStartBridge: () => void;
  /** Abrir Chrome com debug */
  onLaunchChrome: () => void;
  starting: boolean;
  launching: boolean;
}

function isCloudPreview(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '0.0.0.0';
}

export function BridgeConnectionGuide({
  chromeRunning,
  processRunning,
  bridgeConnected,
  bridgeReachable,
  onGoUnified,
  onStartBridge,
  onLaunchChrome,
  starting,
  launching,
}: BridgeConnectionGuideProps) {
  const isCloud = isCloudPreview();

  const steps = [
    {
      ok: true, // Backend sempre está no ar neste ponto
      label: 'Backend Odessa (API)',
      detail: 'Servidor rodando e respondendo',
    },
    {
      ok: chromeRunning,
      label: 'Chrome com depuração (porta 9222)',
      detail: chromeRunning
        ? 'Chrome detectado com CDP ativo'
        : isCloud
          ? 'Impossível no preview — não há Chrome no container'
          : 'Abra o Chrome com --remote-debugging-port=9222',
    },
    {
      ok: processRunning,
      label: 'Processo da bridge (tango_chat.py)',
      detail: processRunning
        ? `Bridge rodando (PID ativo)`
        : isCloud
          ? 'Playwright não instalado no container'
          : 'Clique em "Iniciar Bridge" após abrir o Chrome',
    },
    {
      ok: bridgeConnected,
      label: 'Conexão à aba do Tango',
      detail: bridgeConnected
        ? 'Acoplado à aba da transmissão'
        : bridgeReachable
          ? 'Bridge rodando mas não encontrou a aba do Tango'
          : 'Aguardando os passos acima',
    },
  ];

  const allOk = steps.every((s) => s.ok);

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-[#0c0e12] p-5 shadow-lg">
      {/* ── Cabeçalho ── */}
      <div className="flex items-center gap-3 border-b border-white/8 pb-4">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
            allOk
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
              : 'bg-amber-500/10 text-amber-300 border-amber-500/20',
          )}
        >
          {allOk ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">Diagnóstico da Conexão com o Tango</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {allOk
              ? 'Tudo conectado! A bridge está acoplada à aba da live.'
              : isCloud
                ? 'A bridge não funciona no preview — veja como resolver abaixo'
                : 'Alguns componentes não estão prontos — siga os passos abaixo'}
          </p>
        </div>
      </div>

      {/* ── Checklist de diagnóstico ── */}
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div
            key={i}
            className={cn(
              'flex items-start gap-3 rounded-xl border p-3 transition',
              step.ok
                ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                : 'border-white/8 bg-white/[0.02]',
            )}
          >
            <div className="mt-0.5 shrink-0">
              {step.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-slate-600" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className={cn('text-xs font-semibold', step.ok ? 'text-emerald-300' : 'text-slate-300')}>
                {step.label}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Aviso: ambiente cloud/preview ── */}
      {isCloud && !allOk && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
          <div className="flex items-start gap-2">
            <Lightbulb className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
            <div className="space-y-2">
              <p className="text-xs font-semibold text-amber-200">
                Você está no preview (nuvem) — a bridge não funciona aqui
              </p>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                A bridge precisa do <strong>Google Chrome</strong> rodando com depuração na
                <strong> mesma máquina</strong> onde o backend está. No preview, o backend roda num
                container Linux <strong>sem Chrome e sem Playwright</strong>.
              </p>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Para usar a bridge, rode o Odessa <strong>localmente na sua máquina</strong> (Windows)
                onde o Chrome já está instalado e você tem login no Tango.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Guia passo a passo (local) ── */}
      {!isCloud && !allOk && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-sky-400" />
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-300">
              Como resolver — passo a passo
            </h4>
          </div>

          <div className="space-y-2">
            {/* Passo 1 */}
            <div className="flex items-start gap-3 rounded-xl border border-white/8 bg-black/30 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-xs font-bold text-sky-300">
                1
              </span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-200">
                  Instale as dependências da bridge
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  No terminal, na pasta do projeto:
                </p>
                <code className="mt-1.5 block rounded-lg bg-black/50 px-3 py-1.5 text-[11px] font-mono text-emerald-300">
                  pip install -r tango_chat/requirements.txt
                </code>
                <code className="mt-1 block rounded-lg bg-black/50 px-3 py-1.5 text-[11px] font-mono text-emerald-300">
                  python -m playwright install chromium
                </code>
              </div>
            </div>

            {/* Passo 2 */}
            <div className="flex items-start gap-3 rounded-xl border border-white/8 bg-black/30 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-xs font-bold text-sky-300">
                2
              </span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-200">
                  Abra o Chrome com depuração ativa
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Clique no botão abaixo — ele abre o Chrome na porta 9222 já na página do Tango:
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  className="mt-2"
                  disabled={launching || chromeRunning}
                  onClick={onLaunchChrome}
                >
                  {launching ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Abrindo Chrome...
                    </>
                  ) : chromeRunning ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Chrome detectado!
                    </>
                  ) : (
                    <>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir Chrome da Live
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Passo 3 */}
            <div className="flex items-start gap-3 rounded-xl border border-white/8 bg-black/30 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-xs font-bold text-sky-300">
                3
              </span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-200">
                  Inicie a bridge e acople à aba
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Inicie o processo da bridge e depois acople à aba do Tango:
                </p>
                <div className="mt-2 flex gap-2">
                  {!processRunning ? (
                    <Button
                      size="sm"
                      variant="primary"
                      className="bg-emerald-600 hover:bg-emerald-500"
                      disabled={starting || !chromeRunning}
                      onClick={onStartBridge}
                    >
                      {starting ? 'Iniciando...' : 'Iniciar Bridge'}
                    </Button>
                  ) : !bridgeConnected ? (
                    <Button
                      size="sm"
                      variant="primary"
                      className="bg-emerald-600 hover:bg-emerald-500"
                      disabled={!bridgeReachable}
                      onClick={onStartBridge}
                    >
                      Acoplar à aba
                    </Button>
                  ) : (
                    <Badge variant="success" className="text-xs">
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Conectado!
                    </Badge>
                  )}
                </div>
                {!chromeRunning && (
                  <p className="text-[10px] text-amber-400 mt-1.5">
                    ⚠️ Abra o Chrome primeiro (passo 2)
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Alternativa: Painel Unificado sem bridge ── */}
      {!bridgeConnected && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
          <div className="flex items-start gap-2">
            <Monitor className="h-4 w-4 shrink-0 text-violet-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-violet-200">
                Alternativa: Painel Unificado sem bridge
              </p>
              <p className="text-[11px] text-slate-300 leading-relaxed mt-1">
                Não quer configurar a bridge agora? O <strong>Painel Unificado</strong> funciona
                sem Chrome/CDP — ele usa o runtime do Odessa para gerenciar a live, capturar o chat
                via OCR ou entrada manual, e a IA responde no chat.
              </p>
              <Button
                size="sm"
                variant="primary"
                className="mt-2.5 bg-violet-600 hover:bg-violet-500"
                onClick={onGoUnified}
              >
                <ArrowRight className="h-3.5 w-3.5" />
                Ir para o Painel Unificado
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Status conectado ── */}
      {allOk && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <Radio className="h-5 w-5 text-emerald-400" />
          <div>
            <p className="text-xs font-bold text-emerald-300">Bridge conectada à live!</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              O chat está sendo monitorado. A IA pode responder automaticamente.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
