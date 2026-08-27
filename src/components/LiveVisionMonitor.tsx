/**
 * LiveVisionMonitor — Monitor de Visão em TEMPO REAL da aba da Live do Tango.
 *
 * Diferente do monitor antigo (imagem estática com botão "atualizar"), este
 * componente mostra a mesma página da live que a bridge já controla, em fluxo
 * contínuo (auto-refresh do screenshot) e permite INTERAÇÃO direta:
 *  - Clicar em qualquer ponto da imagem → clica na coordenada real da página
 *  - Digitar texto → envia para o elemento focado da página
 *  - Teclas rápidas (Enter, Esc, Backspace, Tab)
 *  - Scroll (roda do mouse ou botões)
 *  - Navegar para URL
 *
 * Tudo passa pela MESMA página conectada pela bridge (tango_chat.py), ou seja,
 * o chat, a visão e o controle compartilham a única aba da live.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
  Delete,
  Eye,
  ExternalLink,
  Loader2,
  MousePointerClick,
  Navigation,
  RefreshCw,
  Send,
  Square,
  Terminal,
  Tv,
  Zap,
} from 'lucide-react';
import { Badge, Button, Input } from './ui';
import { cn } from '../lib/utils';

const BRIDGE_URL = '/tango-bridge';

type ViewportInfo = {
  ok?: boolean;
  w?: number;
  h?: number;
  url?: string;
  title?: string;
  error?: string;
};

type Props = {
  /** Bridge conectada à aba da live? (controla se o fluxo ao vivo fica ativo) */
  connected: boolean;
};

