import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import OdessaLiveCenter, { type AdvancedPanel } from './OdessaLiveCenter';
import PersonaOverlay from './PersonaOverlay';
import { getRecentEvents, replaceEvents } from './core/eventBus';
import { useAutopilotRuntime } from './core/useAutopilotRuntime';
import { cn } from './lib/utils';
import type { CapturedMessage } from './types';

function getPanelFromHash(): AdvancedPanel {
  if (window.location.hash === '#capture') return 'capture';
  if (window.location.hash === '#persona') return 'persona';
  if (window.location.hash === '#content') return 'content';
  if (window.location.hash === '#runtime') return 'runtime';
  if (window.location.hash === '#overlay') return 'overlay' as any;
  return 'overview';
}

export default function App() {
  const [requestedPanel, setRequestedPanel] = useState<AdvancedPanel>(() => getPanelFromHash());
  const [capturedText, setCapturedTextState] = useState<CapturedMessage[]>(() => getRecentEvents());

  const setCapturedText = useCallback<Dispatch<SetStateAction<CapturedMessage[]>>>((value) => {
    setCapturedTextState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      return replaceEvents(next);
    });
  }, []);

  const runtime = useAutopilotRuntime({ capturedText, setCapturedText });

  useEffect(() => {
    const handleHashChange = () => setRequestedPanel(getPanelFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const pendingCount = runtime.currentRoundEvents.length || runtime.pendingEvents.length;
  const health = runtime.health;

  if (requestedPanel === ('overlay' as any)) {
    return <PersonaOverlay />;
  }

  return (
    <div className="app flex h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--t1)]">
      {/* ── SIDEBAR ── */}
      <aside className="sidebar flex w-[220px] flex-col border-r border-[var(--border)] bg-[var(--bg1)]">
        <div className="sidebar-top border-b border-[var(--border)] p-5 pb-4">
          <div className="logo-wrap mb-5 flex items-center gap-2.5">
            <div className="logo flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7c6ff7] to-[#f472b6] text-sm font-semibold text-white shadow-[0_0_20px_rgba(124,111,247,0.4)]">
              O
            </div>
            <div className="logo-text flex flex-col">
              <span className="logo-name text-sm font-semibold tracking-tight text-[var(--t1)]">
                Odessa
              </span>
              <span className="logo-sub text-[10px] text-[var(--t3)]">Live Studio</span>
            </div>
          </div>

          <div className="live-status rounded-xl border border-[var(--border2)] bg-[var(--bg3)] p-3 px-3.5">
            <div className="live-status-head mb-2 flex items-center justify-between">
              <span className="live-label text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
                Persona ativa
              </span>
              <span className="live-indicator flex items-center gap-1.5 text-xs font-medium text-[var(--green)]">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--green)] animate-[pulse-green_2s_ease-in-out_infinite]"></span>
                Pronta
              </span>
            </div>
            <div className="live-name text-sm font-semibold text-[var(--t1)]">Juju</div>
            <div className="live-meta text-[11px] text-[var(--t3)]">Edge · pt-BR · 1.0×</div>
          </div>
        </div>

        <nav className="nav flex-1 overflow-y-auto p-2.5 px-2">
          <div className="nav-section-label mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
            Principal
          </div>
          <NavItem
            active={requestedPanel === 'overview'}
            icon="⚡"
            label="Studio"
            onClick={() => (window.location.hash = '')}
          />
          <NavItem icon="📡" label="Sinais" onClick={() => (window.location.hash = 'capture')} />
          <NavItem
            icon="🎭"
            label="Persona"
            badge={3}
            onClick={() => (window.location.hash = 'persona')}
          />

          <div className="nav-section-label mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
            Conteúdo
          </div>
          <NavItem icon="📋" label="Roteiro" onClick={() => (window.location.hash = 'content')} />
          <NavItem
            icon="🔊"
            label="Voz & Chat"
            onClick={() => (window.location.hash = 'persona')}
          />
          <NavItem icon="🎬" label="Ações" onClick={() => (window.location.hash = 'runtime')} />

          <div className="nav-section-label mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
            Operação
          </div>
          <NavItem
            icon="📷"
            label="Captura OCR"
            onClick={() => (window.location.hash = 'capture')}
          />
          <NavItem icon="🤖" label="Runtime" onClick={() => (window.location.hash = 'runtime')} />
          <NavItem icon="📊" label="Auditoria" onClick={() => (window.location.hash = 'runtime')} />
        </nav>

        <div className="health-strip border-t border-[var(--border)] p-4 pb-5">
          <div className="health-strip-label mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--t3)]">
            Saúde do sistema
          </div>
          <div className="health-items flex flex-col gap-1.5">
            <HealthRow name="Backend" status={health?.status === 'ok' ? 'ok' : 'err'} />
            <HealthRow name="OCR" status={health?.ocr === 'ready' ? 'ok' : 'warn'} />
            <HealthRow name="IA · Gemini" status={health?.gemini_configured ? 'ok' : 'err'} />
            <HealthRow name="TTS · Edge" status="ok" />
            <HealthRow name="N8N Bridge" status={health?.n8n?.online ? 'ok' : 'warn'} />
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="main flex flex-1 flex-col overflow-hidden">
        {/* TOPBAR */}
        <header className="topbar flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg1)] px-6">
          <div className="topbar-left flex items-center gap-1.5">
            <span className="page-title text-sm font-semibold text-[var(--t1)]">Studio</span>
            <span className="page-sep text-[var(--t3)]">/</span>
            <span className="page-sub text-xs text-[var(--t2)]">Visão geral da live</span>
          </div>
          <div className="topbar-right flex items-center gap-2">
            <div className="pill inline-flex items-center gap-1 rounded-full border border-[var(--border2)] bg-[var(--bg3)] px-2.5 py-1 text-[11px] text-[var(--t2)]">
              <span className="pdot h-1 w-1 rounded-full bg-[var(--t3)]"></span>
              {capturedText.length} eventos
            </div>
            <div className="pill inline-flex items-center gap-1 rounded-full border border-[var(--border2)] bg-[var(--bg3)] px-2.5 py-1 text-[11px] text-[var(--t2)]">
              <span className="pdot h-1 w-1 rounded-full bg-[var(--t3)]"></span>
              {pendingCount} na rodada
            </div>
            <div className="pill inline-flex items-center gap-1 rounded-full border border-[var(--border2)] bg-[var(--bg3)] px-2.5 py-1 text-[11px] text-[var(--t2)]">
              <span
                className={cn(
                  'pdot h-1 w-1 rounded-full',
                  runtime.autopilotEnabled ? 'bg-[var(--green)]' : 'bg-[var(--amber)]',
                )}
              ></span>
              {runtime.autopilotEnabled ? 'ativa' : 'pausada'}
            </div>
            <button className="btn btn-sm btn-ghost ml-1">Modo teste</button>
            <button
              onClick={runtime.autopilotEnabled ? runtime.pause : runtime.start}
              className="btn btn-accent btn-sm"
            >
              {runtime.autopilotEnabled ? '⏸ Pausar Live' : '▶ Iniciar Live'}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          <OdessaLiveCenter
            key={requestedPanel}
            capturedText={capturedText}
            setCapturedText={setCapturedText}
            runtime={runtime}
            requestedPanel={requestedPanel}
          />
        </div>
      </main>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'nav-item mb-px flex cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-xs font-medium transition-all duration-150',
        active
          ? 'active bg-[var(--bg3)] text-[var(--t1)] border-[var(--border2)]'
          : 'text-[var(--t2)] hover:bg-[var(--bg3)] hover:text-[var(--t1)]',
      )}
    >
      <span className={cn('nav-icon w-4.5 text-center text-sm', active && 'text-[var(--accent)]')}>
        {icon}
      </span>
      <span>{label}</span>
      {badge && (
        <span className="nav-badge ml-auto rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] text-white">
          {badge}
        </span>
      )}
    </div>
  );
}

function HealthRow({ name, status }: { name: string; status: 'ok' | 'warn' | 'err' }) {
  const colorClass = {
    ok: 'text-[var(--green)]',
    warn: 'text-[var(--amber)]',
    err: 'text-[var(--red)]',
  }[status];

  return (
    <div className="health-row flex items-center justify-between">
      <span className="health-name text-[11px] text-[var(--t2)]">{name}</span>
      <span className={cn('health-val text-[11px] font-medium', colorClass)}>{status}</span>
    </div>
  );
}
