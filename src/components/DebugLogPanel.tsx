/**
 * DebugLogPanel — console de logs categorizado com filtro, limpar e exportar.
 * Usado em StagePanel (simulação de fluxo) e CaptureStudio (diagnóstico).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Filter, Trash2, Terminal } from 'lucide-react';
import { cn } from '../lib/utils';

export type LogCategory =
  | 'captura'
  | 'ocr'
  | 'parser'
  | 'gatilho'
  | 'ia'
  | 'palco'
  | 'erro'
  | 'sistema';

export interface LogEntry {
  id: string;
  timestamp: string;
  category: LogCategory;
  message: string;
  detail?: string;
  status?: 'ok' | 'warn' | 'error' | 'info';
}

interface DebugLogPanelProps {
  entries: LogEntry[];
  onClear?: () => void;
  /** Altura fixa do painel; default: 240px */
  height?: number | string;
  className?: string;
  /** Se true, auto-scroll ao final quando entradas novas chegam */
  autoScroll?: boolean;
  title?: string;
}

const CATEGORY_STYLES: Record<
  LogCategory,
  { color: string; bg: string; label: string }
> = {
  captura: { color: 'text-sky-300', bg: 'bg-sky-500/10', label: 'CAPTURA' },
  ocr: { color: 'text-blue-300', bg: 'bg-blue-500/10', label: 'OCR' },
  parser: { color: 'text-cyan-300', bg: 'bg-cyan-500/10', label: 'PARSER' },
  gatilho: { color: 'text-amber-300', bg: 'bg-amber-500/10', label: 'GATILHO' },
  ia: { color: 'text-violet-300', bg: 'bg-violet-500/10', label: 'IA' },
  palco: { color: 'text-emerald-300', bg: 'bg-emerald-500/10', label: 'PALCO' },
  erro: { color: 'text-red-300', bg: 'bg-red-500/10', label: 'ERRO' },
  sistema: { color: 'text-slate-300', bg: 'bg-slate-500/10', label: 'SISTEMA' },
};

const STATUS_ICONS: Record<NonNullable<LogEntry['status']>, string> = {
  ok: '✓',
  warn: '⚠',
  error: '✕',
  info: '·',
};

const ALL_CATEGORIES: LogCategory[] = [
  'captura', 'ocr', 'parser', 'gatilho', 'ia', 'palco', 'erro', 'sistema',
];

/** Gera um ID de log */
export function makeLogId(): string {
  return `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Factory para criar entradas de log facilmente */
export function logEntry(
  category: LogCategory,
  message: string,
  opts: { detail?: string; status?: LogEntry['status'] } = {},
): LogEntry {
  return {
    id: makeLogId(),
    timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    category,
    message,
    detail: opts.detail,
    status: opts.status ?? 'info',
  };
}

export function DebugLogPanel({
  entries,
  onClear,
  height = 240,
  className,
  autoScroll = true,
  title = 'Console',
}: DebugLogPanelProps) {
  const [activeFilter, setActiveFilter] = useState<LogCategory | 'all'>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = activeFilter === 'all' ? entries : entries.filter((e) => e.category === activeFilter);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const exportLogs = useCallback(() => {
    const text = filtered
      .map((e) => `[${e.timestamp}] [${e.category.toUpperCase()}] ${e.message}${e.detail ? ' — ' + e.detail : ''}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `odessa-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const errorCount = entries.filter((e) => e.category === 'erro').length;

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-slate-700/50 bg-[#080a0f] overflow-hidden',
        className,
      )}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-700/40 bg-[#0d0f14] px-3 py-2">
        <Terminal className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {title}
        </span>
        {errorCount > 0 && (
          <span className="rounded-full bg-red-500/20 border border-red-500/30 px-1.5 py-0.5 text-[9px] font-bold text-red-300">
            {errorCount} erro{errorCount > 1 ? 's' : ''}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {/* Filter */}
          <div className="relative">
            <button
              onClick={() => setShowFilterMenu((v) => !v)}
              className={cn(
                'rounded p-1.5 transition hover:bg-slate-700/60',
                activeFilter !== 'all' && 'text-amber-300',
                activeFilter === 'all' && 'text-slate-500',
              )}
              title="Filtrar categoria"
            >
              <Filter className="h-3 w-3" />
            </button>
            {showFilterMenu && (
              <div className="absolute right-0 top-7 z-50 w-36 rounded-lg border border-slate-700 bg-[#13151a] py-1 shadow-xl">
                <button
                  onClick={() => { setActiveFilter('all'); setShowFilterMenu(false); }}
                  className={cn('w-full px-3 py-1.5 text-left text-[11px] hover:bg-slate-700/60', activeFilter === 'all' && 'text-amber-300')}
                >
                  Todos
                </button>
                {ALL_CATEGORIES.map((cat) => {
                  const s = CATEGORY_STYLES[cat];
                  return (
                    <button
                      key={cat}
                      onClick={() => { setActiveFilter(cat); setShowFilterMenu(false); }}
                      className={cn('w-full px-3 py-1.5 text-left text-[11px] hover:bg-slate-700/60', s.color, activeFilter === cat && 'font-bold')}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {/* Export */}
          <button
            onClick={exportLogs}
            disabled={filtered.length === 0}
            className="rounded p-1.5 text-slate-500 transition hover:bg-slate-700/60 hover:text-slate-300 disabled:opacity-30"
            title="Exportar logs"
          >
            <Download className="h-3 w-3" />
          </button>
          {/* Clear */}
          {onClear && (
            <button
              onClick={onClear}
              disabled={entries.length === 0}
              className="rounded p-1.5 text-slate-500 transition hover:bg-slate-700/60 hover:text-red-300 disabled:opacity-30"
              title="Limpar logs"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </span>
      </div>

      {/* Log list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono text-[10px]"
        style={{ height }}
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-700">
            Sem eventos{activeFilter !== 'all' ? ` na categoria "${activeFilter}"` : ''}.
          </div>
        ) : (
          filtered.map((entry) => {
            const s = CATEGORY_STYLES[entry.category];
            return (
              <div
                key={entry.id}
                className={cn(
                  'flex items-start gap-2 rounded px-2 py-0.5 group hover:bg-slate-800/40',
                  entry.status === 'error' && 'bg-red-500/5',
                )}
              >
                <span className="shrink-0 text-slate-700 w-[5.5rem]">{entry.timestamp}</span>
                <span
                  className={cn(
                    'shrink-0 w-14 rounded px-1 text-center text-[9px] font-bold',
                    s.color,
                    s.bg,
                  )}
                >
                  {s.label}
                </span>
                {entry.status && entry.status !== 'info' && (
                  <span
                    className={cn(
                      'shrink-0 font-bold',
                      entry.status === 'ok' && 'text-emerald-400',
                      entry.status === 'warn' && 'text-amber-400',
                      entry.status === 'error' && 'text-red-400',
                    )}
                  >
                    {STATUS_ICONS[entry.status]}
                  </span>
                )}
                <span className="text-slate-300 break-all">
                  {entry.message}
                  {entry.detail && (
                    <span className="text-slate-600"> — {entry.detail}</span>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
