/**
 * LiveVisionMonitor — Compartilhamento de tela EM TEMPO REAL da aba da Live.
 *
 * Usa um WebSocket (/tango-bridge/live) que roda o CDP Screencast do Chrome:
 * frames de vídeo só são enviados quando a página muda — exatamente como um
 * Chrome Remote Desktop, mas para a aba da live. A interação (clique, digitação,
 * scroll, teclas) é repassada via CDP Input.dispatch* pelo mesmo WebSocket, então
 * você opera a página real como se ela estivesse ali mesma.
 *
 * Tudo passa pela MESMA página conectada pela bridge (tango_chat.py): o chat,
 * a visão e o controle compartilham a única aba da live.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
  Delete,
  Eye,
  ExternalLink,
  Keyboard,
  Loader2,
  Maximize2,
  MousePointerClick,
  Navigation,
  Radio,
  RefreshCw,
  Send,
  Square,
  Tv,
} from 'lucide-react';
import { Badge, Button, Input } from './ui';
import { cn } from '../lib/utils';

const BRIDGE_URL = '/tango-bridge';
// WebSocket usa protocolo ws:// (o proxy do Vite sobe o upgrade).
function liveWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/tango-bridge/live`;
}

type Props = {
  /** Bridge conectada à aba da live? (controla se o stream fica ativo) */
  connected: boolean;
};

// Códigos de tecla especiais enviados para o CDP (JS key -> label do botão).
const QUICK_KEYS: { key: string; label: string; icon?: React.ReactNode }[] = [
  { key: 'Enter', label: 'Enter', icon: <CornerDownLeft className="h-3.5 w-3.5" /> },
  { key: 'Backspace', label: 'Backspace', icon: <Delete className="h-3.5 w-3.5" /> },
  { key: 'Tab', label: 'Tab' },
  { key: 'Escape', label: 'Esc' },
  { key: 'ArrowUp', label: '↑', icon: <ArrowUp className="h-3.5 w-3.5" /> },
  { key: 'ArrowDown', label: '↓', icon: <ArrowDown className="h-3.5 w-3.5" /> },
];

