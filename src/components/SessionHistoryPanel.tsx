/**
 * SessionHistoryPanel — Histórico da Live.
 *
 * Lista tudo que aconteceu durante a live (mensagens, presentes, gatilhos,
 * vídeos gerados, respostas de IA) e permite exportar em JSON ou CSV.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  FileJson,
  FileSpreadsheet,
  History,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  exportSessionHistory,
  fetchSessionHistory,
  fetchSessions,
  type SessionEvent,
  type SessionInfo,
} from '../core/sessionHistory';

const TYPE_LABELS: Record<string, string> = {
  'session.started': 'Sessão iniciada',
  'session.ended': 'Sessão encerrada',
  'chat.received': 'Mensagem recebida',
  'gift.received': 'Presente recebido',
  'trigger.fired': 'Gatilho disparado',
  'video.generated': 'Vídeo gerado',
  'ai.reply': 'Resposta IA',
  'ai.reply.sent': 'Resposta IA enviada',
  'message.sent': 'Mensagem enviada',
};

const TYPE_COLORS: Record<string, string> = {
  'session.started': 'bg-slate-500/20 text-slate-300',
  'session.ended': 'bg-slate-500/20 text-slate-300',
  'chat.received': 'bg-sky-500/20 text-sky-300',
  'gift.received': 'bg-amber-500/20 text-amber-300',
  'trigger.fired': 'bg-violet-500/20 text-violet-300',
  'video.generated': 'bg-emerald-500/20 text-emerald-300',
  'ai.reply': 'bg-fuchsia-500/20 text-fuchsia-300',
  'ai.reply.sent': 'bg-emerald-500/20 text-emerald-300',
  'message.sent': 'bg-cyan-500/20 text-cyan-300',
};

function eventSummary(e: SessionEvent): string {
  const d = e.data as Record<string, any>;
  switch (e.type) {
    case 'chat.received':
      return `${d.user ?? 'desconhecido'}: ${d.text ?? ''}`;
    case 'gift.received':
      return `${d.sender ?? 'desconhecido'} enviou ${d.giftName ?? 'presente'}${d.quantity && d.quantity > 1 ? ` x${d.quantity}` : ''}`;
    case 'trigger.fired': {
      const matches = Array.isArray(d.matches) ? d.matches : [];
      const names = matches.map((m: any) => m.name ?? m.triggerName ?? m.id).filter(Boolean);
      return `Evento ${d.eventKind ?? ''} → ${names.join(', ') || 'sem gatilho'}`;
    }
    case 'video.generated':
      return d.ok ? `Vídeo ${d.videoId ?? ''} gerado` : `Falha: ${d.error ?? 'erro'}`;
    case 'ai.reply':
      return `${d.username ?? 'desconhecido'} → ${d.reply ?? ''}`;
    case 'ai.reply.sent':
      return `${d.username ?? 'desconhecido'} → ${d.reply ?? ''}`;
    case 'message.sent':
      return d.text ?? '';
    default:
      return JSON.stringify(d);
  }
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

export function SessionHistoryPanel({ active }: { active: boolean }) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [hist, sess] = await Promise.all([
      fetchSessionHistory({ sessionId: selectedSession || undefined, type: typeFilter || undefined, limit: 500 }),
      fetchSessions(),
    ]);
    if (hist) setEvents(hist.events);
    if (sess) setSessions(sess);
    setLoading(false);
  }, [selectedSession, typeFilter]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  const summary = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
    return byType;
  }, [events]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(e.type);
    return Array.from(set).sort();
  }, [events]);

  const handleExport = async (format: 'json' | 'csv') => {
    setExporting(format);
    await exportSessionHistory(format, selectedSession || undefined);
    setExporting(null);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-[#0c0e12] p-5 shadow-xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-violet-400" />
          <h3 className="text-sm font-bold text-white">Histórico da Live</h3>
          <span className="text-[11px] text-slate-500">({events.length} eventos)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Atualizar
          </button>
          <button
            onClick={() => void handleExport('json')}
            disabled={exporting !== null}
            className="flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/15 px-2.5 py-1.5 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/25"
          >
            {exporting === 'json' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileJson className="h-3.5 w-3.5" />}
            Exportar JSON
          </button>
          <button
            onClick={() => void handleExport('csv')}
            disabled={exporting !== null}
            className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
          >
            {exporting === 'csv' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedSession}
          onChange={(e) => setSelectedSession(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-slate-300 outline-none"
        >
          <option value="">Sessão ativa</option>
          {sessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.sessionId} ({s.eventCount} eventos)
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-slate-300 outline-none"
        >
          <option value="">Todos os tipos</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      </div>

      {/* Resumo */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(summary).map(([type, count]) => (
          <div
            key={type}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold',
              TYPE_COLORS[type] ?? 'bg-slate-500/20 text-slate-300',
            )}
          >
            {TYPE_LABELS[type] ?? type}
            <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px]">{count}</span>
          </div>
        ))}
        {Object.keys(summary).length === 0 && (
          <span className="text-[11px] text-slate-600">Nenhum evento registrado ainda.</span>
        )}
      </div>

      {/* Lista de eventos */}
      <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Download className="mb-2 h-8 w-8 opacity-30 text-slate-600" />
            <p className="text-xs font-semibold text-slate-500">Nenhum evento no histórico</p>
            <p className="mt-1 max-w-xs text-[11px] text-slate-600">
              Mensagens, presentes, gatilhos, vídeos gerados e respostas de IA aparecerão aqui durante a live.
            </p>
          </div>
        )}
        {events.map((e) => (
          <div
            key={e.id}
            className="flex items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2"
          >
            <span className="mt-0.5 shrink-0 text-[10px] font-mono text-slate-500">
              {formatTime(e.timestamp)}
            </span>
            <span
              className={cn(
                'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                TYPE_COLORS[e.type] ?? 'bg-slate-500/20 text-slate-300',
              )}
            >
              {TYPE_LABELS[e.type] ?? e.type}
            </span>
            <span className="min-w-0 flex-1 break-words text-xs text-slate-300">
              {eventSummary(e)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
