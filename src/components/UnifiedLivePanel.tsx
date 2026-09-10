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

import { useMemo } from 'react';
import {
  Brain,
  Check,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Badge, Button } from './ui';
import { cn } from '../lib/utils';
import { TangoChatFeed } from './TangoChatFeed';
import { LiveVisionMonitor } from './LiveVisionMonitor';
import { AiConfigPanel } from './AiConfigPanel';
import { VideoGenPanel } from './VideoGenPanel';
import type { TangoChatMessage } from '../core/tangoAiChatService';
import type { AutopilotRuntimeState } from '../core/useAutopilotRuntime';
import type { CapturedMessage } from '../types';
import type { AutonomyMode, ExecutionMode, TangoReplyItem } from './TangoChatPanel';

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
  onStartLive?: () => void | Promise<void>;
  bridgeConnected: boolean;

  // ── Chat state & callbacks (gerenciados pelo TangoChatPanel) ──
  messages: TangoChatMessage[];
  replyQueue: TangoReplyItem[];
  autonomyMode: AutonomyMode;
  executionMode: ExecutionMode;
  onSetAutonomy: (mode: AutonomyMode) => void;
  onSetExecution: (mode: ExecutionMode) => void;
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
  capturedText,
  runtime,
  videoState,
  onStartLive,
  bridgeConnected,
  messages,
  replyQueue,
  autonomyMode,
  executionMode,
  onSetAutonomy,
  onSetExecution,
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

  // ── Mensagens unificadas: usa mensagens da bridge se houver, senão converte capturedText ──
  // Quando a bridge NÃO está conectada, as mensagens da bridge estão vazias.
  // Precisamos mostrar as mensagens capturadas pelo runtime do Odessa (OCR, manual, etc.)
  // no formato TangoChatMessage para o TangoChatFeed exibi-las.
  const unifiedMessages = useMemo<TangoChatMessage[]>(() => {
    if (messages.length > 0) return messages; // bridge messages têm prioridade
    return (capturedText || [])
      .filter((m) => m.kind === 'chat' || m.kind === 'gift')
      .map((m) => ({
        username: (m.metadata?.username as string) || m.zoneName || 'Espectador',
        text: m.text,
        timestamp: m.createdAt,
      }));
  }, [messages, capturedText]);

  // Fila de respostas IA pendentes (draft + blocked)
  const pendingReplies = useMemo(
    () => replyQueue.filter((r) => r.status === 'draft' || r.status === 'blocked'),
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
          </div>

          {/* Card da Decisão da IA (Diretora) */}
          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-5 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-violet-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">Decisão da Diretora IA</h3>
              </div>
              {runtime.isProcessing && (
                <span className="flex items-center gap-1 text-[11px] text-violet-300">
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
            <div className="rounded-2xl border border-violet-500/20 bg-[#0c0e12] p-4 shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet-400" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">
                    Respostas IA ({pendingReplies.length})
                  </h3>
                </div>
                <button
                  className="text-[11px] font-semibold text-violet-300 hover:text-violet-200"
                  onClick={onViewReplies}
                >
                  Ver tudo →
                </button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {pendingReplies.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      'rounded-xl border p-3 transition',
                      item.status === 'blocked'
                        ? 'border-red-500/30 bg-red-500/[0.06]'
                        : 'border-white/8 bg-white/[0.02]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-bold text-violet-300 truncate">
                        @{item.sourceMessage.username}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase shrink-0',
                          item.status === 'blocked' ? 'text-red-400' : 'text-amber-400',
                        )}
                      >
                        {item.status === 'blocked' ? 'Bloqueada' : 'Pendente'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed mb-2">{item.text}</p>
                    {item.blockedReason && (
                      <p className="text-[10px] text-red-400 mb-2">{item.blockedReason}</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        className="h-7 px-2.5 text-[11px]"
                        disabled={item.status === 'blocked'}
                        onClick={() => onApproveReply(item)}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Aprovar
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
                  </div>
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
