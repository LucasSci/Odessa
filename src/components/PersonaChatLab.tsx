import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, Check, Copy, Download, MessageCircle, RotateCcw, Send, Sparkles, User, Wand2, X } from 'lucide-react';
import { listPersonas, type PersonaMeta } from '../core/personaManager';
import { generateTangoChatReply } from '../core/tangoAiChatService';
import { getAiConfig, resolveEffectiveProvider } from '../core/aiConfig';
import { routeChatToTriggers } from '../core/chatToTriggerBridge';
import {
  applySelfConfig,
  buildSelfConfigPrompt,
  fetchFaces,
  parseAutoConfig,
  reflectOnConversation,
  requestSelfGeneratedPhoto,
  summarizeSelfConfigChanges,
  type PendingSelfConfigChange,
  type SelfConfigFace,
} from '../core/personaSelfConfig';
import {
  chatHistoryFor,
  clearStoredConversation,
  conversationToText,
  formatClock,
  loadConversation,
  providerLabel,
  saveConversation,
  type LabMessage,
} from '../core/conversationLab';
import { recordSessionEvent } from '../core/sessionHistory';
import { cn } from '../lib/utils';

const DEFAULT_PERSONA_PROMPT = 'Responda em portugues brasileiro, com naturalidade, brevidade e personalidade.';
/** Mensagens de exemplo para testar a persona com um clique (conversa vazia). */
const SUGGESTED_MESSAGES = [
  'Oi! Acabei de chegar na live 👋',
  'Mandei uma rosa pra você 🌹',
  'Qual seu jogo favorito?',
  'Você é uma IA?',
];
/** A cada N respostas da persona, dispara a reflexão de evolução automática. */
const EVOLVE_EVERY = 6;
const NO_MESSAGES: LabMessage[] = [];

/** Id de proposta de autoconfiguração (chamado em handlers, nunca no render). */
function proposalId(prefix: string) {
  return `${prefix}-${Date.now()}`;
}

