import { useEffect, useMemo, useState } from 'react';
import { Bot, MessageCircle, Send, Sparkles, User } from 'lucide-react';
import { listPersonas, type PersonaMeta } from '../core/personaManager';
import { generateTangoChatReply, type TangoChatMessage } from '../core/tangoAiChatService';
import { cn } from '../lib/utils';

type LabMessage = TangoChatMessage & { role: 'user' | 'assistant'; pending?: boolean };

const DEFAULT_PERSONA_PROMPT = 'Responda em portugues brasileiro, com naturalidade, brevidade e personalidade.';

export function PersonaChatLab() {
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messagesByPersona, setMessagesByPersona] = useState<Record<string, LabMessage[]>>({});
  const [draft, setDraft] = useState('');
  const [loadingPersonas, setLoadingPersonas] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listPersonas()
      .then((data) => {
        setPersonas(data.personas);
        setSelectedId(data.activePersonaId || data.personas[0]?.id || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Nao foi possivel carregar as personas.'))
      .finally(() => setLoadingPersonas(false));
  }, []);

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

    try {
      const result = await generateTangoChatReply(
        { username: 'Voce', text, timestamp: userMessage.timestamp },
        history,
        selectedPersona.personality?.trim() || DEFAULT_PERSONA_PROMPT,
        { conversationMode: true, maxLength: 2000, timeoutMs: 150_000 },
      );
      const assistantMessage: LabMessage = {
        role: 'assistant',
        username: selectedPersona.name,
        text: result.ok ? result.reply : (result.reason || 'A IA não conseguiu responder.'),
        timestamp: new Date().toISOString(),
      };
      setMessagesByPersona((current) => ({
        ...current,
        [selectedId]: [...(current[selectedId] || []), assistantMessage],
      }));
      if (!result.ok) setError(result.blockedReason || result.reason || 'A resposta foi bloqueada.');
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
            <button type="button" onClick={clearConversation} className="text-xs text-slate-500 hover:text-white">Limpar conversa</button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {!messages.length && <div className="flex h-full min-h-[300px] items-center justify-center text-center text-sm text-slate-500">Envie uma mensagem para iniciar esta conversa.</div>}
            {messages.map((message, index) => (
              <div key={`${message.timestamp}-${index}`} className={cn('flex gap-2', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                {message.role === 'assistant' && <Bot className="mt-2 h-4 w-4 shrink-0 text-emerald-400" />}
                <div className={cn('max-w-[78%] rounded-2xl px-3 py-2 text-sm', message.role === 'user' ? 'bg-sky-500/15 text-sky-100' : 'bg-white/[0.06] text-slate-200')}>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{message.username}</div>
                  {message.text}
                </div>
                {message.role === 'user' && <User className="mt-2 h-4 w-4 shrink-0 text-sky-400" />}
              </div>
            ))}
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
