import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { getEffectiveSystemPrompt } from '../core/aiConfig';
import {
  addConversationMessage,
  approveConversationReply,
  createConversation,
  generateConversationReply,
  getConversation,
  listConversations,
  type Conversation,
  type ConversationMessage,
} from '../lib/conversations';
import {
  domainFromUrl,
  getChatAutomationConfig,
  loadChatAutomationTarget,
  saveChatAutomationConfig,
  saveChatAutomationTarget,
  sendChatAutomationMessage,
  validateChatAutomationTarget,
  type ChatAutomationAllowEntry,
  type ChatAutomationTarget,
} from '../lib/chatAutomation';
import { cn } from '../lib/utils';
import { Badge, Button, Input, StatusDot } from './ui';

function formatTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function latestMessage(conversation: Conversation) {
  return conversation.messages?.[conversation.messages.length - 1];
}

function messageStatusVariant(status?: string): 'default' | 'success' | 'warning' | 'lavender' {
  if (status === 'approved' || status === 'sent') return 'success';
  if (status === 'draft') return 'lavender';
  if (status === 'received') return 'warning';
  return 'default';
}

function MessageBubble({
  message,
  onApprove,
  approving,
  canSend,
}: {
  message: ConversationMessage;
  onApprove: (messageId: string) => void;
  approving: boolean;
  canSend: boolean;
}) {
  const isAssistant = message.role === 'assistant';
  return (
    <div className={cn('flex', isAssistant ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[78%] rounded-2xl border px-3 py-2',
          isAssistant
            ? 'border-violet-400/20 bg-violet-500/10 text-slate-100'
            : 'border-white/10 bg-white/[0.045] text-slate-200',
        )}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {isAssistant ? 'Diretora' : 'Contato'}
          </span>
          <span className="text-[10px] text-slate-600">{formatTime(message.createdAt)}</span>
          {message.status && (
            <Badge variant={messageStatusVariant(message.status)} className="px-1.5 py-0.5 text-[8px]">
              {message.status}
            </Badge>
          )}
        </div>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{message.text}</p>
        {isAssistant && message.status === 'draft' && (
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              variant="success"
              loading={approving}
              onClick={() => onApprove(message.id)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {canSend ? 'Aprovar e enviar' : 'Aprovar'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function DirectorOneToOnePanel() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [target, setTarget] = useState<ChatAutomationTarget>(() => loadChatAutomationTarget());
  const [bridgeStatus, setBridgeStatus] = useState<'unknown' | 'ready' | 'blocked' | 'saving'>('unknown');
  const [bridgeMessage, setBridgeMessage] = useState('');
  const selectedIdRef = useRef<string | null>(null);

  const draftCount = useMemo(
    () =>
      conversations.reduce(
        (total, conversation) =>
          total + conversation.messages.filter((message) => message.status === 'draft').length,
        0,
      ),
    [conversations],
  );

  const bridgeReady = bridgeStatus === 'ready' && Boolean(target.url && target.inputSelector);

  const refreshBridge = useCallback(async () => {
    const savedTarget = loadChatAutomationTarget();
    setTarget(savedTarget);
    if (!savedTarget.url || !savedTarget.inputSelector) {
      setBridgeStatus('unknown');
      setBridgeMessage('Pendente');
      return;
    }
    try {
      const validation = await validateChatAutomationTarget(savedTarget);
      setBridgeStatus(validation.allowed ? 'ready' : 'blocked');
      setBridgeMessage(validation.allowed ? 'Tango validado' : validation.reason || 'Bloqueado');
    } catch (err) {
      setBridgeStatus('blocked');
      setBridgeMessage(err instanceof Error ? err.message : 'Falha ao validar Tango');
    }
  }, []);

  const refreshList = useCallback(async (nextSelectedId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const items = await listConversations();
      setConversations(items);
      const id = nextSelectedId ?? selectedIdRef.current ?? items[0]?.id ?? null;
      setSelectedId(id);
      selectedIdRef.current = id;
      if (id) {
        setSelected(await getConversation(id));
      } else {
        setSelected(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar conversas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshList(null);
      void refreshBridge();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshBridge, refreshList]);

  const handleSaveBridge = async () => {
    const normalized = {
      url: target.url.trim(),
      inputSelector: target.inputSelector.trim(),
      sendSelector: target.sendSelector?.trim() || '',
    };
    const domain = domainFromUrl(normalized.url);
    if (!domain || !normalized.inputSelector) {
      setBridgeStatus('blocked');
      setBridgeMessage('URL e selector obrigatorios');
      return;
    }
    setBridgeStatus('saving');
    setBridgeMessage('Salvando...');
    try {
      const config = await getChatAutomationConfig().catch(() => ({ allowlist: [], logs: [] }));
      const entry: ChatAutomationAllowEntry = {
        id: 'tango-1to1',
        label: 'Tango 1:1',
        domain,
        urlPattern: '.*',
        inputSelector: normalized.inputSelector,
        sendSelector: normalized.sendSelector || '',
        submitWithEnter: true,
        typingDelayMs: 25,
        maxPerMinute: 6,
        enabled: true,
      };
      const nextAllowlist = [
        entry,
        ...config.allowlist.filter((item) => item.id !== entry.id),
      ];
      await saveChatAutomationConfig(nextAllowlist);
      saveChatAutomationTarget(normalized);
      const validation = await validateChatAutomationTarget(normalized);
      setBridgeStatus(validation.allowed ? 'ready' : 'blocked');
      setBridgeMessage(validation.allowed ? 'Tango validado' : validation.reason || 'Bloqueado');
    } catch (err) {
      setBridgeStatus('blocked');
      setBridgeMessage(err instanceof Error ? err.message : 'Falha ao salvar ponte');
    }
  };

  const selectConversation = async (conversationId: string) => {
    setSelectedId(conversationId);
    selectedIdRef.current = conversationId;
    setError(null);
    try {
      setSelected(await getConversation(conversationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir conversa');
    }
  };

  const handleCreateConversation = async () => {
    const name = participantName.trim();
    const id = (participantId.trim() || name).trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const conversation = await createConversation({
        participantId: id,
        participantName: name || id,
        source: '1:1',
      });
      setParticipantId('');
      setParticipantName('');
      await refreshList(conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar conversa');
    } finally {
      setBusy(false);
    }
  };

  const handleAddMessage = async () => {
    if (!selected || !messageText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addConversationMessage(selected.id, { role: 'user', text: messageText.trim() });
      setMessageText('');
      await refreshList(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registrar mensagem');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateReply = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await generateConversationReply(selected.id, {
        personaPrompt: getEffectiveSystemPrompt(),
        model: 'gemini-2.5-flash',
        temperature: 0.72,
      });
      await refreshList(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar resposta');
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (messageId: string) => {
    if (!selected) return;
    setApprovingId(messageId);
    setError(null);
    try {
      const approved = await approveConversationReply(selected.id, messageId);
      if (bridgeReady && approved.text.trim()) {
        const result = await sendChatAutomationMessage({
          url: target.url,
          inputSelector: target.inputSelector,
          text: approved.text,
          dryRun: false,
        });
        setBridgeMessage(result.allowed ? 'Resposta liberada para o Tango' : result.reason || 'Envio bloqueado');
        setBridgeStatus(result.allowed ? 'ready' : 'blocked');
      }
      await refreshList(selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao aprovar resposta');
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="flex min-h-[620px] flex-col rounded-[28px] border border-white/10 bg-[#0c0d10]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-500/10 text-violet-300">
            <MessageCircle className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Conversas 1:1</h2>
            <p className="text-xs text-slate-500">
              Caixa operacional da Diretora para rascunhar e aprovar respostas.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={bridgeReady ? 'success' : bridgeStatus === 'blocked' ? 'danger' : 'warning'}>
            Tango {bridgeReady ? 'ok' : 'pendente'}
          </Badge>
          <Badge variant={draftCount ? 'lavender' : 'default'}>{draftCount} rascunho(s)</Badge>
          <Button size="icon" variant="secondary" loading={loading} onClick={() => void refreshList()}>
            {!loading && <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-2xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 p-4 lg:border-b-0 lg:border-r">
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
              <Plus className="h-3.5 w-3.5" />
              Nova conversa
            </div>
            <Input
              label="Nome"
              value={participantName}
              onChange={(event) => setParticipantName(event.target.value)}
              placeholder="Ex: Ana"
            />
            <Input
              label="Identificador"
              value={participantId}
              onChange={(event) => setParticipantId(event.target.value)}
              placeholder="@ana ou telefone"
            />
            <Button
              className="w-full"
              variant="primary"
              loading={busy}
              disabled={!participantName.trim() && !participantId.trim()}
              onClick={() => void handleCreateConversation()}
            >
              Criar
            </Button>
          </div>

          <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5" />
                Ponte Tango
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <StatusDot
                  status={bridgeReady ? 'online' : bridgeStatus === 'blocked' ? 'error' : 'warn'}
                  pulse={bridgeStatus === 'saving'}
                />
                {bridgeMessage || 'Pendente'}
              </div>
            </div>
            <Input
              label="URL da conversa"
              value={target.url}
              onChange={(event) => setTarget((current) => ({ ...current, url: event.target.value }))}
              placeholder="https://www.tango.me/..."
            />
            <Input
              label="Campo de mensagem"
              value={target.inputSelector}
              onChange={(event) =>
                setTarget((current) => ({ ...current, inputSelector: event.target.value }))
              }
              placeholder='textarea, [contenteditable="true"]...'
            />
            <Input
              label="Botao enviar"
              value={target.sendSelector || ''}
              onChange={(event) =>
                setTarget((current) => ({ ...current, sendSelector: event.target.value }))
              }
              placeholder="Opcional se Enter envia"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                loading={bridgeStatus === 'saving'}
                onClick={() => void handleSaveBridge()}
              >
                <Save className="h-4 w-4" />
                Salvar
              </Button>
              <Button variant="ghost" onClick={() => void refreshBridge()}>
                <RefreshCw className="h-4 w-4" />
                Validar
              </Button>
            </div>
            {bridgeStatus === 'blocked' && (
              <div className="flex gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{bridgeMessage || 'A ponte ainda nao esta validada.'}</span>
              </div>
            )}
          </div>

          <div className="mt-4 space-y-2">
            {conversations.length === 0 && !loading && (
              <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-xs text-slate-500">
                Nenhuma conversa registrada.
              </div>
            )}
            {conversations.map((conversation) => {
              const latest = latestMessage(conversation);
              const active = conversation.id === selectedId;
              return (
                <button
                  key={conversation.id}
                  onClick={() => void selectConversation(conversation.id)}
                  className={cn(
                    'w-full rounded-2xl border p-3 text-left transition',
                    active
                      ? 'border-violet-400/35 bg-violet-500/10'
                      : 'border-white/8 bg-white/[0.035] hover:border-white/16 hover:bg-white/[0.055]',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-200">
                      <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <span className="truncate">{conversation.participantName}</span>
                    </span>
                    <StatusDot status={latest?.status === 'draft' ? 'warn' : 'idle'} />
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-500">
                    {latest?.text || 'Sem mensagens ainda.'}
                  </p>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">{selected.participantName}</h3>
                  <p className="font-mono text-[11px] text-slate-600">{selected.participantId}</p>
                </div>
                <Button
                  variant="secondary"
                  loading={busy}
                  disabled={!selected.messages.length}
                  onClick={() => void handleGenerateReply()}
                >
                  <Sparkles className="h-4 w-4" />
                  Gerar rascunho
                </Button>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {selected.messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-600">
                    Registre a primeira mensagem recebida para a Diretora responder.
                  </div>
                ) : (
                  selected.messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      approving={approvingId === message.id}
                      canSend={bridgeReady}
                      onApprove={handleApprove}
                    />
                  ))
                )}
              </div>

              <div className="border-t border-white/10 p-4">
                <div className="flex gap-2">
                  <textarea
                    value={messageText}
                    onChange={(event) => setMessageText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        void handleAddMessage();
                      }
                    }}
                    placeholder="Cole ou digite a mensagem recebida no 1:1..."
                    className="min-h-20 flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm leading-relaxed text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-violet-400/35"
                  />
                  <Button
                    size="icon"
                    variant="primary"
                    loading={busy}
                    disabled={!messageText.trim()}
                    onClick={() => void handleAddMessage()}
                  >
                    {!busy && <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="max-w-sm text-center">
                <Loader2 className={cn('mx-auto mb-4 h-6 w-6 text-slate-600', loading && 'animate-spin')} />
                <h3 className="text-sm font-semibold text-slate-300">Selecione ou crie uma conversa</h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  A Diretoria usa o mesmo contexto da IA para gerar respostas privadas aprováveis.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
