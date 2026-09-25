import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  kind?: ToastKind;
  /** ms até sumir sozinho; 0 = fica até ser fechado. Erros duram mais por padrão. */
  durationMs?: number;
  /** Botão no próprio aviso (ex.: "Desfazer"); clicar executa e fecha o aviso. */
  action?: ToastAction;
}

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

interface ToastApi {
  toast: (message: string, options?: ToastOptions) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const MAX_VISIBLE = 4;
const DEFAULT_DURATION: Record<ToastKind, number> = { success: 3500, info: 4000, warning: 6000, error: 8000 };

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLE: Record<ToastKind, { icon: typeof Info; box: string; icon_: string }> = {
  success: { icon: CheckCircle2, box: 'border-emerald-400/30', icon_: 'text-emerald-300' },
  info: { icon: Info, box: 'border-sky-400/30', icon_: 'text-sky-300' },
  warning: { icon: AlertTriangle, box: 'border-amber-400/30', icon_: 'text-amber-300' },
  error: { icon: XCircle, box: 'border-red-400/35', icon_: 'text-red-300' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const kind = options.kind ?? 'info';
      const id = nextId.current++;
      setItems((prev) => [...prev, { id, message, kind, action: options.action }].slice(-MAX_VISIBLE));
      // Aviso com ação fica um pouco mais, para dar tempo de clicar em "Desfazer".
      const duration = options.durationMs ?? (options.action ? Math.max(DEFAULT_DURATION[kind], 7000) : DEFAULT_DURATION[kind]);
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (message) => toast(message, { kind: 'success' }),
      error: (message) => toast(message, { kind: 'error' }),
      warning: (message) => toast(message, { kind: 'warning' }),
      info: (message) => toast(message, { kind: 'info' }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
      >
        {items.map((item) => {
          const style = KIND_STYLE[item.kind];
          const Icon = style.icon;
          return (
            <div
              key={item.id}
              role={item.kind === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 rounded-2xl border bg-[var(--bg2)] px-3.5 py-3 text-[13px] text-[var(--t1)] shadow-[var(--shadow-3)] anim-slide-in',
                style.box,
              )}
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.icon_)} />
              <span className="min-w-0 flex-1 break-words">{item.message}</span>
              {item.action && (
                <button
                  type="button"
                  onClick={() => {
                    item.action?.onClick();
                    dismiss(item.id);
                  }}
                  className="shrink-0 rounded-lg border border-white/15 px-2 py-0.5 text-[12px] font-semibold text-[var(--t1)] transition hover:bg-white/10"
                >
                  {item.action.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Fechar aviso"
                className="shrink-0 rounded-md p-0.5 text-[var(--t3)] transition hover:text-[var(--t1)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Fora do provider devolve no-ops, para componentes continuarem testáveis isolados. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  const noop = () => {};
  return { toast: noop, success: noop, error: noop, warning: noop, info: noop };
}