async function postJson<T = unknown>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BRIDGE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function LiveVisionMonitor({ connected }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [viewport, setViewport] = useState<ViewportInfo | null>(null);
  const [fps, setFps] = useState(3); // capturas por segundo
  const [streaming, setStreaming] = useState(true);
  const [shotSeq, setShotSeq] = useState(0); // incrementa p/ forçar novo fetch
  const [loadingShot, setLoadingShot] = useState(false);
  const [shotError, setShotError] = useState(false);
  const [typeText, setTypeText] = useState('');
  const [gotoUrl, setGotoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastClick, setLastClick] = useState<{ x: number; y: number } | null>(null);
  const [actionLog, setActionLog] = useState<string[]>([]);

  const logAction = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString('pt-BR');
    setActionLog((prev) => [`[${stamp}] ${line}`, ...prev].slice(0, 12));
  }, []);

  // ── Atualiza dimensões/URL do viewport ──────────────────
  const refreshViewport = useCallback(async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/viewport`);
      const data: ViewportInfo = res.ok ? await res.json() : null;
      setViewport(data);
      if (data?.url) setGotoUrl(data.url);
    } catch {
      setViewport(null);
    }
  }, []);

  useEffect(() => {
    if (!connected) {
      setViewport(null);
      return;
    }
    void refreshViewport();
    const t = window.setInterval(() => void refreshViewport(), 8000);
    return () => window.clearInterval(t);
  }, [connected, refreshViewport]);

  // ── Fluxo ao vivo: auto-refresh do screenshot ───────────
  // Usamos um timestamp na query para evitar cache e forçar nova captura.
  useEffect(() => {
    if (!connected || !streaming) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = () => {
      if (cancelled) return;
      setShotSeq((s) => s + 1);
      setLoadingShot(true);
    };

    const intervalMs = Math.max(150, Math.round(1000 / Math.max(1, fps)));
    tick();
    timer = window.setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [connected, streaming, fps]);

  const shotSrc = connected
    ? `${BRIDGE_URL}/screenshot?q=${shotSeq}&quality=${fps >= 4 ? 45 : 60}`
    : '';

  // ── Mapear clique na imagem → coordenadas reais da página ──
  const handleImageClick = useCallback(
    async (e: React.MouseEvent<HTMLImageElement>) => {
      if (!connected) return;
      const img = imgRef.current;
      if (!img || !img.naturalWidth) return;
      const rect = img.getBoundingClientRect();
      // A imagem é exibida com width:100%; height:auto — sem letterbox.
      const scaleX = img.naturalWidth / rect.width;
      const scaleY = img.naturalHeight / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      setLastClick({ x, y });
      logAction(`Clique em (${x}, ${y})`);
      await postJson('/click', { x, y, button: 'left', clickCount: e.detail > 1 ? 2 : 1 });
    },
    [connected, logAction]
  );

  // ── Scroll com a roda do mouse sobre a imagem ────────────
  const handleWheel = useCallback(
    async (e: React.WheelEvent<HTMLImageElement>) => {
      if (!connected) return;
      const img = imgRef.current;
      if (!img || !img.naturalWidth) return;
      const rect = img.getBoundingClientRect();
      const scaleX = img.naturalWidth / rect.width;
      const scaleY = img.naturalHeight / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      await postJson('/scroll', { x, y, deltaY: e.deltaY });
    },
    [connected]
  );

  // ── Ações de teclado / digitação ─────────────────────────
  const handleSendType = useCallback(async () => {
    const text = typeText.trim();
    if (!text || !connected) return;
    setBusy(true);
    logAction(`Digitou: "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`);
    await postJson('/type', { text });
    setTypeText('');
    setBusy(false);
  }, [typeText, connected, logAction]);

  const handleKey = useCallback(
    async (key: string, label?: string) => {
      if (!connected) return;
      setBusy(true);
      logAction(`Tecla: ${label || key}`);
      await postJson('/key', { key });
      setBusy(false);
    },
    [connected, logAction]
  );

  const handleScrollBtn = useCallback(
    async (dir: 'up' | 'down') => {
      if (!connected) return;
      const delta = dir === 'down' ? 600 : -600;
      logAction(`Scroll ${dir}`);
      await postJson('/scroll', { x: 0, y: 0, deltaY: delta });
    },
    [connected, logAction]
  );

  const handleGoto = useCallback(async () => {
    const url = gotoUrl.trim();
    if (!url || !connected) return;
    setBusy(true);
    logAction(`Navegou para: ${url}`);
    await postJson('/goto', { url });
    setBusy(false);
    setTimeout(() => void refreshViewport(), 1200);
  }, [gotoUrl, connected, logAction, refreshViewport]);

  const handleManualRefresh = useCallback(() => {
    setShotSeq((s) => s + 1);
    setLoadingShot(true);
  }, []);

  const live = connected && streaming;

  return (
    <div className="space-y-3">
      {/* ── Cabeçalho / Status ─────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0c0e12] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
            <Tv className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">Monitor de Visão ao Vivo</h3>
              <span
                className={cn(
                  'flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border',
                  live
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : connected
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      : 'border-white/10 bg-black/40 text-slate-500'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-400 animate-ping' : 'bg-slate-500')} />
                {live ? 'Ao Vivo' : connected ? 'Pausado' : 'Desconectado'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 max-w-xl leading-relaxed">
              {viewport?.url ? (
                <span className="truncate inline-block max-w-full align-bottom">
                  {viewport.title || 'Página'} · <span className="text-slate-500">{viewport.url}</span>
                </span>
              ) : (
                'A mesma aba da live que a bridge controla — chat, visão e controle em uma página só.'
              )}
            </p>
          </div>
        </div>

        {/* Controles de fluxo */}
        <div className="flex flex-wrap items-center gap-2">
          {/* FPS */}
          <div className="flex items-center rounded-xl border border-white/10 bg-black/40 p-1">
            {[
              { v: 1, l: '1 fps' },
              { v: 3, l: '3 fps' },
              { v: 5, l: '5 fps' },
            ].map((o) => (
              <button
                key={o.v}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-semibold transition',
                  fps === o.v ? 'bg-white/15 text-white shadow' : 'text-slate-500 hover:text-slate-300'
                )}
                onClick={() => setFps(o.v)}
                title={`${o.v} capturas por segundo`}
              >
                {o.l}
              </button>
            ))}
          </div>

          {connected && (
            <Button
              size="sm"
              variant={streaming ? 'secondary' : 'primary'}
              onClick={() => setStreaming((s) => !s)}
              title={streaming ? 'Pausar fluxo ao vivo' : 'Retomar fluxo ao vivo'}
            >
              {streaming ? <Square className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
              {streaming ? 'Pausar' : 'Ao Vivo'}
            </Button>
          )}

          <Button size="sm" variant="secondary" onClick={handleManualRefresh} title="Capturar um único frame agora">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Tela ao vivo + overlay de interação ────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/60 shadow-xl">
        {/* Container com a proporção do viewport (evita saltos de layout) */}
        <div
          className="relative w-full"
          style={{ aspectRatio: viewport?.w && viewport?.h ? `${viewport.w} / ${viewport.h}` : '16 / 9' }}
        >
          {connected ? (
            <img
              ref={imgRef}
              src={shotSrc}
              alt="Visão ao vivo da Live"
              draggable={false}
              onClick={handleImageClick}
              onWheel={handleWheel}
              onLoad={() => {
                setLoadingShot(false);
                setShotError(false);
              }}
              onError={() => {
                setShotError(true);
                setLoadingShot(false);
              }}
              className={cn(
                'absolute inset-0 h-full w-full select-none transition-opacity',
                'object-contain',
                live ? 'cursor-crosshair' : 'cursor-default'
              )}
              style={{ opacity: shotError ? 0.2 : 1 }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
              <Eye className="h-12 w-12 text-slate-700 mb-3" />
              <p className="text-sm font-semibold text-slate-400">Nenhuma página conectada</p>
              <p className="text-xs text-slate-600 mt-1 max-w-sm">
                Inicie a bridge e acople à aba da live na aba <strong>Cockpit</strong> ou no
                <strong> Assistente</strong>. A visão ao vivo aparece aqui automaticamente.
              </p>
            </div>
          )}

          {/* Indicador "AO VIVO" */}
          {live && (
            <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1 backdrop-blur">
              <span className="h-2 w-2 animate-ping rounded-full bg-red-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">Ao Vivo</span>
            </div>
          )}

          {/* Spinner de carregamento do frame */}
          {loadingShot && connected && !shotError && (
            <div className="pointer-events-none absolute bottom-3 right-3">
              <Loader2 className="h-4 w-4 animate-spin text-white/50" />
            </div>
          )}

          {/* Marca do último clique */}
          {lastClick && live && (
            <div
              className="pointer-events-none absolute z-10"
              style={{
                left: `calc(${(lastClick.x / (viewport?.w || 1280)) * 100}% )`,
                top: `calc(${(lastClick.y / (viewport?.h || 720)) * 100}% )`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <span className="block h-4 w-4 rounded-full border-2 border-emerald-400 bg-emerald-400/20 animate-ping" />
            </div>
          )}

          {/* Erro de captura */}
          {shotError && connected && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
              <p className="text-xs text-amber-400">Falha ao capturar a página. A bridge pode estar reconectando…</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={handleManualRefresh}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Tentar novamente
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Barra de interação: digitar, teclas, scroll ────── */}
      {connected && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Digitar na página */}
          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              <MousePointerClick className="h-3.5 w-3.5 text-sky-400" /> Digitar na Página
            </div>
            <div className="flex gap-2">
              <Input
                value={typeText}
                onChange={(e) => setTypeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSendType();
                }}
                placeholder="Texto para o campo focado da live…"
                className="h-9 flex-1 text-xs"
              />
              <Button size="sm" variant="primary" disabled={busy || !typeText.trim()} onClick={() => void handleSendType()}>
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[10px] text-slate-600">
              Clique primeiro no campo desejado na imagem ao lado para focá-lo, depois digite.
            </p>
          </div>

          {/* Teclas rápidas + scroll */}
          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              <Terminal className="h-3.5 w-3.5 text-violet-400" /> Teclas &amp; Scroll
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleKey('Enter', 'Enter')}>
                <CornerDownLeft className="h-3.5 w-3.5" /> Enter
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleKey('Escape', 'Esc')}>
                Esc
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleKey('Backspace', 'Backspace')}>
                <Delete className="h-3.5 w-3.5" /> Backspace
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleKey('Tab', 'Tab')}>
                Tab
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleScrollBtn('up')}>
                <ArrowUp className="h-3.5 w-3.5" /> Scroll
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleScrollBtn('down')}>
                <ArrowDown className="h-3.5 w-3.5" /> Scroll
              </Button>
            </div>
          </div>

          {/* Navegar para URL */}
          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              <Navigation className="h-3.5 w-3.5 text-emerald-400" /> Navegar
            </div>
            <div className="flex gap-2">
              <Input
                value={gotoUrl}
                onChange={(e) => setGotoUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleGoto();
                }}
                placeholder="https://tango.me/stream/broadcast"
                className="h-9 flex-1 text-xs"
              />
              <Button size="sm" variant="primary" disabled={busy || !gotoUrl.trim()} onClick={() => void handleGoto()}>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
            {viewport?.w ? (
              <Badge variant="default" className="text-[10px]">
                Viewport {viewport.w}×{viewport.h}
              </Badge>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Log de ações (mini) ────────────────────────────── */}
      {connected && actionLog.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">
            <Eye className="h-3.5 w-3.5" /> Interações recentes
          </div>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {actionLog.map((line, i) => (
              <p key={i} className="text-[11px] font-mono text-slate-500">{line}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
