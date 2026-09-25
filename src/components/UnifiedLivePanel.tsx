/**
 * UnifiedLivePanel — Painel interativo unificado para gerenciar a live e o chat.
 *
 * Funciona SEM a bridge (Chrome/CDP), usando o runtime do Odessa:
 * - Barra de controles da live (iniciar/pausar, status automação, status vídeo)
 * - Tela da live em tempo real (esquerda) — LiveVisionMonitor + estado do vídeo
 * - Chat capturado + respostas da IA (direita) — feed + fila de respostas
 * - Configuração da IA (rodapé) — personalidade, regras e modelo
 *
 * Quando a bridge ESTÁ conectada, o TangoChatPanel usa o LiveVisionMonitor
 * em vez deste componente (modo CDP screencast interativo).
 *
 * Este é o ambiente que permite à IA interagir com o chat: as mensagens
 * capturadas (via OCR, manual, ou bridge) aparecem no feed, e a IA gera
 * respostas que podem ser aprovadas ou enviadas automaticamente.
 */

import { useMemo, useState } from 'react';
import {
  Brain,
  Check,
  Loader2,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { Badge, Button } from './ui';
import { cn } from '../lib/utils';
import { TangoChatFeed } from './TangoChatFeed';
import { LiveVisionMonitor } from './LiveVisionMonitor';
import { AiConfigPanel } from './AiConfigPanel';
import { VideoGenPanel } from './VideoGenPanel';
import { useTangoChatSession } from '../core/tangoChatSession';
import type { TangoChatMessage } from '../core/tangoAiChatService';
import type { AutopilotRuntimeState } from '../core/useAutopilotRuntime';
import type { CapturedMessage } from '../types';
import type { TangoReplyItem } from './TangoChatPanel';
import { MemoriesUsed, ReplyCardFrame, ReplyStatusBadge } from './ReplyStatus';

export type VideoStateLite = {
  current_video_id?: string;
  state?: string;
  currentClip?: { label?: string; videoId?: string } | null;
  queue_len?: number;
  activeNodeId?: string | null;
};

export interface UnifiedLivePanelProps {
  // ── Odessa runtime ──
  capturedText: CapturedMessage[];
  runtime: AutopilotRuntimeState;
  videoState: VideoStateLite | null;
  bridgeConnected: boolean;

  // ── Chat state & callbacks (gerenciados pelo TangoChatPanel) ──
  messages: TangoChatMessage[];
  replyQueue: TangoReplyItem[];
  generatingForId: string | null;
  cooldownRemaining: number;
  cannedResponses: string[];
  generatingProactive: boolean;
  draftText: string;
  sending: boolean;
  onGenerateReply: (msg: TangoChatMessage) => void;
  onPickCanned: (text: string) => void;
  onGenerateProactive: () => void;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  onApproveReply: (item: TangoReplyItem) => void;
  onDiscardReply: (id: string) => void;
  onViewReplies: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  chatCompact?: boolean;
  onToggleChatCompact?: () => void;
}

// ── Component ──

export function UnifiedLivePanel({
  runtime,
  videoState,
  bridgeConnected,
  messages,
  replyQueue,
  generatingForId,
  cooldownRemaining,
  cannedResponses,
  generatingProactive,
  draftText,
  sending,
  onGenerateReply,
  onPickCanned,
  onGenerateProactive,
  onDraftChange,
  onSend,
  onApproveReply,
  onDiscardReply,
  onViewReplies,
  messagesEndRef,
  chatCompact = false,
  onToggleChatCompact,
}: UnifiedLivePanelProps) {
  const isLive = runtime.autopilotEnabled;
  // Área 4: fila de autoconfigurações da persona pendentes de aprovação —
  // vem do contexto (o provider já embrulha o app inteiro), não como prop,
  // já que é ortogonal ao fluxo de chat que este painel já recebe por props.
  const { pendingSelfConfig, approveSelfConfig, rejectSelfConfig } = useTangoChatSession();
  const [selfConfigExpanded, setSelfConfigExpanded] = useState(false);

  // O painel ao vivo mostra apenas mensagens recebidas pela bridge nesta sessão.
  // OCR e eventos de teste pertencem ao runtime, não ao chat do Tango.
  const unifiedMessages = useMemo<TangoChatMessage[]>(() => {
    return messages;
  }, [messages]);

  // Fila que pede atenção: aguardando aprovação, bloqueadas e falhas de envio.
  const pendingReplies = useMemo(
    () => replyQueue.filter((r) => r.status === 'draft' || r.status === 'blocked' || r.status === 'failed'),
    [replyQueue],
  );

  return (
    <div className="space-y-4">
      {/* ── Grid: Palco (esquerda) + Chat (direita) ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* ── Palco: Tela da Live + Decisão da IA ── */}
        <div className="xl:col-span-3 space-y-4">
          {/* Tela da live em tempo real (ou overlay desconectado) */}
          <LiveVisionMonitor connected={bridgeConnected} />

          {/* Barra compacta de estado do vídeo */}
          <div className="flex items-center gap-4 px-1 text-xs">
            <span className="text-slate-500">Vídeo: <span className="text-slate-200 font-semibold">{videoState?.currentClip?.label || videoState?.current_video_id || '—'}</span></span>
            <span className="text-slate-500">Fila: <span className="text-slate-200 font-semibold">{videoState?.queue_len ?? 0}</span></span>
            <span className="text-slate-500">Ciclos: <span className="text-slate-200 font-semibold">{runtime.completedCycles}</span></span>
            {pendingSelfConfig.length > 0 && (
              <button
                type="button"
                onClick={() => setSelfConfigExpanded((v) => !v)}
                title="A persona propôs mudanças em si mesma — revise antes de aplicar"
                className="ml-auto flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-400/20"
              >
                <Wand2 className="h-3 w-3" /> {pendingSelfConfig.length} autoconfig{pendingSelfConfig.length > 1 ? 's' : ''} pendente{pendingSelfConfig.length > 1 ? 's' : ''}
              </button>
            )}
          </div>

          {/* Fila de autoconfigurações pendentes (Área 4) */}
          {pendingSelfConfig.length > 0 && selfConfigExpanded && (
            <div className="space-y-2 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-3">
              {pendingSelfConfig.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl bg-black/20 p-2.5">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">
                      {item.source === 'evolution' ? 'Evolução automática' : 'Proposta pela conversa'}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-200">{item.summary}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => void approveSelfConfig(item.id)}
                      title="Aceitar"
                      className="rounded-lg bg-emerald-500 p-1.5 text-black hover:bg-emerald-400"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectSelfConfig(item.id)}
                      title="Rejeitar"
                      className="rounded-lg border border-white/15 p-1.5 text-slate-300 hover:bg-white/10"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Card da Decisão da IA (Diretora) */}
          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-5 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-sky-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">Decisão da Diretora IA</h3>
              </div>
              {runtime.isProcessing && (
                <span className="flex items-center gap-1 text-[11px] text-sky-300">
                  <Loader2 className="h-3 w-3 animate-spin" /> Processando...
                </span>
              )}
            </div>

            {runtime.latestDecision ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="lavender" className="text-[10px]">
                    {runtime.latestDecision.intent}
                  </Badge>
                  <Badge variant="default" className="text-[10px]">
                    {Math.round(runtime.latestDecision.confidence * 100)}% confiança
                  </Badge>
                  <span className={cn('text-[10px] font-bold uppercase', runtime.latestDecision.priority === 'urgent' ? 'text-red-400' : runtime.latestDecision.priority === 'high' ? 'text-amber-400' : 'text-slate-500')}>
                    {runtime.latestDecision.priority}
                  </span>
                </div>
                <p className="text-sm text-slate-200 leading-relaxed">
                  {runtime.latestDecision.speech}
                </p>
                {runtime.latestDecision.actions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {runtime.latestDecision.actions.map((action, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-mono rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-slate-400"
                      >
                        {action.type}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Brain className="h-8 w-8 text-slate-700 mb-2" />
                <p className="text-xs text-slate-500">
                  {isLive ? 'Aguardando primeiro evento...' : 'Inicie a live para ver as decisões da IA'}
                </p>
              </div>
            )}
          </div>

          {/* Pipeline de geração de vídeo em tempo real */}
          <VideoGenPanel />
        </div>

        {/* ── Chat + Fila de Respostas IA ── */}
        <div className="xl:col-span-2 space-y-4">
          <TangoChatFeed
            messages={unifiedMessages}
            bridgeConnected={true}
            cooldownRemaining={cooldownRemaining}
            generatingForId={generatingForId}
            onGenerateReply={onGenerateReply}
            cannedResponses={cannedResponses}
            onPickCanned={onPickCanned}
            generatingProactive={generatingProactive}
            onGenerateProactive={onGenerateProactive}
            draftText={draftText}
            onDraftChange={onDraftChange}
            onSend={onSend}
            sending={sending}
            messagesEndRef={messagesEndRef}
            replyQueueCount={pendingReplies.length}
            onViewReplies={onViewReplies}
            heightClass="h-full min-h-[400px]"
            compact={chatCompact}
            onToggleCompact={onToggleChatCompact}
          />

          {/* Fila de Respostas IA (compacta) */}
          {pendingReplies.length > 0 && (
            <div className="rounded-2xl border border-sky-500/20 bg-[#0c0e12] p-4 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-sky-400" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">
                    Respostas IA ({pendingReplies.length})
                  </h3>
                </div>
                <button
                  className="text-[11px] font-semibold text-sky-300 hover:text-sky-200"
                  onClick={onViewReplies}
                >
                  Ver tudo →
                </button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {pendingReplies.slice(0, 5).map((item) => (
                  <ReplyCardFrame key={item.id} status={item.status}>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-bold text-sky-300 truncate">
                        @{item.sourceMessage.username}
                      </span>
                      <ReplyStatusBadge status={item.status} confirmed={item.confirmed} />
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed mb-2">{item.text}</p>
                    {item.blockedReason && (
                      <p className="text-[10px] text-red-400 mb-2">{item.blockedReason}</p>
                    )}
                    <div className="mb-2">
                      <MemoriesUsed items={item.memoriesUsed} />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        className="h-7 px-2.5 text-[11px]"
                        disabled={item.status === 'blocked'}
                        onClick={() => onApproveReply(item)}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        {item.status === 'failed' ? 'Tentar de novo' : 'Aprovar'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() => onDiscardReply(item.id)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Descartar
                      </Button>
                    </div>
                  </ReplyCardFrame>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Configuração da IA ── */}
      <AiConfigPanel />
    </div>
  );
}