export function LiveVisionMonitor({ connected }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const viewportRef = useRef<{ w: number; h: number }>({ w: 1280, h: 720 });

  const [streaming, setStreaming] = useState(true);
  const [live, setLive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [pageUrl, setPageUrl] = useState('');
  const [pageMeta, setPageMeta] = useState<{ w: number; h: number } | null>(null);
  const [typeText, setTypeText] = useState('');
  const [gotoUrl, setGotoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastClick, setLastClick] = useState<{ x: number; y: number } | null>(null);
  const [actionLog, setActionLog] = useState<string[]>([]);

  const logAction = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString('pt-BR');
    setActionLog((prev) => [`[${stamp}] ${line}`, ...prev].slice(0, 12));
  }, []);

  const sendWs = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  // ── Mapear coordenadas do display -> pixels CSS do viewport ──
  const mapToPage = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    // object-fit: contain → calcula o offset da imagem dentro do canvas.
    const vp = viewportRef.current;
    const canvasAR = rect.width / rect.height;
    const imgAR = vp.w / vp.h;
    let dispW = rect.width;
    let dispH = rect.height;
    let offX = 0;
    let offY = 0;
    if (imgAR > canvasAR) {
      dispW = rect.width;
      dispH = rect.width / imgAR;
      offY = (rect.height - dispH) / 2;
    } else {
      dispH = rect.height;
      dispW = rect.height * imgAR;
      offX = (rect.width - dispW) / 2;
    }
    const relX = clientX - rect.left - offX;
    const relY = clientY - rect.top - offY;
    if (relX < 0 || relY < 0 || relX > dispW || relY > dispH) return null;
    return {
      x: Math.round((relX / dispW) * vp.w),
      y: Math.round((relY / dispH) * vp.h),
    };
  }, []);

  // ── Conexão WebSocket + render dos frames ──────────────
  useEffect(() => {
    if (!connected || !streaming) {
      wsRef.current?.close();
      wsRef.current = null;
      setLive(false);
      return;
    }

    let cancelled = false;
    let fpsTimer: number | undefined;
    let fpsCounter = 0;
    setConnecting(true);

    const ws = new WebSocket(liveWsUrl());
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      setConnecting(false);
      setLive(true);
      logAction('Stream ao vivo conectado');
    };

    ws.onmessage = async (ev) => {
      if (cancelled) return;
      // Frames podem vir como JSON (texto) — nunca binário aqui.
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      const type = data.type as string;

      if (type === 'viewport') {
        const w = (data.w as number) || 1280;
        const h = (data.h as number) || 720;
        viewportRef.current = { w, h };
        setPageMeta({ w, h });
        if (data.url) {
          setPageUrl(data.url as string);
          setGotoUrl(data.url as string);
        }
      } else if (type === 'frame') {
        const b64 = data.data as string;
        const fw = (data.w as number) || viewportRef.current.w;
        const fh = (data.h as number) || viewportRef.current.h;
        const canvas = canvasRef.current;
        if (!canvas || !b64) return;
        if (canvas.width !== fw) canvas.width = fw;
        if (canvas.height !== fh) canvas.height = fh;
        try {
          // Decodifica base64 -> Blob -> ImageBitmap (rápido p/ alta fps)
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: 'image/jpeg' });
          const bmp = await createImageBitmap(blob);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
          }
          bmp.close();
          fpsCounter++;
          setFrameCount((n) => n + 1);
        } catch {
          /* frame corrompido — ignora */
        }
      } else if (type === 'error') {
        logAction(`Erro: ${(data.error as string) || 'desconhecido'}`);
      }
    };

    ws.onerror = () => {
      if (cancelled) return;
      setConnecting(false);
    };

    ws.onclose = () => {
      if (cancelled) return;
      setLive(false);
      setConnecting(false);
    };

    // Medidor de FPS
    fpsTimer = window.setInterval(() => {
      if (!cancelled) {
        setFps(fpsCounter);
        fpsCounter = 0;
      }
    }, 1000);

    return () => {
      cancelled = true;
      if (fpsTimer) window.clearInterval(fpsTimer);
      ws.close();
      wsRef.current = null;
      setLive(false);
    };
  }, [connected, streaming, logAction]);

  // ── Interação de mouse no canvas ───────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!live) return;
      const p = mapToPage(e.clientX, e.clientY);
      if (!p) return;
      setLastClick(p);
      logAction(`Clique (${p.x}, ${p.y})`);
      sendWs({ type: 'mouse', action: 'down', x: p.x, y: p.y, button: e.button === 2 ? 'right' : 'left' });
    },
    [live, mapToPage, logAction, sendWs]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!live) return;
      const p = mapToPage(e.clientX, e.clientY);
      if (!p) return;
      sendWs({ type: 'mouse', action: 'up', x: p.x, y: p.y, button: e.button === 2 ? 'right' : 'left' });
    },
    [live, mapToPage, sendWs]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!live) return;
      // Só envia move quando o botão está pressionado (arrastar) p/ economizar.
      if (e.buttons === 0) return;
      const p = mapToPage(e.clientX, e.clientY);
      if (!p) return;
      sendWs({ type: 'mouse', action: 'move', x: p.x, y: p.y });
    },
    [live, mapToPage, sendWs]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!live) return;
      const p = mapToPage(e.clientX, e.clientY);
      if (!p) return;
      sendWs({ type: 'wheel', x: p.x, y: p.y, deltaY: e.deltaY, deltaX: e.deltaX });
    },
    [live, mapToPage, sendWs]
  );

  // ── Teclado direto na página (canvas focado) ────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!live) return;
      // Não captura teclas quando o foco está num campo de texto do próprio app.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Tecla especial
      if (e.key.length > 1) {
        e.preventDefault();
        sendWs({ type: 'key', key: e.key });
        return;
      }
      // Caractere imprimível
      e.preventDefault();
      sendWs({ type: 'key', text: e.key });
    },
    [live, sendWs]
  );

  // ── Ações de UI (HTTP, já existentes na bridge) ────────
  const postJson = useCallback(async (path: string, body: unknown) => {
    try {
      const res = await fetch(`${BRIDGE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }, []);

  const handleSendType = useCallback(async () => {
    const text = typeText.trim();
    if (!text || !connected) return;
    setBusy(true);
    logAction(`Digitou: "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`);
    await postJson('/type', { text });
    setTypeText('');
    setBusy(false);
  }, [typeText, connected, logAction, postJson]);

  const handleScrollBtn = useCallback(
    (dir: 'up' | 'down') => {
      if (!live) return;
      const delta = dir === 'down' ? 600 : -600;
      logAction(`Scroll ${dir}`);
      sendWs({ type: 'wheel', x: viewportRef.current.w / 2, y: viewportRef.current.h / 2, deltaY: delta });
    },
    [live, logAction, sendWs]
  );

  const handleGoto = useCallback(async () => {
    const url = gotoUrl.trim();
    if (!url || !connected) return;
    setBusy(true);
    logAction(`Navegou para: ${url}`);
    await postJson('/goto', { url });
    setBusy(false);
  }, [gotoUrl, connected, logAction, postJson]);

  const handleRefreshViewport = useCallback(async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/viewport`);
      if (res.ok) {
        const data = await res.json();
        if (data.w) {
          viewportRef.current = { w: data.w, h: data.h };
          setPageMeta({ w: data.w, h: data.h });
        }
        if (data.url) {
          setPageUrl(data.url);
          setGotoUrl(data.url);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Posição relativa do último clique p/ o overlay
  const lastClickPct =
    lastClick && pageMeta
      ? { left: `${(lastClick.x / pageMeta.w) * 100}%`, top: `${(lastClick.y / pageMeta.h) * 100}%` }
      : null;

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
              <h3 className="text-sm font-bold text-white">Compartilhamento de Tela ao Vivo</h3>
              <span
                className={cn(
                  'flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border',
                  live
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : connecting
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      : 'border-white/10 bg-black/40 text-slate-500'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-400 animate-ping' : 'bg-slate-500')} />
                {live ? 'Ao Vivo' : connecting ? 'Conectando…' : 'Desconectado'}
              </span>
              {live && (
                <Badge variant="default" className="text-[10px] font-mono">
                  {fps} fps · {frameCount} frames
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 max-w-xl leading-relaxed">
              {pageUrl ? (
                <span className="truncate inline-block max-w-full align-bottom">
                  {pageUrl}
                </span>
              ) : (
                'Stream de vídeo em tempo real via CDP Screencast — clique e digite direto na tela.'
              )}
            </p>
          </div>
        </div>

        {/* Controles de fluxo */}
        <div className="flex flex-wrap items-center gap-2">
          {connected && (
            <Button
              size="sm"
              variant={streaming ? 'secondary' : 'primary'}
              onClick={() => setStreaming((s) => !s)}
              title={streaming ? 'Pausar stream' : 'Retomar stream'}
            >
              {streaming ? <Square className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
              {streaming ? 'Pausar' : 'Ao Vivo'}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => void handleRefreshViewport()} title="Atualizar dados da página">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Tela ao vivo + overlay de interação ────────────── */}
      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/70 shadow-xl outline-none focus:ring-2 focus:ring-violet-500/40"
        style={{ aspectRatio: pageMeta ? `${pageMeta.w} / ${pageMeta.h}` : '16 / 9' }}
      >
        {connected ? (
          <canvas
            ref={canvasRef}
            onClick={handleMouseDown}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
            draggable={false}
            className={cn(
              'absolute inset-0 h-full w-full select-none object-contain',
              live ? 'cursor-crosshair' : 'cursor-default'
            )}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
            <Eye className="h-12 w-12 text-slate-700 mb-3" />
            <p className="text-sm font-semibold text-slate-400">Nenhuma página conectada</p>
            <p className="text-xs text-slate-600 mt-1 max-w-sm">
              Inicie a bridge e acople à aba da live na aba <strong>Cockpit</strong> ou no
              <strong> Assistente</strong>. O compartilhamento de tela ao vivo aparece aqui.
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

        {/* Dica de interação */}
        {live && (
          <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1 backdrop-blur">
            <Maximize2 className="h-3 w-3 text-slate-300" />
            <span className="text-[10px] text-slate-300">Clique na tela · digite com o teclado</span>
          </div>
        )}

        {/* Conectando */}
        {connecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
          </div>
        )}

        {/* Marca do último clique */}
        {lastClickPct && live && (
          <div
            className="pointer-events-none absolute z-10"
            style={{ left: lastClickPct.left, top: lastClickPct.top, transform: 'translate(-50%, -50%)' }}
          >
            <span className="block h-4 w-4 rounded-full border-2 border-emerald-400 bg-emerald-400/20 animate-ping" />
          </div>
        )}
      </div>

      {/* ── Barra de interação ─────────────────────────────── */}
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
              Clique no campo desejado na tela ao lado para focá-lo, depois digite. Ou use o teclado direto (clique na tela p/ focar o quadro).
            </p>
          </div>

          {/* Teclas rápidas + scroll */}
          <div className="rounded-2xl border border-white/10 bg-[#0c0e12] p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              <Keyboard className="h-3.5 w-3.5 text-violet-400" /> Teclas &amp; Scroll
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_KEYS.map((k) => (
                <Button
                  key={k.key}
                  size="sm"
                  variant="secondary"
                  disabled={!live}
                  onClick={() => sendWs({ type: 'key', key: k.key })}
                  title={k.label}
                >
                  {k.icon}
                  {k.label}
                </Button>
              ))}
              <Button size="sm" variant="secondary" disabled={!live} onClick={() => handleScrollBtn('up')}>
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="secondary" disabled={!live} onClick={() => handleScrollBtn('down')}>
                <ArrowDown className="h-3.5 w-3.5" />
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
            {pageMeta ? (
              <Badge variant="default" className="text-[10px]">
                Viewport {pageMeta.w}×{pageMeta.h}
              </Badge>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Log de ações ───────────────────────────────────── */}
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
