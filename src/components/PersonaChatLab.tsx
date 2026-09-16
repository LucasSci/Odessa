import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, MessageCircle, Send, Sparkles, User, Wand2 } from 'lucide-react';
import { listPersonas, type PersonaMeta } from '../core/personaManager';
import { generateTangoChatReply, type TangoChatMessage } from '../core/tangoAiChatService';
import { routeChatToTriggers } from '../core/chatToTriggerBridge';
import {
  applySelfConfig,
  buildSelfConfigPrompt,
  fetchFaces,
  parseAutoConfig,
  reflectOnConversation,
  requestSelfGeneratedPhoto,
  type SelfConfigFace,
} from '../core/personaSelfConfig';
import { cn } from '../lib/utils';

type LabMessage = TangoChatMessage & { role: 'user' | 'assistant' | 'system'; pending?: boolean };

const DEFAULT_PERSONA_PROMPT = 'Responda em portugues brasileiro, com naturalidade, brevidade e personalidade.';
/** A cada N respostas da persona, dispara a reflexão de evolução automática. */
const EVOLVE_EVERY = 6;

export function PersonaChatLab() {
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messagesByPersona, setMessagesByPersona] = useState<Record<string, LabMessage[]>>({});
  const [draft, setDraft] = useState('');
  const [loadingPersonas, setLoadingPersonas] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoConfig, setAutoConfig] = useState(true);
  const [facesByPersona, setFacesByPersona] = useState<Record<string, SelfConfigFace[]>>({});
  const assistantCountRef = useRef(0);
  const reflectingRef = useRef(false);

  const refreshPersonas = () => {
    void listPersonas()
      .then((data) => setPersonas(data.personas))
      .catch(() => { /* a lista atual é suficiente em caso de falha */ });
  };

  const pushSystemMessage = (personaId: string, text: string) => {
    setMessagesByPersona((current) => ({
      ...current,
      [personaId]: [
        ...(current[personaId] || []),
        { role: 'system', username: 'sistema', text, timestamp: new Date().toISOString() },
      ],
    }));
  };

  useEffect(() => {
    void listPersonas()
      .then((data) => {
        setPersonas(data.personas);
        setSelectedId(data.activePersonaId || data.personas[0]?.id || '');
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
  const messages = selectedId ? messagesByPersona[selectedId] || [] : [];

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !selectedPersona || sending) return;

    const userMessage: LabMessage = {
      role: 'user',
      username: 'Voce',
      text,
      timestamp: new Date().toISOString(),
    };
    const history = messages;
    setDraft('');
    setError(null);
    setSending(true);
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

    try {
      const systemPrompt = [
        selectedPersona.personality?.trim() || DEFAULT_PERSONA_PROMPT,
        autoConfig ? buildSelfConfigPrompt(selectedPersona, facesByPersona[selectedId] || []) : '',
      ].join('');
      // Sem conversationMode/maxLength inflado: o Laboratório precisa gerar
      // exatamente a mesma resposta (mesmas regras de brevidade, diálogo real,
      // sem convites inventados) que o chat de verdade do Tango geraria pra
      // essa mensagem — senão testar aqui não prevê o que vai acontecer na
      // live. maxLength fica um pouco acima do padrão (140) só para não
      // truncar o bloco <autoconfig> (invisível, some do texto exibido) que a
      // autoconfiguração pode anexar à resposta.
      const result = await generateTangoChatReply(
        { username: 'Voce', text, timestamp: userMessage.timestamp },
        history,
        systemPrompt,
        { maxLength: 320, timeoutMs: 150_000 },
      );
      const { cleanText, changes } = autoConfig && result.ok
        ? parseAutoConfig(result.reply)
        : { cleanText: result.reply, changes: null };
      const assistantMessage: LabMessage = {
        role: 'assistant',
        username: selectedPersona.name,
        text: result.ok ? cleanText : (result.reason || 'A IA não conseguiu responder.'),
        timestamp: new Date().toISOString(),
      };
      setMessagesByPersona((current) => ({
        ...current,
        [selectedId]: [...(current[selectedId] || []), assistantMessage],
      }));
      if (!result.ok) {
        setError(result.blockedReason || result.reason || 'A resposta foi bloqueada.');
      } else {
        // A persona pediu para mudar a si mesma → aplica no backend.
        if (changes) {
          try {
            const applied = await applySelfConfig(selectedId, changes, 'conversation');
            if (applied.applied.length) {
              pushSystemMessage(selectedId, `🛠️ ${selectedPersona.name} se autoconfigurou: ${applied.applied.join('; ')}`);
              refreshPersonas();
            }
          } catch {
            pushSystemMessage(selectedId, '⚠️ A autoconfiguração pedida pela persona falhou ao ser aplicada.');
          }

          // Pedido de foto nova: disparo assíncrono (não trava a resposta) —
          // a foto some no Content Studio/histórico quando terminar, não por
          // um retorno síncrono aqui.
          if (changes.photo_prompt) {
            pushSystemMessage(selectedId, `🎨 ${selectedPersona.name} está gerando uma foto nova de si mesma...`);
            void requestSelfGeneratedPhoto(selectedId, changes.photo_prompt, 'conversation');
          }
        }
        // Evolução automática: a cada EVOLVE_EVERY respostas a persona reflete
        // sobre a conversa e incorpora traços duradouros.
        assistantCountRef.current += 1;
        if (autoConfig && assistantCountRef.current % EVOLVE_EVERY === 0 && !reflectingRef.current) {
          reflectingRef.current = true;
          void reflectOnConversation(selectedPersona, [...history, userMessage, assistantMessage])
            .then(async (evolved) => {
              if (!evolved) return;
              const applied = await applySelfConfig(selectedId, evolved, 'evolution', 'reflexão automática');
              if (applied.applied.length) {
                pushSystemMessage(selectedId, `🧬 ${selectedPersona.name} evoluiu sozinha: ${applied.applied.join('; ')}`);
                refreshPersonas();
              }
            })
            .catch(() => { /* evolução é best-effort */ })
            .finally(() => { reflectingRef.current = false; });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao conversar com a persona.');
    } finally {
      setSending(false);
    }
  };

  const clearConversation = () => {
    if (!selectedId) return;
    setMessagesByPersona((current) => ({ ...current, [selectedId]: [] }));
    setError(null);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
      <div className="mb-5 rounded-2xl border border-white/10 bg-[#101114] p-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200/70">
          <MessageCircle className="h-4 w-4" />
          Laboratorio local
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">Converse com uma persona</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Teste a personalidade e o modelo local sem iniciar live, OBS, bridge ou captura.
          Peça para a persona mudar algo em si mesma (nome, imagem, jeito de ser) — com a autoconfiguração ativa, ela se reconfigura sozinha pela conversa e sua personalidade evolui com o uso.
        </p>
      </div>

      {error && <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{error}</div>}

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
                  onClick={() => setSelectedId(persona.id)}
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
          <header className="flex items-center justify-between border-b border-white/10 bg-black/20 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-emerald-400" />
              <div>
                <div className="text-sm font-semibold text-white">{selectedPersona?.name || 'Selecione uma persona'}</div>
                <div className="text-[11px] text-slate-500">Ollama · conversa de teste</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setAutoConfig((value) => !value)}
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
              <button type="button" onClick={clearConversation} className="text-xs text-slate-500 hover:text-white">Limpar conversa</button>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {!messages.length && <div className="flex h-full min-h-[300px] items-center justify-center text-center text-sm text-slate-500">Envie uma mensagem para iniciar esta conversa.</div>}
            {messages.map((message, index) =>
              message.role === 'system' ? (
                <div key={`${message.timestamp}-${index}`} className="flex justify-center">
                  <div className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-center text-[11px] text-emerald-200">
                    {message.text}
                  </div>
                </div>
              ) : (
              <div key={`${message.timestamp}-${index}`} className={cn('flex gap-2', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                {message.role === 'assistant' && <Bot className="mt-2 h-4 w-4 shrink-0 text-emerald-400" />}
                <div className={cn('max-w-[78%] rounded-2xl px-3 py-2 text-sm', message.role === 'user' ? 'bg-sky-500/15 text-sky-100' : 'bg-white/[0.06] text-slate-200')}>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{message.username}</div>
                  {message.text}
                </div>
                {message.role === 'user' && <User className="mt-2 h-4 w-4 shrink-0 text-sky-400" />}
              </div>
              )
            )}
            {sending && <div className="text-xs text-slate-500">{selectedPersona?.name} está pensando...</div>}
          </div>

          <div className="border-t border-white/10 p-3">
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void sendMessage(); }}
                disabled={!selectedPersona || sending}
                placeholder="Escreva uma mensagem de teste..."
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50 disabled:opacity-50"
              />
              <button type="button" onClick={() => void sendMessage()} disabled={!draft.trim() || !selectedPersona || sending} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
                <Send className="h-4 w-4" /> Enviar
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
