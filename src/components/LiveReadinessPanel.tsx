import { Activity, Ban, CheckCircle2, FlaskConical, Send } from 'lucide-react';
import { getAiConfig, hasActiveGeminiKey, resolveEffectiveProvider } from '../core/aiConfig';
import { describeChatAutonomy, describeReplyBlock } from '../core/chatConversationGovernor';
import type { LiveReadinessState, SubsystemReadiness } from '../core/liveReadinessSupervisor';
import { useTangoChatSession } from '../core/tangoChatSession';
import type { AutopilotRuntimeState } from '../core/useAutopilotRuntime';
import { useLiveReadiness } from '../core/useLiveSupervisor';
import { cn } from '../lib/utils';
import { StatusDot } from './ui';

type Tone = 'ready' | 'warning' | 'blocked' | 'simulated';

const TONE: Record<Tone, { box: string; text: string; dot: 'online' | 'warn' | 'error' | 'idle'; label: string }> = {
  ready: { box: 'border-emerald-400/30 bg-emerald-500/[0.07]', text: 'text-emerald-200', dot: 'online', label: 'Pronto' },
  warning: { box: 'border-amber-400/30 bg-amber-500/[0.07]', text: 'text-amber-200', dot: 'warn', label: 'Atenção' },
  blocked: { box: 'border-red-400/30 bg-red-500/[0.07]', text: 'text-red-200', dot: 'error', label: 'Bloqueado' },
  simulated: { box: 'border-violet-400/30 bg-violet-500/[0.07]', text: 'text-violet-200', dot: 'idle', label: 'Simulado' },
};

function toneOf(state: LiveReadinessState, simulated?: boolean): Tone {
  if (simulated) return 'simulated';
  if (state === 'healthy') return 'ready';
  if (state === 'blocked') return 'blocked';
  return 'warning';
}

function aiReadiness(): { tone: Tone; detail: string } {
  const config = getAiConfig();
  if (config.provider === 'mock') return { tone: 'warning', detail: 'Mock: respostas de teste.' };
  const provider = resolveEffectiveProvider(config);
  if (provider === 'gemini') {
    return hasActiveGeminiKey()
      ? { tone: 'ready', detail: 'Gemini com chave ativa.' }
      : { tone: 'blocked', detail: 'Gemini sem chave: configure em Configurações → Diretora IA.' };
  }
  return { tone: 'ready', detail: provider === 'claude' ? 'Claude.' : `Ollama local (${config.localModelName}).` };
}

function ageLabel(iso?: string) {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  return seconds < 60 ? `há ${seconds}s` : `há ${Math.round(seconds / 60)} min`;
}

function ReadinessItem({ label, tone, detail, action }: { label: string; tone: Tone; detail: string; action?: string }) {
  return (
    <li className="min-w-0 rounded-xl border border-white/8 bg-black/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <StatusDot status={TONE[tone].dot} />
        <span className="text-xs font-semibold text-slate-200">{label}</span>
        <span className={cn('ml-auto text-[10px] font-bold uppercase tracking-wider', TONE[tone].text)}>{TONE[tone].label}</span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">{detail}</p>
      {action && tone !== 'ready' && <p className="mt-0.5 text-[11px] leading-snug text-slate-300">→ {action}</p>}
    </li>
  );
}

/**
 * Prontidão da Live (#168): em uma olhada, se o chat real pode ser ligado,
 * o estado de cada parte, a última resposta enviada e a última bloqueada.
 */
