/**
 * TangoChatFeed — Feed ao vivo do chat da Live + barra de envio.
 *
 * Componente de apresentação extraído do cockpit para ser reutilizado tanto na
 * aba "Cockpit" quanto no "Painel Unificado" (transmissão + chat lado a lado).
 * Toda a lógica (mensagens, SSE, envio, geração de IA) continua no TangoChatPanel;
 * aqui recebemos tudo via props.
 */

import { useRef } from 'react';
import {
  Clock,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
} from 'lucide-react';
import { Badge, Button } from './ui';
import { cn } from '../lib/utils';
import type { TangoChatMessage } from '../core/tangoAiChatService';

export type TangoChatFeedProps = {
  messages: TangoChatMessage[];
  bridgeConnected: boolean;
  cooldownRemaining: number;
  generatingForId: string | null;
  onGenerateReply: (msg: TangoChatMessage) => void;
  cannedResponses: string[];
  onPickCanned: (text: string) => void;
  generatingProactive: boolean;
  onGenerateProactive: () => void;
  draftText: string;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  /** Quantidade de respostas IA pendentes (p/ atalho "ver fila") */
  replyQueueCount?: number;
  onViewReplies?: () => void;
  /** Classe de altura do painel (default h-[520px]) */
  heightClass?: string;
  className?: string;
};

export function TangoChatFeed({
  messages,
  bridgeConnected,
  cooldownRemaining,
  generatingForId,
  onGenerateReply,
  cannedResponses,
  onPickCanned,
  generatingProactive,
  onGenerateProactive,
  draftText,
  onDraftChange,
  onSend,
  sending,
  messagesEndRef,
  replyQueueCount = 0,
  onViewReplies,
  heightClass = 'h-[520px]',
  className,
}: TangoChatFeedProps) {
  return (
    <div className={cn('rounded-2xl border border-white/10 bg-[#0c0e12] overflow-hidden shadow-lg flex flex-col', heightClass, className)}>
      {/* Cabeçalho */}
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3 bg-black/30">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-violet-400" />
          <span className="text-xs font-bold uppercase tracking-widest text-slate-300">Chat da Live</span>
          <Badge variant="default" className="text-[10px]">
            {messages.length} mensagens
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {replyQueueCount > 0 && onViewReplies && (
            <button
              className="flex items-center gap-1 text-[11px] font-semibold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20 hover:bg-violet-500/20 transition"
              onClick={onViewReplies}
              title="Ver fila de respostas da IA"
            >
              <Sparkles className="h-3 w-3" /> {replyQueueCount} resposta{replyQueueCount > 1 ? 's' : ''} IA →
            </button>
          )}
          {cooldownRemaining > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
              <Clock className="h-3 w-3" /> Cooldown: {cooldownRemaining}s
            </span>
          )}
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-emerald-400" />
            ao vivo
          </span>
        </div>
      </div>

      {/* Mensagens com botão rápido de IA */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center p-6">
            <MessageCircle className="h-10 w-10 text-slate-600 mb-2" />
            <p className="text-sm font-semibold text-slate-400">Nenhuma mensagem capturada ainda</p>
            <p className="text-xs text-slate-600 mt-1 max-w-sm">
              {bridgeConnected
                ? 'Aguardando espectadores falarem no chat da stream...'
                : 'Inicie a bridge para conectar à live.'}
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={`${msg.timestamp}-${idx}`}
              className="group flex items-start justify-between gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 transition hover:border-violet-500/30 hover:bg-violet-500/[0.04]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs font-bold text-violet-300">@{msg.username}</span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('pt-BR') : ''}
                  </span>
                </div>
                <p className="text-xs text-slate-200 break-words leading-relaxed">{msg.text}</p>
              </div>

              {/* Botão Responder com IA */}
              <button
                className="shrink-0 flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-300 opacity-90 transition hover:bg-violet-500/20 hover:opacity-100 disabled:opacity-50"
                disabled={generatingForId === (msg.timestamp || msg.text)}
                onClick={() => onGenerateReply(msg)}
                title="Gerar sugestão de resposta com IA"
              >
                {generatingForId === (msg.timestamp || msg.text) ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                Responder IA
              </button>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Barra de Envio + Atalhos */}
      <div className="border-t border-white/8 bg-black/40 p-3 space-y-2">
        {/* Pílulas de Respostas Rápidas */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 shrink-0">Rápidas:</span>
          {cannedResponses.slice(0, 4).map((canned, i) => (
            <button
              key={i}
              className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-slate-300 hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-white transition"
              onClick={() => onPickCanned(canned)}
            >
              {canned}
            </button>
          ))}
          <button
            className="shrink-0 flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-violet-300 hover:bg-violet-500/20 transition"
            disabled={generatingProactive}
            onClick={() => onGenerateProactive()}
            title="Gera uma frase proativa da Odessa para o chat"
          >
            {generatingProactive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Puxar Assunto IA
          </button>
        </div>

        {/* Input Manual de Envio */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30"
            placeholder={bridgeConnected ? 'Digite uma mensagem para o chat do Tango…' : 'Conecte a bridge para enviar mensagens'}
            value={draftText}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
          <Button
            size="sm"
            variant="primary"
            className="h-10 px-4"
            disabled={!draftText.trim() || sending}
            onClick={() => onSend()}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}

// Mantém compatibilidade com refs criadas sem tipo estrito.
export type ChatFeedHandle = HTMLDivElement;
export const useChatFeedEndRef = () => useRef<HTMLDivElement | null>(null);