export function PersonaChatLab() {
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messagesByPersona, setMessagesByPersona] = useState<Record<string, LabMessage[]>>({});
  const [draft, setDraft] = useState('');
  const [loadingPersonas, setLoadingPersonas] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoConfig, setAutoConfig] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [facesByPersona, setFacesByPersona] = useState<Record<string, SelfConfigFace[]>>({});
  // Aprovação obrigatória (Área 4): a persona PROPÕE uma autoconfiguração,
  // mas só é aplicada se o operador aceitar aqui. Um pendente por persona —
  // bloqueia novas mensagens até ser resolvido (aceito ou rejeitado).
  const [pendingByPersona, setPendingByPersona] = useState<Record<string, PendingSelfConfigChange | null>>({});
  const assistantCountRef = useRef(0);
  const reflectingRef = useRef(false);
  // Cancelar a espera: a IA local pode levar muitos segundos (ou travar).
  const abortRef = useRef<AbortController | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const refreshPersonas = () => {
    void listPersonas()
      .then((data) => setPersonas(data.personas))
      .catch(() => { /* a lista atual é suficiente em caso de falha */ });
  };

  const pushSystemMessage = (personaId: string, text: string, isError = false) => {
    setMessagesByPersona((current) => ({
      ...current,
      [personaId]: [
        ...(current[personaId] || []),
        { role: 'system', username: 'sistema', text, timestamp: new Date().toISOString(), error: isError || undefined },
      ],
    }));
  };

  // A conversa sobrevive a trocar de aba/persona e a recarregar a página: ela é
  // lida do armazenamento no momento em que a persona é escolhida. Só entra na
  // memória uma vez, então o que estiver em tela nunca é sobrescrito.
  const selectPersona = (personaId: string) => {
    setSelectedId(personaId);
    if (!personaId) return;
    setMessagesByPersona((current) => (current[personaId] ? current : { ...current, [personaId]: loadConversation(personaId) }));
  };

  useEffect(() => {
    void listPersonas()
      .then((data) => {
        setPersonas(data.personas);
        selectPersona(data.activePersonaId || data.personas[0]?.id || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Nao foi possivel carregar as personas.'))
      .finally(() => setLoadingPersonas(false));
  }, []);

  // Imagens de rosto disponíveis para a persona escolher o próprio avatar.
  useEffect(() => {
    if (!selectedId || facesByPersona[selectedId]) return;
    let cancelled = false;
    void fetchFaces(selectedId).then((faces) => {
      if (!cancelled) setFacesByPersona((current) => ({ ...current, [selectedId]: faces }));
    });
    return () => { cancelled = true; };
  }, [selectedId, facesByPersona]);

  const selectedPersona = useMemo(
    () => personas.find((persona) => persona.id === selectedId) || null,
    [personas, selectedId],
  );
  const messages = useMemo(
    () => (selectedId ? messagesByPersona[selectedId] ?? NO_MESSAGES : NO_MESSAGES),
    [messagesByPersona, selectedId],
  );
  const pending = selectedId ? pendingByPersona[selectedId] || null : null;

  useEffect(() => {
    // Só grava conversa carregada e não vazia; "Limpar" apaga do armazenamento de propósito.
    if (selectedId && messages.length) saveConversation(selectedId, messages);
  }, [selectedId, messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, sending, pending]);

  // Contador "pensando… N s" enquanto espera a resposta.
  useEffect(() => {
    if (!sending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [sending]);

  // O campo fica desabilitado enquanto a IA responde e perde o foco: devolve ao terminar.
  const wasSendingRef = useRef(false);
  useEffect(() => {
    if (wasSendingRef.current && !sending) draftRef.current?.focus();
    wasSendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  const provider = resolveEffectiveProvider();
  const providerText = providerLabel(provider, provider === 'ollama' ? getAiConfig().localModelName : undefined);

  /** Gera a resposta da persona para `userMessage` (que já está na conversa). */
  const generateReply = async (
    personaId: string,
    persona: PersonaMeta,
    userMessage: LabMessage,
    history: LabMessage[],
  ) => {
    setError(null);
    setElapsedSec(0);
    setSending(true);
    const context = chatHistoryFor(history);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const systemPrompt = [
        persona.personality?.trim() || DEFAULT_PERSONA_PROMPT,
        autoConfig ? buildSelfConfigPrompt(persona, facesByPersona[personaId] || []) : '',
      ].join('');
      // Sem conversationMode/maxLength inflado: o Laboratório precisa gerar
      // exatamente a mesma resposta (mesmas regras de brevidade, diálogo real,
      // sem convites inventados) que o chat de verdade do Tango geraria pra
      // essa mensagem — senão testar aqui não prevê o que vai acontecer na
      // live. maxLength fica um pouco acima do padrão (140) só para não
      // truncar o bloco <autoconfig> (invisível, some do texto exibido) que a
      // autoconfiguração pode anexar à resposta.
      const result = await generateTangoChatReply(
        { username: 'Voce', text: userMessage.text, timestamp: userMessage.timestamp },
        context,
        systemPrompt,
        { maxLength: 320, timeoutMs: 150_000, signal: controller.signal },
      );

      if (controller.signal.aborted) {
        pushSystemMessage(personaId, 'Resposta cancelada.');
        return;
      }
      if (!result.ok) {
        // Falha não é fala da persona: aparece como aviso, com "Tentar de novo".
        pushSystemMessage(personaId, result.blockedReason || result.reason || 'A IA não conseguiu responder.', true);
        return;
      }

      const { cleanText, changes } = autoConfig ? parseAutoConfig(result.reply) : { cleanText: result.reply, changes: null };
      const assistantMessage: LabMessage = {
        role: 'assistant',
        username: persona.name,
        text: cleanText,
        timestamp: new Date().toISOString(),
      };
      setMessagesByPersona((current) => ({
        ...current,
        [personaId]: [...(current[personaId] || []), assistantMessage],
      }));

      // A persona pediu para mudar a si mesma → PROPÕE, não aplica direto
      // (Área 4: aprovação obrigatória). O operador aceita/rejeita no card
      // que aparece no fluxo de mensagens.
      if (changes) {
        const proposal: PendingSelfConfigChange = {
          id: proposalId('selfconfig'),
          personaId,
          changes,
          source: 'conversation',
          proposedAt: new Date().toISOString(),
          summary: summarizeSelfConfigChanges(changes),
        };
        setPendingByPersona((current) => ({ ...current, [personaId]: proposal }));
        pushSystemMessage(personaId, `🛠️ ${persona.name} propôs uma mudança em si mesma — revise abaixo.`);
        recordSessionEvent('persona.selfconfig.proposed', {
          personaId,
          summary: proposal.summary,
          source: 'conversation',
        });
      }
      // Evolução automática: a cada EVOLVE_EVERY respostas a persona reflete
      // sobre a conversa. O traço incorporado também vira proposta, não
      // aplica sozinho — só pula se já existir um pendente pra não empilhar.
      assistantCountRef.current += 1;
      if (autoConfig && assistantCountRef.current % EVOLVE_EVERY === 0 && !reflectingRef.current && !pendingByPersona[personaId]) {
        reflectingRef.current = true;
        void reflectOnConversation(persona, [...context, userMessage, assistantMessage])
          .then((evolved) => {
            if (!evolved) return;
            const proposal: PendingSelfConfigChange = {
              id: proposalId('selfconfig-evolve'),
              personaId,
              changes: evolved,
              source: 'evolution',
              proposedAt: new Date().toISOString(),
              summary: summarizeSelfConfigChanges(evolved),
            };
            let created = false;
            setPendingByPersona((current) => {
              if (current[personaId]) return current;
              created = true;
              return { ...current, [personaId]: proposal };
            });
            if (created) {
              pushSystemMessage(personaId, `🧬 ${persona.name} quer incorporar algo que percebeu na conversa — revise abaixo.`);
              recordSessionEvent('persona.selfconfig.proposed', {
                personaId,
                summary: proposal.summary,
                source: 'evolution',
              });
            }
          })
          .catch(() => { /* evolução é best-effort */ })
          .finally(() => { reflectingRef.current = false; });
      }
    } catch (err) {
      if (controller.signal.aborted) pushSystemMessage(personaId, 'Resposta cancelada.');
      else pushSystemMessage(personaId, err instanceof Error ? err.message : 'Falha ao conversar com a persona.', true);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
    }
  };

  const sendText = (raw: string) => {
    const text = raw.trim();
    if (!text || !selectedPersona || sending || pending) return;

    const userMessage: LabMessage = {
      role: 'user',
      username: 'Voce',
      text,
      timestamp: new Date().toISOString(),
    };
    const history = messages;
    setDraft('');
    setMessagesByPersona((current) => ({
      ...current,
      [selectedId]: [...history, userMessage],
    }));

    // Alimenta o mesmo pipeline de buffer/video-gen/síntese de gatilho que a
    // live de verdade usa (execute:false evita ações "ao vivo" como OBS/
    // webhook, mas o backend roda process_raw_text() incondicionalmente —
    // buffer, geração de vídeo e o gatilho recém-sintetizado funcionam
    // normalmente aqui). É o que torna a seção "fechar o ciclo do vídeo"
    // testável no Laboratório sem precisar de uma live real.
    void routeChatToTriggers(
      { username: 'Voce', text, timestamp: userMessage.timestamp },
      { execute: false },
    );

    void generateReply(selectedId, selectedPersona, userMessage, history);
  };

  const sendMessage = () => sendText(draft);

  /** Refaz a última resposta sem duplicar a mensagem do usuário nem religar os gatilhos. */
  const retryLast = () => {
    if (!selectedPersona || sending || pending) return;
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') { lastUser = i; break; }
    }
    if (lastUser < 0) return;
    const userMessage = messages[lastUser];
    const history = messages.slice(0, lastUser);
    setMessagesByPersona((current) => ({ ...current, [selectedId]: messages.slice(0, lastUser + 1) }));
    void generateReply(selectedId, selectedPersona, userMessage, history);
  };

  const clearConversation = () => {
    if (!selectedId) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    clearStoredConversation(selectedId);
    setMessagesByPersona((current) => ({ ...current, [selectedId]: [] }));
    setError(null);
  };

  const exportConversation = () => {
    if (!selectedPersona || !messages.length) return;
    const blob = new Blob([conversationToText(selectedPersona.name, messages)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `conversa-${selectedPersona.id}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyMessage = async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1500);
    } catch {
      setError('Não foi possível copiar (o navegador bloqueou o acesso à área de transferência).');
    }
  };

  const acceptPending = async () => {
    if (!pending || !selectedPersona) return;
    const change = pending;
    setPendingByPersona((current) => ({ ...current, [change.personaId]: null }));
    try {
      const applied = await applySelfConfig(change.personaId, change.changes, change.source);
      if (applied.applied.length) {
        pushSystemMessage(change.personaId, `✅ Aplicado: ${applied.applied.join('; ')}`);
        refreshPersonas();
      }
      // Pedido de foto nova: disparo assíncrono (não trava a UI) — a foto
      // some no Content Studio/histórico quando terminar.
      if (change.changes.photo_prompt) {
        pushSystemMessage(change.personaId, `🎨 ${selectedPersona.name} está gerando uma foto nova de si mesma...`);
        void requestSelfGeneratedPhoto(change.personaId, change.changes.photo_prompt, change.source);
      }
      recordSessionEvent('persona.selfconfig.applied', {
        personaId: change.personaId,
        applied: applied.applied,
        source: change.source,
      });
    } catch {
      pushSystemMessage(change.personaId, '⚠️ Falha ao aplicar a mudança aprovada.', true);
    }
  };

  const rejectPending = () => {
    if (!pending) return;
    const change = pending;
    setPendingByPersona((current) => ({ ...current, [change.personaId]: null }));
    pushSystemMessage(change.personaId, '🚫 Mudança proposta foi rejeitada — nada foi alterado.');
    recordSessionEvent('persona.selfconfig.rejected', {
      personaId: change.personaId,
      summary: change.summary,
      source: change.source,
    });
  };

  const onDraftKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia; Shift+Enter quebra linha; durante a composição de acentos
    // (IME) o Enter só confirma o caractere.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  };

  const lastIsError = messages.length > 0 && messages[messages.length - 1].error === true;
  const blocked = !selectedPersona || sending || Boolean(pending);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
      <div className="mb-5 rounded-2xl border border-white/10 bg-[#101114] p-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200/70">
          <MessageCircle className="h-4 w-4" />
          Laboratório local
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">Converse com uma persona</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Teste a personalidade e o modelo local sem iniciar live, OBS, bridge ou captura.
          Peça para a persona mudar algo em si mesma (nome, imagem, jeito de ser) — com a autoconfiguração ativa, ela se reconfigura sozinha pela conversa e sua personalidade evolui com o uso.
        </p>
      </div>

      {error && <div role="alert" className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{error}</div>}

      <div className="grid min-h-[560px] gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-white/10 bg-[#0c0e12] p-3">
          <div className="mb-3 flex items-center gap-2 px-2 text-xs font-bold uppercase tracking-widest text-slate-400">
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" /> Personas
          </div>
          {loadingPersonas ? (
            <p className="px-2 text-sm text-slate-500">Carregando...</p>
          ) : (
            <div className="space-y-1.5">
              {personas.map((persona) => (
                <button
                  key={persona.id}
                  type="button"
                  aria-pressed={selectedId === persona.id}
                  onClick={() => selectPersona(persona.id)}
                  className={cn(
                    'w-full rounded-xl border px-3 py-3 text-left transition',
                    selectedId === persona.id
                      ? 'border-emerald-400/40 bg-emerald-400/10 text-white'
                      : 'border-white/5 bg-white/[0.02] text-slate-300 hover:bg-white/[0.06]',
                  )}
                >
                  <span className="block text-sm font-semibold">{persona.name}</span>
                  <span className="mt-1 block line-clamp-2 text-[11px] text-slate-500">{persona.description || 'Persona Odessa'}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0c0e12]">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-emerald-400" />
              <div>
                <div className="text-sm font-semibold text-white">{selectedPersona?.name || 'Selecione uma persona'}</div>
                <div className="text-[11px] text-slate-500">{providerText} · conversa de teste</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setAutoConfig((value) => !value)}
                aria-pressed={autoConfig}
                title="Permitir que a persona mude a si mesma pela conversa (nome, imagem, personalidade)"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition',
                  autoConfig
                    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                    : 'border-white/10 bg-white/[0.03] text-slate-500 hover:text-slate-300',
                )}
              >
                <Wand2 className="h-3 w-3" />
                Autoconfig {autoConfig ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                onClick={exportConversation}
                disabled={!messages.length}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-white disabled:opacity-40"
                title="Baixar a conversa em texto"
              >
                <Download className="h-3.5 w-3.5" /> Exportar
              </button>
              <button
                type="button"
                onClick={clearConversation}
                disabled={!messages.length}
                className={cn('text-xs disabled:opacity-40', confirmClear ? 'font-semibold text-red-300' : 'text-slate-500 hover:text-white')}
              >
                {confirmClear ? 'Confirmar: apagar conversa?' : 'Limpar conversa'}
              </button>
            </div>
          </header>

          <div role="log" aria-live="polite" aria-label="Conversa" className="flex-1 space-y-3 overflow-y-auto p-4">
            {!messages.length && (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-center text-sm text-slate-500">
                <span>Envie uma mensagem para iniciar esta conversa — ou teste com um exemplo:</span>
                <div className="flex max-w-xl flex-wrap justify-center gap-2">
                  {SUGGESTED_MESSAGES.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={blocked}
                      onClick={() => sendText(suggestion)}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/40 hover:bg-emerald-400/10 disabled:opacity-40"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) =>
              message.role === 'system' ? (
                <div key={`${message.timestamp}-${index}`} className="flex flex-col items-center gap-1.5">
                  <div
                    className={cn(
                      'flex max-w-[90%] items-start gap-1.5 rounded-2xl border px-3 py-1.5 text-center text-[11px]',
                      message.error
                        ? 'border-red-400/30 bg-red-400/10 text-red-200'
                        : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
                    )}
                  >
                    {message.error && <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    <span>{message.text}</span>
                  </div>
                  {message.error && index === messages.length - 1 && (
                    <button
                      type="button"
                      onClick={retryLast}
                      disabled={blocked}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
                    >
                      <RotateCcw className="h-3 w-3" /> Tentar de novo
                    </button>
                  )}
                </div>
              ) : (
              <div key={`${message.timestamp}-${index}`} className={cn('group flex gap-2', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                {message.role === 'assistant' && <Bot className="mt-2 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />}
                <div className={cn('max-w-[78%] rounded-2xl px-3 py-2 text-sm', message.role === 'user' ? 'bg-sky-500/15 text-sky-100' : 'bg-white/[0.06] text-slate-200')}>
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <span>{message.username}</span>
                    {formatClock(message.timestamp) && <span className="font-normal normal-case tracking-normal">{formatClock(message.timestamp)}</span>}
                    <button
                      type="button"
                      onClick={() => void copyMessage(index, message.text)}
                      aria-label="Copiar mensagem"
                      className="ml-auto opacity-0 transition hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      {copiedIndex === index ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                  <span className="whitespace-pre-wrap break-words">{message.text}</span>
                </div>
                {message.role === 'user' && <User className="mt-2 h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />}
              </div>
              )
            )}
            {sending && (
              <div role="status" className="flex items-center gap-3 text-xs text-slate-500">
                <span>
                  {selectedPersona?.name} está pensando… {elapsedSec > 0 && `${elapsedSec} s`}
                  {elapsedSec >= 20 && ' (a IA local pode demorar no primeiro uso)'}
                </span>
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-0.5 font-semibold text-slate-300 transition hover:bg-white/10"
                >
                  <X className="h-3 w-3" /> Cancelar
                </button>
              </div>
            )}
            {pending && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                  <Wand2 className="h-3.5 w-3.5" />
                  {pending.source === 'evolution' ? 'Evolução automática — aprovação necessária' : 'Autoconfiguração proposta'}
                </div>
                <p className="mt-1.5 text-sm text-amber-100">{pending.summary}</p>
                <p className="mt-1 text-[11px] text-amber-300/70">
                  Nenhuma mensagem nova pode ser enviada enquanto esta proposta não for revisada.
                </p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void acceptPending()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-emerald-400"
                  >
                    <Check className="h-3.5 w-3.5" /> Aceitar
                  </button>
                  <button
                    type="button"
                    onClick={rejectPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
                  >
                    <X className="h-3.5 w-3.5" /> Rejeitar
                  </button>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-white/10 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={draftRef}
                value={draft}
                rows={Math.min(5, Math.max(1, draft.split('\n').length))}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onDraftKeyDown}
                disabled={blocked}
                aria-label="Mensagem para a persona"
                placeholder={pending ? 'Revise a proposta acima antes de continuar...' : 'Escreva uma mensagem... (Shift+Enter: nova linha)'}
                className="min-w-0 flex-1 resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!draft.trim() || blocked}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" /> Enviar
              </button>
            </div>
            {lastIsError && !sending && (
              <p className="mt-2 text-[11px] text-slate-500">Se a IA local ou uma chave for o problema, o aviso no topo da tela e a aba Diagnóstico mostram como resolver.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
