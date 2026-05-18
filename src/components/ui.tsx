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
        'inline-flex items-center justify-center gap-2 border text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--sky)]/30 disabled:cursor-not-allowed disabled:opacity-55',
        'rounded-[var(--r-xl)]',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-10 px-4',
        size === 'icon' && 'h-9 w-9 px-0',
        variant === 'default' && 'border-[var(--border2)] bg-[var(--bg3)] text-[var(--t1)] hover:bg-[var(--bg4)] hover:border-[var(--border3)]',
        variant === 'primary' &&
          'border-transparent text-[#051018] hover:brightness-105',
        variant === 'secondary' &&
          'border-[var(--border2)] bg-[var(--bg2)] text-[var(--t1)] hover:border-[rgba(125,211,252,0.45)]',
        variant === 'ghost' && 'border-transparent bg-transparent text-[var(--t2)] hover:bg-[var(--bg3)] hover:text-[var(--t1)]',
        variant === 'danger' && 'border-red-400/25 bg-red-500/10 text-[#fca5a5] hover:bg-red-500/15',
        variant === 'success' && 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15',
        className,
      )}
      style={variant === 'primary' ? {
        background: 'var(--grad-live)',
        boxShadow: 'var(--shadow-live)',
      } : undefined}
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
      className={cn('odessa-panel', className)}
      {...props}
    />
  );
}

export function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--r-3xl)] border border-[var(--border2)] shadow-xl backdrop-blur-xl',
        className,
      )}
      style={{ background: 'rgba(21,21,26,0.76)' }}
      {...props}
    />
  );
}

export function Badge({
  children,
  variant = 'default',
  dot,
  className,
}: {
  children: ReactNode;
  variant?: 'default' | 'gold' | 'lavender' | 'sky' | 'rose' | 'success' | 'warning' | 'danger' | 'lime';
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]',
        variant === 'default' && 'border-[var(--border2)] bg-[var(--bg3)] text-[var(--t2)]',
        (variant === 'gold' || variant === 'sky') && 'border-[var(--sky)]/30 bg-[var(--sky)]/10 text-[var(--sky)]',
        (variant === 'lavender' || variant === 'rose') && 'border-[var(--rose)]/30 bg-[var(--rose)]/10 text-[var(--rose)]',
        variant === 'success' && 'border-emerald-400/30 bg-emerald-500/10 text-[var(--green)]',
        variant === 'warning' && 'border-amber-400/30 bg-amber-500/10 text-[var(--amber)]',
        variant === 'danger' && 'border-red-400/30 bg-red-500/10 text-[var(--red)]',
        variant === 'lime' && 'border-[var(--lime)]/30 bg-[var(--lime)]/10 text-[var(--lime)]',
        className,
      )}
    >
      {dot && <span className="h-[5px] w-[5px] rounded-full bg-current" />}
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
        status === 'idle' && 'bg-[var(--sky)]',
        status === 'warn' && 'bg-[var(--amber)]',
        status === 'error' && 'bg-[var(--red)]',
      )}
      style={pulse ? {
        animation: `${status === 'online' ? 'pulse-green' : 'pulse-sky'} 1.8s ease-out infinite`,
      } : undefined}
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
          'h-10 w-full rounded-[var(--r-2xl)] border border-[var(--border2)] bg-[var(--bg3)] px-3.5 text-sm text-[var(--t1)] outline-none transition placeholder:text-[var(--t3)] focus:border-[var(--sky)] focus:shadow-[0_0_0_3px_rgba(125,211,252,0.18)]',
          className,
        )}
        {...props}
      />
    </label>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-[var(--r-2xl)] bg-[var(--bg3)]', className)} />;
}
