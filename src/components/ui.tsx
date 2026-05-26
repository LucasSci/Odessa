import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export function Button({
  children,
  variant = 'default',
  size = 'md',
  loading,
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'icon';
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[22px] border font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40 disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-[38px] px-4 text-[13px]',
        size === 'icon' && 'h-9 w-9 px-0',
        variant === 'default' && 'border-[var(--border2)] bg-[var(--bg3)] text-[var(--t1)] hover:bg-[var(--bg4)]',
        variant === 'primary' &&
          'border-transparent bg-[image:var(--grad-live)] text-[#051018] shadow-[var(--shadow-live)] hover:brightness-105',
        variant === 'secondary' &&
          'border-[var(--border2)] bg-[var(--bg2)] text-[var(--t1)] hover:border-[var(--gold)]/45',
        variant === 'ghost' && 'border-transparent bg-transparent text-[var(--t2)] hover:bg-[var(--bg3)] hover:text-[var(--t1)]',
        variant === 'danger' && 'border-red-400/25 bg-red-500/10 text-red-300 hover:bg-red-500/15',
        variant === 'success' && 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15',
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[34px] border border-[var(--border2)] bg-[var(--bg2)] shadow-[0_16px_50px_rgba(0,0,0,0.36)]',
        className,
      )}
      {...props}
    />
  );
}

export function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[34px] border border-[var(--border2)] bg-[rgba(21,21,26,0.76)] shadow-[0_16px_50px_rgba(0,0,0,0.36)] backdrop-blur-xl',
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  children,
  variant = 'default',
  className,
}: {
  children: ReactNode;
  variant?: 'default' | 'gold' | 'lavender' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]',
        variant === 'default' && 'border-[var(--border2)] bg-[var(--bg3)] text-[var(--t2)]',
        variant === 'gold' && 'border-[var(--gold)]/30 bg-[var(--gold)]/10 text-[var(--gold)]',
        variant === 'lavender' && 'border-[var(--rose)]/30 bg-[var(--rose)]/10 text-[var(--rose)]',
        variant === 'success' && 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300',
        variant === 'warning' && 'border-amber-400/30 bg-amber-500/10 text-amber-300',
        variant === 'danger' && 'border-red-400/30 bg-red-500/10 text-red-300',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({
  status = 'idle',
  pulse,
}: {
  status?: 'online' | 'idle' | 'warn' | 'error';
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        status === 'online' && 'bg-[var(--green)]',
        status === 'idle' && 'bg-[var(--gold)]',
        status === 'warn' && 'bg-amber-400',
        status === 'error' && 'bg-red-400',
        pulse && 'animate-pulse',
      )}
    />
  );
}

export function Input({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
          {label}
        </span>
      )}
      <input
        className={cn(
          'h-10 w-full rounded-2xl border border-[var(--border2)] bg-[var(--bg3)] px-3 text-sm text-[var(--t1)] outline-none transition placeholder:text-[var(--t3)] focus:border-[var(--gold)]',
          className,
        )}
        {...props}
      />
    </label>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-2xl bg-[var(--bg3)]', className)} />;
}

/**
 * Tooltip simples — envolve qualquer elemento e exibe uma dica no hover.
 * Usa CSS puro (title não é suficiente para estilização customizada).
 */
export function Tooltip({
  children,
  content,
  className,
}: {
  children: ReactNode;
  content: string;
  className?: string;
}) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      {children}
      <span
        className={cn(
          'pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5',
          '-translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--border2)]',
          'bg-[#13151a] px-2.5 py-1.5 text-[10px] font-medium text-[var(--t1)] shadow-xl',
          'opacity-0 scale-95 transition-all duration-150 group-hover:opacity-100 group-hover:scale-100',
        )}
      >
        {content}
      </span>
    </span>
  );
}

/**
 * ConfirmButton — botão que pede confirmação antes de executar ação destrutiva.
 * Primeiro clique mostra estado "Tem certeza?", segundo confirma.
 */
export function ConfirmButton({
  children,
  confirmLabel = 'Confirmar',
  onConfirm,
  className,
  disabled,
  loading,
  size = 'md',
  variant = 'default',
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  confirmLabel?: string;
  onConfirm: () => void;
  loading?: boolean;
  size?: 'sm' | 'md' | 'icon';
  variant?: 'default' | 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
}) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    if (confirming) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setConfirming(false);
      onConfirm();
    } else {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), 3000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[22px] border',
        'font-semibold transition focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-[38px] px-4 text-[13px]',
        size === 'icon' && 'h-9 w-9 px-0',
        confirming
          ? 'border-red-400/40 bg-red-500/20 text-red-300 animate-pulse'
          : variant === 'danger'
            ? 'border-red-400/25 bg-red-500/10 text-red-300 hover:bg-red-500/15'
            : variant === 'primary'
              ? 'border-transparent bg-[image:var(--grad-live)] text-[#051018] shadow-[var(--shadow-live)]'
              : 'border-[var(--border2)] bg-[var(--bg3)] text-[var(--t1)] hover:bg-[var(--bg4)]',
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {confirming ? confirmLabel : children}
    </button>
  );
}

import { useRef, useState } from 'react';