export function LiveReadinessPanel({ runtime }: { runtime: AutopilotRuntimeState }) {
  const readiness = useLiveReadiness(runtime);
  const { autonomyMode, executionMode, replyQueue, lastSkipped } = useTangoChatSession();
  const ai = aiReadiness();
  const byId = Object.fromEntries(readiness.checklist.map((item) => [item.id, item])) as Record<string, SubsystemReadiness>;
  const capture = byId.capture;
  const chat = byId.chat;

  // O envio real pode ser ligado quando a bridge lê o chat, o campo de
  // digitação foi confirmado e a IA está disponível.
  const bridgeReady = capture.state === 'healthy' && chat.metrics.bridgeConnected === true && chat.metrics.inputReady === true;
  const canGoReal = bridgeReady && ai.tone !== 'blocked';
  const firstIssue = readiness.checklist.find((item) => item.state !== 'healthy' && (item.id === 'capture' || item.id === 'chat'));
  const realBlocked = chat.state === 'blocked' || capture.state === 'blocked' || ai.tone === 'blocked';
  const verdict: { tone: Tone; title: string; detail: string } =
    executionMode === 'real'
      ? realBlocked
        ? { tone: 'blocked', title: 'Envio real ligado, mas não vai sair nada', detail: firstIssue?.detail ?? ai.detail }
        : firstIssue
          ? { tone: 'warning', title: 'Envio real ligado — confira o aviso', detail: firstIssue.detail }
          : { tone: 'ready', title: 'Envio real ligado e pronto', detail: 'A Odessa pode escrever no chat do Tango.' }
      : canGoReal
        ? { tone: 'simulated', title: 'Modo teste — o envio real já pode ser ligado', detail: 'Tudo verde: bridge lendo o chat e campo de digitação confirmado.' }
        : {
            tone: 'warning',
            title: 'Modo teste — envio real ainda não',
            detail: firstIssue?.suggestedAction ?? firstIssue?.detail ?? ai.detail,
          };

  const lastSent = replyQueue.find((item) => item.status === 'sent' || item.status === 'simulated');
  const lastQueueBlock = replyQueue.find((item) => item.status === 'blocked' || item.status === 'failed');
  const lastBlock =
    lastSkipped && (!lastQueueBlock || Date.parse(lastSkipped.at) >= Date.parse(lastQueueBlock.sentAt || lastQueueBlock.createdAt))
      ? { username: lastSkipped.username, text: lastSkipped.text, reason: describeReplyBlock(lastSkipped.reason), at: lastSkipped.at }
      : lastQueueBlock
        ? {
            username: lastQueueBlock.sourceMessage.username,
            text: lastQueueBlock.text,
            reason: lastQueueBlock.blockedReason || (lastQueueBlock.status === 'failed' ? 'falha ao enviar' : 'bloqueada'),
            at: lastQueueBlock.sentAt || lastQueueBlock.createdAt,
          }
        : null;

  const VerdictIcon = verdict.tone === 'ready' ? CheckCircle2 : verdict.tone === 'simulated' ? FlaskConical : verdict.tone === 'blocked' ? Ban : Activity;

  return (
    <section aria-label="Prontidão da Live" className="rounded-2xl border border-white/10 bg-[#0c0e12] p-4">
      <div className={cn('flex items-start gap-3 rounded-xl border p-3', TONE[verdict.tone].box)}>
        <VerdictIcon className={cn('mt-0.5 h-5 w-5 shrink-0', TONE[verdict.tone].text)} />
        <div className="min-w-0">
          <h3 className={cn('text-sm font-bold', TONE[verdict.tone].text)}>{verdict.title}</h3>
          <p className="mt-0.5 text-xs text-slate-300">{verdict.detail}</p>
          <p className="mt-1 text-[11px] text-slate-400">{describeChatAutonomy(autonomyMode, executionMode)}</p>
        </div>
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <ReadinessItem label="IA" tone={ai.tone} detail={ai.detail} />
        {readiness.checklist.map((item) => (
          <ReadinessItem
            key={item.id}
            label={item.label}
            tone={toneOf(item.state, item.simulated)}
            detail={item.detail}
            action={item.suggestedAction}
          />
        ))}
      </ul>

      <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] md:grid-cols-2">
        <div className="flex min-w-0 items-start gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-2">
          <Send className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
          <p className="min-w-0 text-slate-400">
            <span className="font-semibold text-slate-200">Última enviada: </span>
            {lastSent ? (
              <>
                <span className="text-slate-200">“{lastSent.text}”</span> → @{lastSent.sourceMessage.username}{' '}
                {lastSent.status === 'simulated' && <span className="text-violet-300">(simulada) </span>}
                {lastSent.status === 'sent' && lastSent.confirmed === true && <span className="text-emerald-300">(confirmada no chat) </span>}
                {lastSent.status === 'sent' && lastSent.confirmed === false && <span className="text-amber-300">(sem confirmação) </span>}
                {ageLabel(lastSent.sentAt)}
              </>
            ) : (
              'nenhuma ainda.'
            )}
          </p>
        </div>
        <div className="flex min-w-0 items-start gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-2">
          <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
          <p className="min-w-0 text-slate-400">
            <span className="font-semibold text-slate-200">Última bloqueada: </span>
            {lastBlock ? (
              <>
                @{lastBlock.username || 'desconhecido'} “{lastBlock.text}” — <span className="text-red-200">{lastBlock.reason}</span>{' '}
                {ageLabel(lastBlock.at)}
              </>
            ) : (
              'nenhuma.'
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
