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
  MousePointerClick,
  Navigation,
  Radio,
  RefreshCw,
  Send,
  Square,
} from 'lucide-react';
import { Button, Input } from './ui';
import { cn } from '../lib/utils';

const BRIDGE_URL = '/tango-bridge';
// WebSocket usa protocolo ws:// (o proxy do Vite sobe o upgrade).
function liveWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/tango-bridge/live`;
}

// Backoff de reconexão do stream ao vivo (mesmo perfil do SSE do chat).
const WS_MAX_ATTEMPTS = 6;
const WS_BACKOFF_BASE_MS = 1_000;
const WS_BACKOFF_MAX_MS = 30_000;

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
  // Rastreia se o gesto é clique simples (sem arrastar) p/ enviar 1 só mensagem.
  const pointerDownRef = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  const [streaming, setStreaming] = useState(true);
  const [live, setLive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [wsAttempts, setWsAttempts] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const frameCountRef = useRef(0);
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
    const imgWiderThanCanvas = imgAR > canvasAR;
    const dispW = imgWiderThanCanvas ? rect.width : rect.height * imgAR;
    const dispH = imgWiderThanCanvas ? rect.width / imgAR : rect.height;
    const offX = imgWiderThanCanvas ? 0 : (rect.width - dispW) / 2;
    const offY = imgWiderThanCanvas ? (rect.height - dispH) / 2 : 0;
    const relX = clientX - rect.left - offX;
    const relY = clientY - rect.top - offY;
    if (relX < 0 || relY < 0 || relX > dispW || relY > dispH) return null;
    return {
      x: Math.round((relX / dispW) * vp.w),
      y: Math.round((relY / dispH) * vp.h),
    };
  }, []);

  // ── Conexão WebSocket + render dos frames ──────────────
  // ── Conexão WebSocket + render dos frames ──────────────
  // Reconexão com backoff exponencial (1s→30s, até 6 tentativas): antes o
  // onclose apenas marcava "Desconectado" e o stream morria até o usuário
  // pausar e retomar manualmente.
  useEffect(() => {
    if (!connected || !streaming) {
      // Nota: o cleanup do effect anterior já fecha o ws e faz setLive(false);
      // resetar estado aqui de novo seria setState sincrono redundante no corpo.
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;
    let fpsCounter = 0;
    let attempt = 0;

    // Medidor de FPS
    const fpsTimer = window.setInterval(() => {
      if (!cancelled) {
        setFps(fpsCounter);
        setFrameCount(frameCountRef.current);
        fpsCounter = 0;
      }
    }, 1000);

    const openWs = () => {
      if (cancelled) return;
      setConnecting(true);

      const ws = new WebSocket(liveWsUrl());
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        setWsAttempts(0);
        setConnecting(false);
        setLive(true);
        logAction('Stream ao vivo conectado');
      };

      ws.onmessage = async (ev) => {
        if (cancelled) return;

        // Frames binários: [width uint16 BE][height uint16 BE][JPEG bytes...]
        // Elimina overhead de base64 (+33%) e parse JSON — menos latência.
        if (ev.data instanceof ArrayBuffer) {
          const dv = new DataView(ev.data);
          const fw = dv.getUint16(0, false); // big-endian
          const fh = dv.getUint16(2, false);
          const jpeg = new Uint8Array(ev.data, 4);
          const canvas = canvasRef.current;
          if (!canvas || jpeg.length === 0) return;
          if (canvas.width !== fw) canvas.width = fw;
          if (canvas.height !== fh) canvas.height = fh;
          try {
            const blob = new Blob([jpeg], { type: 'image/jpeg' });
            const bmp = await createImageBitmap(blob);
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
            bmp.close();
            fpsCounter++;
            frameCountRef.current++;
          } catch {
            /* frame corrompido — ignora */
          }
          return;
        }

        // Mensagens de controle (viewport, error) continuam em JSON texto.
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
        } else if (type === 'error') {
          logAction(`Erro: ${(data.error as string) || 'desconhecido'}`);
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        setConnecting(false);
      };

      // Backoff de reconexão: tenta de novo automaticamente em vez de
      // fechar silenciosamente a conexão sem retry.
      ws.onclose = () => {
        if (cancelled) return;
        setLive(false);
        setConnecting(false);
        if (wsRef.current === ws) wsRef.current = null;

        attempt += 1;
        setWsAttempts(attempt);
        if (attempt > WS_MAX_ATTEMPTS) {
          logAction(`Stream parou após ${WS_MAX_ATTEMPTS} tentativas de reconexão`);
          return;
        }
        setConnecting(true);
        const delay = Math.min(WS_BACKOFF_MAX_MS, WS_BACKOFF_BASE_MS * 2 ** (attempt - 1));
        retryTimer = window.setTimeout(openWs, delay);
      };
    };

    openWs();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      window.clearInterval(fpsTimer);
      wsRef.current?.close();
      wsRef.current = null;
      setLive(false);
    };
  }, [connected, streaming, logAction]);

  // ── Interação de mouse no canvas ───────────────────────
  // Clique simples = 1 mensagem (action: 'click'). Arrastar = down + moves + up.
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!live) return;
      const p = mapToPage(e.clientX, e.clientY);
      if (!p) return;
      pointerDownRef.current = { x: p.x, y: p.y, dragging: false };
    },
    [live, mapToPage]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!live || !pointerDownRef.current) return;
      if (e.buttons === 0) return;
      const p = mapToPage(e.clientX, e.clientY);
      if (!p) return;
      if (!pointerDownRef.current.dragging) {
        const dx = p.x - pointerDownRef.current.x;
        const dy = p.y - pointerDownRef.current.y;
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        pointerDownRef.current.dragging = true;
        sendWs({ type: 'mouse', action: 'down', x: pointerDownRef.current.x, y: pointerDownRef.current.y, button: 'left' });
      }
      sendWs({ type: 'mouse', action: 'move', x: p.x, y: p.y });
    },
    [live, mapToPage, sendWs]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!live || !pointerDownRef.current) return;
      const p = mapToPage(e.clientX, e.clientY);
      const btn = e.button === 2 ? 'right' : 'left';
      if (!p) {
        pointerDownRef.current = null;
        return;
      }
      if (pointerDownRef.current.dragging) {
        sendWs({ type: 'mouse', action: 'up', x: p.x, y: p.y, button: btn });
      } else {
        setLastClick(p);
        logAction(`Clique (${p.x}, ${p.y})`);
        sendWs({ type: 'mouse', action: 'click', x: p.x, y: p.y, button: btn });
      }
      pointerDownRef.current = null;
    },
    [live, mapToPage, logAction, sendWs]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!live) return;
      const p = mapToPage(e.clientX, e.clientY);
      if (!p) return;
      // Amplifica o delta p/ scroll mais responsivo em modais e containers.
      const deltaY = Math.sign(e.deltaY) * Math.max(Math.abs(e.deltaY) * 2, 150);
      const deltaX = Math.sign(e.deltaX) * Math.max(Math.abs(e.deltaX) * 2, 150);
      sendWs({ type: 'wheel', x: p.x, y: p.y, deltaY, deltaX });
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
      const delta = dir === 'down' ? 800 : -800;
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
      {/* ── Cabeçalho compacto ─────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
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
            {live ? 'Ao Vivo' : connecting ? (wsAttempts > 0 ? 'Reconectando…' : 'Conectando…') : 'Desconectado'}
          </span>
          {connecting && wsAttempts > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400">
              {Math.min(wsAttempts, WS_MAX_ATTEMPTS)}/{WS_MAX_ATTEMPTS}
            </span>
          )}
          {streaming && !connecting && !live && wsAttempts > WS_MAX_ATTEMPTS && (
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border border-red-500/30 bg-red-500/10 text-red-400">
              Stream pausado
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
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
        style={{
          aspectRatio: pageMeta ? `${pageMeta.w} / ${pageMeta.h}` : '16 / 9',
          contain: 'layout paint',
        }}
      >
        {connected ? (
          <canvas
            ref={canvasRef}
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
            style={{ contain: 'strict' }}
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

      {/* ── Barra de interação compacta ────────────────────── */}
      {connected && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <Input
              value={typeText}
              onChange={(e) => setTypeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSendType();
              }}
              placeholder="Digitar na página…"
              className="h-9 w-56 text-xs"
            />
            <Button size="sm" variant="primary" disabled={busy || !typeText.trim()} onClick={() => void handleSendType()}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
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
          <div className="flex items-center gap-2">
            <Input
              value={gotoUrl}
              onChange={(e) => setGotoUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleGoto();
              }}
              placeholder="Navegar para URL…"
              className="h-9 w-48 text-xs"
            />
            <Button size="sm" variant="primary" disabled={busy || !gotoUrl.trim()} onClick={() => void handleGoto()}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}


    </div>
  );
}
