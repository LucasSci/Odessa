import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Camera,
  CheckCircle2,
  Clock3,
  Crosshair,
  Download,
  FileText,
  Gauge,
  Layers,
  Link2,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  ScanText,
  Settings2,
  Trash2,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { emitEvent } from './core/eventBus';
import { buildOcrEvent } from './core/ocrEventContract';
import type { OcrEvent } from './core/ocrEventContract';
import { type GiftCatalogEntry, loadGiftCatalog, saveGiftCatalog } from './core/giftCatalog';
import { apiUrl, API_BASE_URL } from './lib/api';
import { cn } from './lib/utils';
import type { CapturedMessage, LiveEventKind } from './types';

interface CaptureStudioProps {
  capturedText: CapturedMessage[];
  setCapturedText: React.Dispatch<React.SetStateAction<CapturedMessage[]>>;
  autopilotEnabled?: boolean;
  pendingAutopilotEvents?: number;
  latestAutopilotActionStatus?: string;
  onStartAutopilot?: () => void;
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CaptureZone extends SelectionRect {
  id: string;
  name: string;
  role: 'chat' | 'gifts' | 'alerts' | 'custom';
  color: string;
}

interface CapturePreset {
  id: string;
  name: string;
  description: string;
  zones: CaptureZone[];
}

interface CaptureSettings {
  magnification: number;
  contrast: number;
  brightness: number;
  intervalTime: number;
  debugMode: boolean;
}

type CaptureSourceMode = 'screen' | 'obs' | 'direct';
type DirectPageMode = 'interact' | 'crop';
type DirectRenderer = 'none' | 'iframe' | 'proxy-preview' | 'electron-webview' | 'electron-webcontentsview';
type DirectPageState = 'none' | 'loading' | 'dom-ready' | 'rendered' | 'failed' | 'blocked' | 'empty';
type DirectCaptureState = 'unavailable' | 'available' | 'tested' | 'failed';

interface ElectronImage {
  toDataURL: () => string;
}

interface ElectronWebviewElement extends HTMLElement {
  src: string;
  capturePage?: () => Promise<ElectronImage>;
  loadURL?: (url: string) => void;
  reload?: () => void;
  goBack?: () => void;
  goForward?: () => void;
}

interface OdessaDesktopBridge {
  isElectron?: boolean;
  canUseDirectWebCapture?: boolean;
  canUseDesktopSources?: boolean;
  apiOrigin?: string;
  platform?: string;
  version?: string;
  renderer?: string;
  webviewTagEnabled?: boolean;
  getRuntimeStatus?: () => Promise<unknown>;
  listCaptureSources?: () => Promise<unknown>;
  openLogs?: () => Promise<unknown>;
}

interface ElectronRuntimeWindow extends Window {
  electronAPI?: {
    isElectron?: boolean;
    platform?: string;
  };
  odessaDesktop?: OdessaDesktopBridge;
}

type WebviewProps = React.HTMLAttributes<ElectronWebviewElement> & {
  src?: string;
  partition?: string;
  allowpopups?: string;
  webpreferences?: string;
};

const WebviewTag = React.forwardRef<ElectronWebviewElement, WebviewProps>((props, ref) =>
  React.createElement('webview', { ...props, ref }),
);
WebviewTag.displayName = 'WebviewTag';

interface ObsHealth {
  ok?: boolean;
  connected?: boolean;
  sourceReady?: boolean;
  sourceName?: string;
  currentScene?: string | null;
  screenshotReady?: boolean;
  imageWidth?: number | null;
  imageHeight?: number | null;
  sourceActive?: boolean | null;
  sourceShowing?: boolean | null;
  frameHash?: string | null;
  capturedAt?: string | null;
  error?: string | null;
}

interface ObsCycleResponse {
  ok?: boolean;
  sourceName?: string;
  image?: string | null;
  width?: number | null;
  height?: number | null;
  sourceActive?: boolean | null;
  sourceShowing?: boolean | null;
  frameHash?: string | null;
  capturedAt?: string | null;
  results?: OcrResponse[];
  latency_ms?: number | null;
  error?: string | null;
}

interface BackendHealth {
  status: string;
  ocr: string;
  gemini_configured: boolean;
  openai_ai_configured: boolean;
  openai_text_model?: string;
  openai_tts_configured: boolean;
}

interface OcrIngestResult {
  triggered: Array<{ triggerId: string; triggerName: string; targetVideoId: string; queueSize: number; line: string; eventType: string; kind: string; giftKey?: string; sender?: string; ocrRaw?: string }>;
  noMatch: Array<{ eventType: string; kind: string; line: string; reason?: string; giftKey?: string; sender?: string; ocrRaw?: string }>;
  linesProcessed: number;
  triggerQueueSize?: number;
}

interface CaptureEvent {
  id: string;
  zoneId: string;
  zoneName: string;
  text: string;
  rawText: string;
  time: string;
  routeStatus: 'captured' | 'processed' | 'sent' | 'error';
  confidence: number | null;
  latencyMs: number | null;
  error?: string;
  deduped?: boolean;
  duplicateReason?: string | null;
  captureMode?: string;
  sourceHealth?: Record<string, unknown>;
  // Trigger routing result
  triggersFired?: number;
  triggerName?: string;
  triggeredVideoId?: string;
  noMatchCount?: number;
}

/** Word-level bounding box returned by Tesseract.js */
interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence?: number;
}

interface OcrResponse {
  text?: string;
  full_text?: string;
  error?: string | null;
  zone_id?: string | null;
  zone_name?: string | null;
  confidence?: number | null;
  latency_ms?: number | null;
  created_at?: string;
  deduped?: boolean;
  duplicateReason?: string | null;
  lineHash?: string | null;
  captureMode?: string;
  sourceHealth?: Record<string, unknown>;
  zone_role?: string | null;
  /** Raw zone image for visual gift matching (base64 data URL, screen-capture only) */
  imageDataUrl?: string;
  /** Word-level bounding boxes from Tesseract (undefined for TextDetector path) */
  words?: OcrWord[];
}

enum CaptureStatus {
  IDLE = 'Parado',
  SELECTING = 'Fonte conectada',
  CAPTURING = 'Capturando',
  ERROR = 'Erro',
}

const STORAGE_KEY = 'odessa:capture-studio:v1';
const LEGACY_STORAGE_KEY = 'dojobua:capture-studio:v1';
const MAX_ZONES = 6;
const MAX_EVENTS = 120;
const MAX_PERSONA_MESSAGES = 100;
const DEFAULT_OBS_SOURCE_NAME = 'Odessa Chat OCR';

const DEFAULT_SETTINGS: CaptureSettings = {
  magnification: 2,
  contrast: 1.4,
  brightness: 1.05,
  intervalTime: 250,
  debugMode: false,
};

const DEFAULT_PRESETS: CapturePreset[] = [
  {
    id: 'stream-main',
    name: 'Live Chat',
    description: 'Chat principal e eventos laterais',
    zones: [
      {
        id: 'zone-chat',
        name: 'Chat',
        role: 'chat',
        color: '#38BDF8',
        x: 100,
        y: 100,
        width: 420,
        height: 300,
      },
      {
        id: 'zone-gifts',
        name: 'Presentes',
        role: 'gifts',
        color: '#F59E0B',
        x: 560,
        y: 160,
        width: 280,
        height: 220,
      },
    ],
  },
  {
    id: 'obs-compact',
    name: 'OBS Compacto',
    description: 'Uma zona grande para layout simples',
    zones: [
      {
        id: 'zone-compact-chat',
        name: 'Chat',
        role: 'chat',
        color: '#22C55E',
        x: 80,
        y: 120,
        width: 360,
        height: 420,
      },
    ],
  },
  {
    id: 'events-focus',
    name: 'Eventos',
    description: 'Separacao para alertas e presentes',
    zones: [
      {
        id: 'zone-event-chat',
        name: 'Chat',
        role: 'chat',
        color: '#38BDF8',
        x: 110,
        y: 110,
        width: 380,
        height: 260,
      },
      {
        id: 'zone-event-alerts',
        name: 'Alertas',
        role: 'alerts',
        color: '#E11D48',
        x: 560,
        y: 80,
        width: 320,
        height: 180,
      },
      {
        id: 'zone-event-gifts',
        name: 'Presentes',
        role: 'gifts',
        color: '#F59E0B',
        x: 560,
        y: 300,
        width: 320,
        height: 190,
      },
    ],
  },
];

const ROLE_LABELS: Record<CaptureZone['role'], string> = {
  chat: 'Chat',
  gifts: 'Presentes',
  alerts: 'Alertas',
  custom: 'Custom',
};

function clonePresets(presets: CapturePreset[]) {
  return presets.map((preset) => ({
    ...preset,
    zones: preset.zones.map((zone) => ({ ...zone })),
  }));
}

function getStoredState(): {
  activePresetId?: string;
  presets?: CapturePreset[];
  settings?: CaptureSettings;
  sourceName?: string;
  captureMode?: CaptureSourceMode;
  directUrl?: string;
} | null {
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatClock(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function makeEventId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function kindFromZoneRole(role: CaptureZone['role']): LiveEventKind {
  if (role === 'gifts') return 'gift';
  if (role === 'alerts') return 'alert';
  return 'chat';
}

/**
 * Normalises an OCR line for deduplication comparison.
 * Handles common Tesseract character-confusion errors (0/O, 1/l/|, etc.)
 * and strips punctuation so that "Hello!" and "Hel1o." compare equal.
 */
function normForDedup(line: string): string {
  const base = line
    .toLowerCase()
    .replace(/0/g, 'o')      // 0 → o  (OCR confusion)
    .replace(/[1|]/g, 'l')   // 1 / | → l
    .replace(/[^a-z\s]/g, '') // drop digits + punctuation
    .replace(/\s+/g, ' ')
    .trim();
  // For gift verb patterns, strip the gift NAME so OCR noise in the name
  // ("lucas enviou v", "lucas enviou e", "lucas enviou heart") all collapse
  // to the same key and only the first fires within the TTL window.
  const giftVerb = /^(.{1,40})\s+(enviou|mandou|sent|presenteou com)\b/.exec(base);
  if (giftVerb) return `${giftVerb[1]} ${giftVerb[2]}`;
  return base;
}

// ─── Visual gift recognition via perceptual hashing ──────────────────────────
//
// When the gift catalog contains reference images (imageUrl), we identify gifts
// by comparing the visual icon in the captured zone against catalog entries.
// This replaces text-based parsing of OCR artifacts (V, E, ", J, .3, 27…).
//
// Algorithm (Average Hash / aHash):
//   1. Resize to 8×8 pixels using <canvas>
//   2. Convert to grayscale (luma formula)
//   3. Build 64-bit hash: 1 if pixel ≥ mean, 0 otherwise
//   4. Compare two hashes with Hamming distance (XOR + popcount)
//   Similarity = 1 − distance/64  →  1.0 = identical, 0.0 = completely different


const GIFT_VERB_WORD_RE = /^(enviou|mandou|sent|presenteou)$/i;

/**
 * Find all bounding boxes of verb words (enviou/mandou/sent) in the OCR word list,
 * sorted by vertical position (top to bottom) so each maps to the correct notification row.
 */
function findAllVerbBBoxes(
  words: OcrWord[],
): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  return words
    .filter((w) => GIFT_VERB_WORD_RE.test(w.text.trim()))
    .map((w) => w.bbox)
    .sort((a, b) => a.y0 - b.y0);
}

/**
 * Crop the gift icon region: everything to the RIGHT of the verb word bbox.
 * TikTok notification layout: "[avatar] [username] enviou [🎁 ICON HERE] x2"
 * The icon is a square graphic immediately after the verb text.
 * Returns a data URL of the crop, or null if coordinates are out of bounds.
 */
async function cropGiftIconRegion(
  imageDataUrl: string,
  verbBBox: { x0: number; y0: number; x1: number; y1: number },
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const PAD = 6; // vertical padding around the verb row
      const x = verbBBox.x1 + 2; // 2px gap between verb text and icon
      const y = Math.max(0, verbBBox.y0 - PAD);
      const w = Math.max(1, img.width - x);
      const h = Math.min(img.height - y, (verbBBox.y1 - verbBBox.y0) + PAD * 2);
      if (x >= img.width || y >= img.height || w <= 0 || h <= 0) {
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

/**
 * Cache for catalog image hashes.
 * Key: `entry.id:entry.updatedAt:size` — recomputed only when catalog entry changes.
 */
const _catalogHashCache = new Map<string, number[]>();

/**
 * Compute Average Hash at any size (default 8×8 = 64 bits, 16×16 = 256 bits).
 * Returns an array of 32-bit unsigned ints encoding the hash bits.
 */
async function computeAHashN(imageDataUrl: string, size = 8): Promise<number[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, size, size);
      const px = ctx.getImageData(0, 0, size, size).data;
      const gray: number[] = [];
      for (let i = 0; i < size * size; i++) {
        gray.push((px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000);
      }
      const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
      const words = Math.ceil(size * size / 32);
      const result = new Array<number>(words).fill(0);
      for (let i = 0; i < size * size; i++) {
        if (gray[i] >= mean) result[Math.floor(i / 32)] |= 1 << (i % 32);
      }
      resolve(result.map(n => n >>> 0));
    };
    img.onerror = () => resolve([]);
    img.src = imageDataUrl;
  });
}

function hammingDistanceN(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < len; i++) {
    let x = (a[i] ^ b[i]) >>> 0;
    while (x) { d += x & 1; x >>>= 1; }
  }
  return d;
}

/**
 * Compare an image data URL against all catalog entries that have reference images.
 * Uses the specified hash size (8 = fast/coarse, 16 = slower/accurate).
 * Returns the best match above `minSimilarity`, or null.
 */
async function matchGiftInCatalog(
  imageDataUrl: string,
  catalog: GiftCatalogEntry[],
  minSimilarity = 0.72,
  hashSize = 8,
): Promise<{ key: string; name: string; emoji?: string; similarity: number } | null> {
  const imgHash = await computeAHashN(imageDataUrl, hashSize);
  if (imgHash.length === 0) return null;

  const totalBits = hashSize * hashSize;
  let best: { key: string; name: string; emoji?: string; similarity: number } | null = null;

  for (const entry of catalog) {
    if (!entry.imageUrl) continue;
    try {
      const cacheKey = `${entry.id}:${entry.updatedAt ?? ''}:${hashSize}`;
      let entryHash = _catalogHashCache.get(cacheKey);
      if (!entryHash) {
        entryHash = await computeAHashN(entry.imageUrl, hashSize);
        _catalogHashCache.set(cacheKey, entryHash);
      }
      const dist = hammingDistanceN(imgHash, entryHash);
      const sim = 1 - dist / totalBits;
      if (!best || sim > best.similarity) {
        best = { key: entry.key, name: entry.name, emoji: entry.emoji, similarity: sim };
      }
    } catch {
      /* skip unreadable catalog images */
    }
  }

  return best && best.similarity >= minSimilarity ? best : null;
}

/**
 * Extract the most colorful (saturated) region from an image.
 *
 * TikTok uses a dark UI. Gift cards are the most visually saturated element
 * in the zone — comparing JUST this region against the catalog icon is far
 * more reliable than comparing the whole frame (which is mostly dark background).
 *
 * Algorithm:
 *   1. Downsample to 32×32 for fast processing
 *   2. Convert each pixel to HSL — compute saturation = (max-min) channel range
 *   3. Find bounding box of pixels with saturation > 0.25
 *   4. Scale bbox back to original dimensions and crop
 */
/**
 * Extracts the foreground region (gift icon) by comparing pixels against the
 * background color estimated from the four corners of the image.
 * Works for any icon color — white, grey, pastel — because it uses
 * contrast-from-background rather than absolute saturation.
 */
async function extractForegroundRegion(imageDataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const S = 48;
      const canvas = document.createElement('canvas');
      canvas.width = S; canvas.height = S;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, S, S);
      ctx.drawImage(img, 0, 0, S, S);
      const data = ctx.getImageData(0, 0, S, S).data;

      // Estimate background from 2×2 samples at each corner
      let bgR = 0, bgG = 0, bgB = 0, bgN = 0;
      for (const [cx, cy] of [[0, 0], [S - 2, 0], [0, S - 2], [S - 2, S - 2]] as [number, number][]) {
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const i = ((cy + dy) * S + (cx + dx)) * 4;
          bgR += data[i]; bgG += data[i + 1]; bgB += data[i + 2]; bgN++;
        }
      }
      bgR /= bgN; bgG /= bgN; bgB /= bgN;

      // Mark pixels whose Euclidean RGB distance from background exceeds threshold
      const THRESH = 22; // 0–255 scale; lower = more sensitive
      let minX = S, minY = S, maxX = -1, maxY = -1;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const i = (y * S + x) * 4;
          const dr = data[i] - bgR, dg = data[i + 1] - bgG, db = data[i + 2] - bgB;
          if (Math.sqrt(dr * dr + dg * dg + db * db) > THRESH) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < 0 || maxX <= minX || maxY <= minY) { resolve(null); return; }

      const scaleX = img.width / S, scaleY = img.height / S;
      const PAD = 4;
      const ox = Math.max(0, Math.round(minX * scaleX) - PAD);
      const oy = Math.max(0, Math.round(minY * scaleY) - PAD);
      const ow = Math.min(img.width - ox, Math.round((maxX - minX + 1) * scaleX) + PAD * 2);
      const oh = Math.min(img.height - oy, Math.round((maxY - minY + 1) * scaleY) + PAD * 2);
      if (ow < 4 || oh < 4) { resolve(null); return; }

      const crop = document.createElement('canvas');
      crop.width = ow; crop.height = oh;
      crop.getContext('2d')!.drawImage(img, ox, oy, ow, oh, 0, 0, ow, oh);
      resolve(crop.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

/**
 * Scans the zone image for the most colorful (highest saturation×value) subregion
 * using a grid heatmap, then returns a crop of configurable size centered on it.
 *
 * Why: gift zones are large (320×190 px). The icon is ~60 px inside that area.
 * Scaling the full zone to 32×32 for NCC makes the icon ~6 px — useless.
 * This focuses the comparison on just the icon, which is always the most
 * colorful element (TikTok card backgrounds and white text are unsaturated).
 */
async function findHotspotCrop(
  imageDataUrl: string,
  cropSize = 96,
  gridDivs = 8,
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const SCAN_W = 64;
      const SCAN_H = Math.max(1, Math.round((64 * H) / W));
      const canvas = document.createElement('canvas');
      canvas.width = SCAN_W; canvas.height = SCAN_H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, SCAN_W, SCAN_H);
      const data = ctx.getImageData(0, 0, SCAN_W, SCAN_H).data;

      const cellW = Math.max(1, Math.floor(SCAN_W / gridDivs));
      const cellH = Math.max(1, Math.floor(SCAN_H / gridDivs));
      let bestScore = -1, bestCX = SCAN_W / 2, bestCY = SCAN_H / 2;

      for (let gy = 0; gy < gridDivs; gy++) {
        for (let gx = 0; gx < gridDivs; gx++) {
          const x0 = gx * cellW, y0 = gy * cellH;
          let total = 0, count = 0;
          for (let py = y0; py < y0 + cellH && py < SCAN_H; py++) {
            for (let px = x0; px < x0 + cellW && px < SCAN_W; px++) {
              const idx = (py * SCAN_W + px) * 4;
              const r = data[idx] / 255, g = data[idx + 1] / 255, b = data[idx + 2] / 255;
              const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
              const sat = mx === 0 ? 0 : (mx - mn) / mx;
              total += sat * mx; // saturation × brightness
              count++;
            }
          }
          const score = count > 0 ? total / count : 0;
          if (score > bestScore) {
            bestScore = score;
            bestCX = x0 + cellW / 2;
            bestCY = y0 + cellH / 2;
          }
        }
      }

      const scaleX = W / SCAN_W, scaleY = H / SCAN_H;
      const cxOrig = bestCX * scaleX, cyOrig = bestCY * scaleY;
      const half = cropSize / 2;
      const sx = Math.max(0, Math.min(W - cropSize, Math.round(cxOrig - half)));
      const sy = Math.max(0, Math.min(H - cropSize, Math.round(cyOrig - half)));
      const sw = Math.min(cropSize, W - sx), sh = Math.min(cropSize, H - sy);

      const out = document.createElement('canvas');
      out.width = sw; out.height = sh;
      out.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(out.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

/**
 * Returns the hardcoded dominant-hue prior [hue°, sat, val] for a known gift key.
 * Defined as a function (not a module-level const) to guarantee it is fully
 * available via hoisting and avoid any TDZ issues in the production bundle.
 */
function getGiftHuePrior(key: string): [number, number, number] | null {

  const p: Record<string, [number, number, number]> = {
    'gift.rosa':             [340, 0.85, 0.80],  // rose: hot magenta-pink
    'gift.coracao':          [  5, 0.90, 0.75],  // heart: pure red
    'gift.beijo':            [353, 0.82, 0.72],  // kiss: red-pink lips
    'gift.eu_te_amo':        [345, 0.78, 0.80],  // love: pink-red
    'gift.maozinha_coracao': [338, 0.85, 0.80],  // heart hand: deep pink
    'gift.urso':             [ 28, 0.65, 0.65],  // bear: warm brown
    'gift.tiktok':           [188, 0.70, 0.65],  // TikTok logo: cyan-teal
    'gift.gg':               [125, 0.65, 0.65],  // GG: game-green
    'gift.sorvete':          [195, 0.60, 0.82],  // ice cream: pastel blue
    'gift.rosquinha':        [ 22, 0.70, 0.58],  // donut: warm caramel
    'gift.perfume':          [278, 0.72, 0.65],  // perfume: violet-purple
    'gift.pirulito':         [357, 0.88, 0.78],  // lollipop: vivid red-pink
    'gift.estrela':          [ 50, 0.90, 0.86],  // star: bright gold-yellow
    'gift.coroa':            [ 44, 0.88, 0.82],  // crown: gold
    'gift.foguete':          [214, 0.82, 0.68],  // rocket: deep blue
    'gift.leao':             [ 36, 0.80, 0.78],  // lion: golden-orange
    'gift.universo':         [258, 0.82, 0.58],  // universe: indigo-purple
  };
  return p[key] ?? null;
}

/** Debug info emitted by detectVisualGiftInZone on every call, even with no match. */
interface VisualGiftDebugInfo {
  colorRegion: string | null;    // hotspot crop (the icon area found by heatmap)
  allScores: Array<{ strategy: string; key: string; score: number }>;
  bestScore: number;
  bestKey: string;
  zoneColor: [number, number, number] | null;  // dominant hue/sat/val of the hotspot
}

/**
 * Returns per-pixel grayscale values (0–1) for an image at a given resolution.
 * The canvas is pre-filled black so transparent PNGs composite onto black —
 * matching TikTok's dark UI background for like-for-like comparison.
 */
async function getGrayscalePixels(imageDataUrl: string, size: number): Promise<Float32Array | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      const px = new Float32Array(size * size);
      for (let i = 0; i < px.length; i++) {
        const j = i * 4;
        px[i] = (0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]) / 255;
      }
      resolve(px);
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

/**
 * Normalized cross-correlation (NCC) between two images at `size`×`size`.
 * Returns a value in [–1, 1]: 1 = identical texture, 0 = uncorrelated,
 * –1 = inverted. Unlike aHash (64–256 bits), NCC uses 1024 float values
 * so it captures far more shape detail at the same resolution.
 */
async function imageNCC(imgA: string, imgB: string, size = 32): Promise<number> {
  const [pxA, pxB] = await Promise.all([getGrayscalePixels(imgA, size), getGrayscalePixels(imgB, size)]);
  if (!pxA || !pxB) return 0;
  const n = pxA.length;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += pxA[i]; sumB += pxB[i]; }
  const mA = sumA / n, mB = sumB / n;
  let num = 0, vA = 0, vB = 0;
  for (let i = 0; i < n; i++) {
    const da = pxA[i] - mA, db = pxB[i] - mB;
    num += da * db; vA += da * da; vB += db * db;
  }
  const den = Math.sqrt(vA * vB);
  return den < 1e-10 ? 0 : num / den;
}

/** Match zone image against catalog entries using NCC; similarity mapped to [0,1]. */
async function matchGiftByNCC(
  imageDataUrl: string,
  catalog: GiftCatalogEntry[],
  minScore = 0,
  size = 32,
): Promise<{ key: string; name: string; emoji?: string; similarity: number } | null> {
  let best: { key: string; name: string; emoji?: string; similarity: number } | null = null;
  for (const entry of catalog) {
    if (!entry.imageUrl) continue;
    try {
      const ncc = await imageNCC(imageDataUrl, entry.imageUrl, size);
      const sim = (ncc + 1) / 2; // map [–1,1] → [0,1]
      if (sim >= minScore && (!best || sim > best.similarity)) {
        best = { key: entry.key, name: entry.name, emoji: entry.emoji, similarity: sim };
      }
    } catch { /* skip bad catalog entries */ }
  }
  return best;
}

/**
 * Computes a normalized hue histogram from colorful pixels of an image.
 * Used as Strategy 4 (color-distribution fingerprint).
 */
async function computeHueHistogram(imageDataUrl: string, bins = 36): Promise<number[] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const S = 48;
      const canvas = document.createElement('canvas');
      canvas.width = S; canvas.height = S;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, S, S);
      const data = ctx.getImageData(0, 0, S, S).data;
      const hist = new Array<number>(bins).fill(0);
      let count = 0;
      for (let i = 0; i < S * S * 4; i += 4) {
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), delta = mx - mn;
        const sat = mx > 0 ? delta / mx : 0;
        if (sat < 0.15 || mx < 0.10) continue; // stricter: skip grey/dark background pixels
        let hue = 0;
        if (delta > 0) {
          if (mx === r) hue = 60 * (((g - b) / delta) % 6);
          else if (mx === g) hue = 60 * ((b - r) / delta + 2);
          else hue = 60 * ((r - g) / delta + 4);
          if (hue < 0) hue += 360;
        }
        hist[Math.min(bins - 1, Math.floor(hue / (360 / bins)))]++;
        count++;
      }
      if (count === 0) { resolve(null); return; }
      resolve(hist.map((v) => v / count));
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

function histogramBhattacharyya(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.sqrt(a[i] * b[i]);
  return sum;
}

async function matchGiftByHistogram(
  imageDataUrl: string,
  catalog: GiftCatalogEntry[],
  minScore = 0,
): Promise<{ key: string; name: string; emoji?: string; similarity: number } | null> {
  const zoneHist = await computeHueHistogram(imageDataUrl);
  if (!zoneHist) return null;
  let best: { key: string; name: string; emoji?: string; similarity: number } | null = null;
  for (const entry of catalog) {
    if (!entry.imageUrl) continue;
    try {
      const entryHist = await computeHueHistogram(entry.imageUrl);
      if (!entryHist) continue;
      const score = histogramBhattacharyya(zoneHist, entryHist);
      if (score >= minScore && (!best || score > best.similarity)) {
        best = { key: entry.key, name: entry.name, emoji: entry.emoji, similarity: score };
      }
    } catch { /* skip */ }
  }
  return best;
}

/**
 * Per-session cache of catalog-image foreground regions.
 * Avoids re-running extractForegroundRegion on every catalog entry every frame.
 * Keyed by GiftCatalogEntry.key (stable). Cleared automatically when the catalog
 * key changes (user uploads a new image and saves a new entry).
 */
const _catalogFgCache = new Map<string, string | null>();

/** Per-session cache for catalog dominant-color vectors. Keyed by entry.key. */
const _catalogColorCache = new Map<string, [number, number, number] | null>();

/**
 * Extracts the dominant color of an image as [meanHue°, meanSat, meanVal].
 * Only considers "colorful" pixels (sat > 0.15, val > 0.10) so backgrounds
 * and white/grey UI elements are ignored.
 * Uses circular mean for hue (sin/cos method) to correctly handle 0°/360° wrap.
 * Returns null if < 3% of pixels are colorful (uniform/dark image).
 */
async function extractDominantColor(
  imageDataUrl: string,
): Promise<[number, number, number] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const S = 32;
      const canvas = document.createElement('canvas');
      canvas.width = S; canvas.height = S;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, S, S);
      const data = ctx.getImageData(0, 0, S, S).data;
      let sinH = 0, cosH = 0, sumS = 0, sumV = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 20) continue; // skip transparent
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const v = mx, s = mx === 0 ? 0 : (mx - mn) / mx;
        if (s < 0.15 || v < 0.10) continue;
        let h = 0;
        if (mx - mn > 0) {
          if (mx === r) h = ((g - b) / (mx - mn)) % 6 * 60;
          else if (mx === g) h = ((b - r) / (mx - mn) + 2) * 60;
          else h = ((r - g) / (mx - mn) + 4) * 60;
          if (h < 0) h += 360;
        }
        const rad = h * Math.PI / 180;
        sinH += Math.sin(rad); cosH += Math.cos(rad);
        sumS += s; sumV += v; n++;
      }
      if (n < S * S * 0.03) { resolve(null); return; }
      const meanH = (Math.atan2(sinH / n, cosH / n) * 180 / Math.PI + 360) % 360;
      resolve([meanH, sumS / n, sumV / n]);
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

async function getCatalogColor(entry: GiftCatalogEntry): Promise<[number, number, number] | null> {
  if (_catalogColorCache.has(entry.key)) return _catalogColorCache.get(entry.key)!;
  if (!entry.imageUrl) { _catalogColorCache.set(entry.key, null); return null; }
  const color = await extractDominantColor(entry.imageUrl);
  _catalogColorCache.set(entry.key, color);
  return color;
}

/**
 * Matches by dominant color: computes the mean hue (circular) of colorful pixels
 * and compares against catalog. Hue is the single most discriminating feature —
 * rosa≈0°, beijo≈350°, urso≈30°, TikTok≈195°, universo≈270°, etc.
 * Score = 1 when hues match exactly, 0 when 90° apart.
 */
async function matchGiftByDominantColor(
  imageDataUrl: string,
  catalog: GiftCatalogEntry[],
  minScore = 0,
): Promise<{ key: string; name: string; emoji?: string; similarity: number } | null> {
  const zoneColor = await extractDominantColor(imageDataUrl);
  if (!zoneColor) return null;
  let best: { key: string; name: string; emoji?: string; similarity: number } | null = null;
  for (const entry of catalog) {
    try {
      // Prefer the catalog image's actual dominant color; fall back to hardcoded prior.
      let catColor: [number, number, number] | null = null;
      if (entry.imageUrl) {
        catColor = await getCatalogColor(entry);
      }
      if (!catColor) {
        catColor = getGiftHuePrior(entry.key);
      }
      if (!catColor) continue;

      const dH = Math.min(Math.abs(zoneColor[0] - catColor[0]), 360 - Math.abs(zoneColor[0] - catColor[0]));
      // Full score at 0°, zero at 90°; saturation difference as secondary signal.
      const hueScore = Math.max(0, 1 - dH / 90);
      const satScore = 1 - Math.abs(zoneColor[1] - catColor[1]);
      const score = Math.max(0, hueScore * 0.80 + satScore * 0.20);
      if (score >= minScore && (!best || score > best.similarity)) {
        best = { key: entry.key, name: entry.name, emoji: entry.emoji, similarity: score };
      }
    } catch { /* skip */ }
  }
  return best;
}

/**
 * Convenience wrapper: extract the dominant color of a zone image,
 * returned as a [hue°, sat, val] triple or null.
 * Exposed so the debug panel can display the detected zone hue.
 */
async function getZoneDominantColor(imageDataUrl: string): Promise<[number, number, number] | null> {
  return extractDominantColor(imageDataUrl);
}

/**
 * Extracts the foreground of a catalog PNG using its alpha channel.
 * This is far more reliable than corner-based background estimation for
 * catalog images because TikTok gift icons are PNGs with transparent
 * backgrounds — alpha = 0 IS the background by definition.
 *
 * Falls back to corner-based extractForegroundRegion for JPEGs (no alpha).
 */
async function extractForegroundFromAlpha(imageDataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const S = 64; // higher res for more accurate alpha boundary
      const canvas = document.createElement('canvas');
      canvas.width = S; canvas.height = S;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, S, S);
      ctx.drawImage(img, 0, 0, S, S);
      const data = ctx.getImageData(0, 0, S, S).data;

      // Count opaque pixels — if too few the image has no real transparency
      let opaqueCount = 0;
      let minX = S, minY = S, maxX = -1, maxY = -1;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const i = (y * S + x) * 4;
          if (data[i + 3] > 20) { // alpha > 20 = foreground pixel
            opaqueCount++;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      // If > 90% pixels are opaque, image has no transparency → corner method
      if (opaqueCount > S * S * 0.9 || maxX < 0 || maxX <= minX || maxY <= minY) {
        resolve(null);
        return;
      }

      const scaleX = img.width / S, scaleY = img.height / S;
      const PAD = 2;
      const ox = Math.max(0, Math.round(minX * scaleX) - PAD);
      const oy = Math.max(0, Math.round(minY * scaleY) - PAD);
      const ow = Math.min(img.width - ox, Math.round((maxX - minX + 1) * scaleX) + PAD * 2);
      const oh = Math.min(img.height - oy, Math.round((maxY - minY + 1) * scaleY) + PAD * 2);
      if (ow < 4 || oh < 4) { resolve(null); return; }

      // Render cropped portion on black background
      const crop = document.createElement('canvas');
      crop.width = ow; crop.height = oh;
      const cctx = crop.getContext('2d')!;
      cctx.fillStyle = '#000';
      cctx.fillRect(0, 0, ow, oh);
      cctx.drawImage(img, ox, oy, ow, oh, 0, 0, ow, oh);
      resolve(crop.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

async function getCatalogFg(entry: GiftCatalogEntry): Promise<string | null> {
  if (_catalogFgCache.has(entry.key)) return _catalogFgCache.get(entry.key)!;
  if (!entry.imageUrl) { _catalogFgCache.set(entry.key, null); return null; }
  // Alpha-channel extraction is the right method for PNG catalog icons
  let fg = await extractForegroundFromAlpha(entry.imageUrl);
  // Fall back to corner-based method for JPEGs (no alpha channel)
  if (!fg) fg = await extractForegroundRegion(entry.imageUrl);
  _catalogFgCache.set(entry.key, fg);
  return fg;
}

/**
 * NCC comparison where BOTH the zone image and each catalog image are
 * foreground-extracted first.  With backgrounds removed on both sides
 * the comparison focuses purely on the icon's spatial structure and shape.
 */
async function matchGiftFgVsFg(
  zoneFg: string,
  catalog: GiftCatalogEntry[],
  minScore = 0,
  size = 48,
): Promise<{ key: string; name: string; emoji?: string; similarity: number } | null> {
  let best: { key: string; name: string; emoji?: string; similarity: number } | null = null;
  for (const entry of catalog) {
    if (!entry.imageUrl) continue;
    try {
      const catFg = await getCatalogFg(entry);
      const ncc = await imageNCC(zoneFg, catFg ?? entry.imageUrl, size);
      const sim = (ncc + 1) / 2;
      if (sim >= minScore && (!best || sim > best.similarity)) {
        best = { key: entry.key, name: entry.name, emoji: entry.emoji, similarity: sim };
      }
    } catch { /* skip */ }
  }
  return best;
}

/**
 * Direct visual gift detection — four independent strategies, consensus required.
 *
 *   S1  NCC full frame @32×32           threshold 0.78 (high — noisy, used only for consensus)
 *   S2  NCC center 60% crop @32×32      threshold 0.78 (high — noisy, used only for consensus)
 *   S3  NCC fg-vs-fg @48×48             threshold 0.65 — PRIMARY STRATEGY
 *       Both zone image and catalog entry are foreground-extracted before
 *       comparison, eliminating background noise on both sides.
 *   S4  Hue-histogram Bhattacharyya on fg  threshold 0.62 — SECONDARY STRATEGY
 *
 * Consensus: same key in ≥2 strategies, or single strategy ≥0.88.
 */
async function detectVisualGiftInZone(
  imageDataUrl: string,
  catalog: GiftCatalogEntry[],
): Promise<{ match: { key: string; name: string; emoji?: string; similarity: number } | null; debugInfo: VisualGiftDebugInfo }> {
  const noResult = { match: null, debugInfo: { colorRegion: null, allScores: [], bestScore: 0, bestKey: '', zoneColor: null } };
  // Only bail if there's no input or truly no catalog entries to compare against.
  // Even without imageUrl on catalog entries, S5 uses hardcoded hue priors.
  if (!imageDataUrl || catalog.length === 0) return noResult;

  const candidates: Array<{ key: string; name: string; emoji?: string; similarity: number; strategy: string }> = [];
  const allScores: Array<{ strategy: string; key: string; score: number }> = [];

  // ── Pre-processing: find the most colorful region (the icon) ─────────────
  // The gift zone is large (e.g. 320×190). The actual icon is ~60 px inside.
  // Scaling the full zone to 32–48 px for NCC makes the icon ~6–9 px — useless.
  // findHotspotCrop scans with a saturation×brightness heatmap and returns
  // a 96×96 crop centered on the most colorful region (= the gift icon).
  // Corner-based foreground extraction also works much better on this tight crop
  // because the corners will be the dark card background, not random UI.
  const hotspot = await findHotspotCrop(imageDataUrl, 96, 8);
  const iconImage = hotspot ?? imageDataUrl;

  // ── S1: NCC full icon @32×32 (hotspot replaces full-frame) ───────────────
  const s1 = await matchGiftByNCC(iconImage, catalog, 0, 32);
  if (s1) {
    allScores.push({ strategy: 'ncc-full', key: s1.key, score: s1.similarity });
    if (s1.similarity >= 0.72) candidates.push({ ...s1, strategy: 'ncc-full' });
  }

  // ── S2: NCC center of icon @32×32 ────────────────────────────────────────
  const centerCanvas = document.createElement('canvas');
  await new Promise<void>((res) => {
    const img = new Image();
    img.onload = () => {
      const f = 0.6;
      const cw = Math.round(img.width * f), ch = Math.round(img.height * f);
      const cx = Math.round((img.width - cw) / 2), cy = Math.round((img.height - ch) / 2);
      centerCanvas.width = cw; centerCanvas.height = ch;
      centerCanvas.getContext('2d')!.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
      res();
    };
    img.onerror = () => res();
    img.src = iconImage;
  });
  if (centerCanvas.width > 0) {
    const centerCrop = centerCanvas.toDataURL('image/png');
    const s2 = await matchGiftByNCC(centerCrop, catalog, 0, 32);
    if (s2) {
      allScores.push({ strategy: 'ncc-center', key: s2.key, score: s2.similarity });
      if (s2.similarity >= 0.72) candidates.push({ ...s2, strategy: 'ncc-center' });
    }
  }

  // ── S3: NCC fg-vs-fg @48×48 — STRUCTURAL STRATEGY ───────────────────────
  // Works on the hotspot crop: corners are dark card background → reliable fg extraction
  const fgRegion = await extractForegroundRegion(iconImage);
  if (fgRegion) {
    const s3 = await matchGiftFgVsFg(fgRegion, catalog, 0, 48);
    if (s3) {
      allScores.push({ strategy: 'ncc-fg', key: s3.key, score: s3.similarity });
      if (s3.similarity >= 0.60) candidates.push({ ...s3, strategy: 'ncc-fg' });
    }
    // ── S4: hue histogram on fg ────────────────────────────────────────────
    const s4 = await matchGiftByHistogram(fgRegion, catalog, 0);
    if (s4) {
      allScores.push({ strategy: 'histogram', key: s4.key, score: s4.similarity });
      if (s4.similarity >= 0.60) candidates.push({ ...s4, strategy: 'histogram' });
    }
  } else {
    // No foreground found — run histogram on the hotspot directly
    const s4 = await matchGiftByHistogram(iconImage, catalog, 0);
    if (s4) {
      allScores.push({ strategy: 'histogram-full', key: s4.key, score: s4.similarity });
      if (s4.similarity >= 0.60) candidates.push({ ...s4, strategy: 'histogram-full' });
    }
  }

  // ── S5: dominant color (mean hue of colorful pixels) — COLOR STRATEGY ───
  // Works even without catalog reference images — uses GIFT_DOMINANT_HUES priors
  // as fallback. Fast, rotation-invariant, and highly discriminating.
  // Rosa≈340°, Coracao≈5°, TikTok≈188°, Universo≈258°, Urso≈28°, Coroa≈44°
  const zoneColor = await getZoneDominantColor(iconImage);
  const s5 = await matchGiftByDominantColor(iconImage, catalog, 0);
  if (s5) {
    allScores.push({ strategy: 'cor-dominante', key: s5.key, score: s5.similarity });
    if (s5.similarity >= 0.60) candidates.push({ ...s5, strategy: 'cor-dominante' });
  }

  const bestScore = allScores.length > 0 ? Math.max(...allScores.map((s) => s.score)) : 0;
  const bestEntry = allScores.find((s) => s.score === bestScore);
  const debugInfo: VisualGiftDebugInfo = {
    colorRegion: hotspot ?? fgRegion ?? null,  // show the hotspot crop in debug
    allScores,
    bestScore,
    bestKey: bestEntry?.key ?? '',
    zoneColor,
  };

  if (candidates.length === 0) {
    console.debug('[visual-gift] no match | scores:', allScores.map((s) => `${s.strategy}:${s.score.toFixed(3)}`).join(', '));
    return { match: null, debugInfo };
  }

  // ── Consensus: same key in ≥2 strategies, or single strategy ≥0.88 ───────
  const keyCounts = new Map<string, { count: number; best: typeof candidates[0] }>();
  for (const c of candidates) {
    const prev = keyCounts.get(c.key);
    if (!prev || c.similarity > prev.best.similarity) {
      keyCounts.set(c.key, { count: (prev?.count ?? 0) + 1, best: c });
    } else {
      keyCounts.set(c.key, { count: prev.count + 1, best: prev.best });
    }
  }

  // With the hotspot crop, single-strategy high-confidence fires at 0.82
  // (was 0.88 when using the noisy full zone).
  const qualified = [...keyCounts.values()]
    .filter((v) => v.count >= 2 || v.best.similarity >= 0.82)
    .sort((a, b) => b.best.similarity - a.best.similarity);

  if (qualified.length === 0) {
    console.debug('[visual-gift] no consensus |', candidates.map((c) => `${c.strategy}:${c.key}:${c.similarity.toFixed(3)}`).join(', '));
    return { match: null, debugInfo };
  }

  const winner = qualified[0].best;
  console.debug('[visual-gift] MATCH:', winner.key, winner.strategy, winner.similarity.toFixed(3));
  return { match: winner, debugInfo };
}

/**
 * Visual gift line resolution.
 *
 * For each line in `lines` that matches the gift verb pattern, look up the
 * corresponding verb bounding box in the OCR word list, crop the icon region
 * from the zone image, and compare it against catalog reference images.
 *
 * On a successful match the ambiguous OCR token (V, E, ", J, .3…) is replaced
 * with the exact catalog key (gift.coracao, gift.rosa…) so that both the server
 * and the client fallback can match it cleanly against trigger conditions.
 *
 * Falls back to the original line if: no catalog images, no verb bbox found,
 * crop fails, or similarity is below threshold.
 */
async function resolveGiftLinesVisually(
  lines: string[],
  words: OcrWord[],
  imageDataUrl: string,
  catalog: GiftCatalogEntry[],
): Promise<string[]> {
  if (!imageDataUrl || !words.length || !catalog.some((e) => e.imageUrl)) return lines;

  // Find all verb bboxes (one per gift notification row in the capture)
  const verbBBoxes = findAllVerbBBoxes(words);
  if (verbBBoxes.length === 0) return lines;

  const resolved: string[] = [];
  let bboxIndex = 0; // advance through verb bboxes as we process gift lines

  for (const line of lines) {
    const vm = GIFT_VERB_RE_CLIENT.exec(line);
    if (!vm) {
      resolved.push(line);
      continue;
    }

    // Pick the verb bbox for this notification row
    const bbox = verbBBoxes[Math.min(bboxIndex, verbBBoxes.length - 1)];
    bboxIndex++;

    try {
      const iconCrop = await cropGiftIconRegion(imageDataUrl, bbox);
      if (!iconCrop) { resolved.push(line); continue; }

      const match = await matchGiftInCatalog(iconCrop, catalog);
      if (!match) { resolved.push(line); continue; }

      // Rebuild the line with the confirmed catalog key
      const sender = vm[1].trim();
      const countSuffix = vm[3] ? ` x${vm[3]}` : '';
      resolved.push(`${sender} enviou ${match.key}${countSuffix}`);
    } catch {
      resolved.push(line); // any error → keep original
    }
  }

  return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight image fingerprint used to skip OCR when the zone pixels
 * haven't changed between cycles. Samples key positions in the base64
 * PNG data URL — same pixels always produce the same fingerprint.
 */
function zoneImgFingerprint(dataUrl: string): string {
  const L = dataUrl.length;
  if (L < 200) return dataUrl;
  // Sample: length + chars at 8 evenly-spaced positions (each 24 chars wide)
  let fp = String(L);
  const step = Math.floor(L / 8);
  for (let i = 1; i <= 8; i++) fp += '|' + dataUrl.substring(i * step, i * step + 24);
  return fp;
}

/**
 * Given a single OCR line from a gifts zone, return a clean gift key
 * (the gift name as it will be matched against trigger conditions).
 * Returns null if the line doesn't look like a gift name.
 *
 * Handles patterns:
 *   "Follow"              → "Follow"
 *   "Follow x2"           → "Follow"
 *   "@user Follow x1"     → "Follow"
 *   "user: Follow"        → "Follow"
 *   "user enviou Follow"  → "Follow"
 */
function extractGiftKey(line: string): string | null {
  // Strip trailing count: "x2", "× 3", "x 10"
  let text = line.replace(/\s*[x×]\s*\d+\s*$/i, '').trim();

  // Full format with Portuguese/English verb: "sender enviou/sent giftName"
  const fullGiftRe = /^.{1,40}?\s+(?:enviou|mandou|presenteou\s+com|sent)\s+(.+)$/i;
  const fullMatch = fullGiftRe.exec(text);
  if (fullMatch) {
    text = fullMatch[1].trim();
  } else {
    // Strip "user: " prefix
    text = text.replace(/^@?[^\s:]{1,40}:\s*/, '').trim();
    // Strip "@user " prefix
    text = text.replace(/^@[^\s]+\s+/, '').trim();
  }

  if (text.length < 2 || text.length > 50) return null;
  if (text.startsWith('@')) return null;
  // Reject if it looks like a regular chat sentence (too many words)
  if (text.trim().split(/\s+/).length > 5) return null;
  return text;
}

// ─── Client-side OCR→trigger fallback ────────────────────────────────────────
//
// Used when the server returns the old format (simulated: true) — i.e. the
// Node.js process hasn't been restarted yet to load the new /ocr/ingest handler.
// In that case we parse each OCR line here in the browser and call the
// /video/trigger endpoint that already exists in the old server.

const GIFT_VERB_RE_CLIENT =
  /^([^@\s][^:]{1,40}?)\s+(?:enviou|mandou|presenteou\s+com|sent)\s+(.+?)(?:\s+[x×]\s*(\d+))?\s*$/i;

const GIFT_TIKTOK_RE_CLIENT =
  /^(.{2,40}?)\s+([^\s]{1,12})\s+[x×]\s*(\d+)\s*$/i;

const OCR_EMOJI_MAP_CLIENT: Record<string, string> = {
  o: 'heart', '0': 'heart',
  v: 'heart',  // ❤ V-shape OCR artifact
  e: 'heart',  // ❤ E-shape OCR artifact
  j: 'heart',  // ❤ J-shape OCR artifact
  '"': 'heart', // ❤ quote OCR artifact (Tesseract reads curved heart as ")
  "'": 'heart', // ❤ single-quote OCR artifact
  d: 'diamond',
  r: 'rose',
  f: 'follow',
  l: 'like',
};

/** Maps a canonical giftKey to a display emoji for the Presentes panel. */
const GIFT_KEY_EMOJI: Record<string, string> = {
  heart: '❤️',
  diamond: '💎',
  rose: '🌹',
  follow: '➕',
  like: '👍',
  star: '⭐',
  crown: '👑',
  fire: '🔥',
  music: '🎵',
  cake: '🎂',
};
function giftKeyToEmoji(key: string): string {
  return GIFT_KEY_EMOJI[(key ?? '').toLowerCase()] ?? '🎁';
}

/** Get display emoji for a gift key, checking the live catalog first. */
function getGiftEmoji(key: string, catalog: GiftCatalogEntry[]): string {
  const entry = catalog.find((e) => e.key === key);
  return entry?.emoji || giftKeyToEmoji(key);
}

function normaliseGiftKeyClient(raw: string, fromVerbPattern = false): string {
  const s = raw.trim();
  if (s.length === 1) {
    // For single-char OCR artifacts from verb patterns ("Lucas enviou V/E/"/J"),
    // default to 'heart' if not explicitly in the map — the heart emoji is by far
    // the most common gift and all these artifacts come from its curved glyph.
    return OCR_EMOJI_MAP_CLIENT[s.toLowerCase()] ?? (fromVerbPattern ? 'heart' : s);
  }
  return s;
}

/**
 * Parses a single OCR line and returns trigger-ready event data,
 * or null if it looks like a plain chat message.
 */
function parseOcrLineForTrigger(
  line: string,
  zoneRole: string,
): { eventType: 'gift' | 'comment'; giftKey?: string; text?: string; sender?: string; ocrRaw?: string } | null {
  const verbMatch = GIFT_VERB_RE_CLIENT.exec(line);
  if (verbMatch) {
    return {
      eventType: 'gift',
      // fromVerbPattern=true so unknown single-char OCR artifacts (", J, E…)
      // default to 'heart' instead of being passed through as raw garbage.
      giftKey: normaliseGiftKeyClient(verbMatch[2], true),
      sender: verbMatch[1].trim(),
    };
  }
  // Pattern B — TikTok "Username [emoji/short-token] x[N]"
  // Requires an explicit count suffix (x1, x2, ×3…) which is the strong
  // signal that this is a gift notification and NOT a chat message.
  // We never fall back to "everything in a gifts zone = gift" because chat
  // and gifts share the same on-screen area on TikTok.
  const tiktokMatch = GIFT_TIKTOK_RE_CLIENT.exec(line);
  if (tiktokMatch) {
    return {
      eventType: 'gift',
      giftKey: normaliseGiftKeyClient(tiktokMatch[2]),
      sender: tiktokMatch[1].trim(),
      ocrRaw: tiktokMatch[2],
    };
  }
  // Nothing matched → treat as plain chat, no trigger
  return { eventType: 'comment', text: line };
}

/**
 * Fallback for when the server is running the old API handler (no /ocr/ingest).
 * Parses lines client-side and fires each event via POST /video/trigger,
 * which exists in the old server and does trigger matching + video state update.
 */
async function clientSideIngestFallback(
  freshLines: string[],
  zoneRole: string,
  apiUrlFn: (path: string) => string,
): Promise<OcrIngestResult> {
  const triggered: OcrIngestResult['triggered'] = [];
  const noMatch: OcrIngestResult['noMatch'] = [];

  for (const line of freshLines) {
    const parsed = parseOcrLineForTrigger(line, zoneRole);
    if (!parsed) continue;

    try {
      const payload =
        parsed.eventType === 'gift'
          ? { eventType: 'gift', giftKey: parsed.giftKey, gift_key: parsed.giftKey }
          : { eventType: 'comment', text: parsed.text, message: parsed.text };

      const res = await fetch(apiUrlFn('/video/trigger'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean; matched?: boolean; triggered?: boolean;
        trigger?: { id: string; name: string }; targetVideoId?: string;
      } | null;

      if (data?.matched && data?.triggered && data?.targetVideoId) {
        triggered.push({
          triggerId: data.trigger?.id ?? '',
          triggerName: data.trigger?.name ?? '',
          targetVideoId: data.targetVideoId,
          queueSize: 1,
          line,
          eventType: parsed.eventType,
          kind: parsed.eventType === 'gift' ? 'gift' : 'chat',
          giftKey: parsed.giftKey,
          sender: parsed.sender,
          ocrRaw: parsed.ocrRaw,
        });
      } else {
        noMatch.push({
          eventType: parsed.eventType,
          kind: parsed.eventType === 'gift' ? 'gift' : 'chat',
          line,
          giftKey: parsed.giftKey,
          sender: parsed.sender,
          ocrRaw: parsed.ocrRaw,
          reason: data?.matched === false ? 'no_trigger_match' : 'no_video_configured',
        });
      }
    } catch {
      noMatch.push({ eventType: parsed.eventType, kind: 'chat', line, reason: 'request_failed' });
    }
  }

  return { triggered, noMatch, linesProcessed: freshLines.length };
}

function normalizeDirectUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Informe o link da live antes de abrir.');
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Use um link http ou https valido.');
  }
  return parsed.toString();
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Nao foi possivel preparar o frame da pagina.'));
    image.src = src;
  });
}

function TypewriterText({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    let i = 0;
    const resetTimer = window.setTimeout(() => setDisplayed(''), 0);
    const interval = window.setInterval(() => {
      setDisplayed(text.substring(0, i));
      i += 1;
      if (i > text.length) {
        window.clearInterval(interval);
      }
    }, 12);

    return () => {
      window.clearTimeout(resetTimer);
      window.clearInterval(interval);
    };
  }, [text]);

  const separators = [':', ' < ', ' > ', ' comecou a ver', ' Novo seguidor', ' curtiu'];
  let usernameLen = 0;

  for (const sep of separators) {
    const idx = text.indexOf(sep);
    if (idx > 0 && idx < 28) {
      usernameLen = idx;
      break;
    }
  }

  if (!usernameLen) {
    const firstSpace = text.indexOf(' ');
    if (firstSpace > 2 && firstSpace < 16) {
      usernameLen = firstSpace;
    }
  }

  return (
    <span>
      {usernameLen > 0 && (
        <strong className="text-amber-300">{displayed.substring(0, usernameLen)}</strong>
      )}
      <span className="text-[var(--t1)]">{displayed.substring(usernameLen)}</span>
    </span>
  );
}

function StatusChip({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: 'good' | 'warn' | 'idle' | 'danger';
  icon?: React.ReactNode;
}) {
  const tones = {
    good: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
    warn: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
    idle: 'border-[var(--border2)] bg-[var(--bg2)]/70 text-[var(--t2)]',
    danger: 'border-rose-400/30 bg-rose-500/10 text-rose-200',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
        tones[tone],
      )}
    >
      {icon}
      {label}
    </span>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-center justify-between text-xs">
        <span className="font-semibold text-[var(--t3)]">{label}</span>
        <span className="rounded bg-[var(--bg2)] px-2 py-0.5 font-mono text-[11px] text-[var(--t1)]">
          {Number.isInteger(value) ? value : value.toFixed(1)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full accent-sky-400"
      />
    </label>
  );
}

const CaptureStudio = React.memo(function CaptureStudio({
  capturedText,
  setCapturedText,
  autopilotEnabled = false,
  pendingAutopilotEvents = 0,
  latestAutopilotActionStatus,
  onStartAutopilot,
}: CaptureStudioProps) {
  const storedState = useMemo(() => getStoredState(), []);
  const [status, setStatus] = useState<CaptureStatus>(CaptureStatus.IDLE);
  const [captureMode, setCaptureMode] = useState<CaptureSourceMode>(
    storedState?.captureMode === 'direct' ? 'direct' : 'screen',
  );
  const [sourceName, setSourceName] = useState(storedState?.sourceName || DEFAULT_OBS_SOURCE_NAME);
  const [directUrl, setDirectUrl] = useState(storedState?.directUrl || '');
  const [isOpeningDirectLink, setIsOpeningDirectLink] = useState(false);
  const [directLinkStatus, setDirectLinkStatus] = useState<string | null>(null);
  const [directPageUrl, setDirectPageUrl] = useState(storedState?.directUrl || '');
  const [directPageReady, setDirectPageReady] = useState(false);
  const [directPageMode, setDirectPageMode] = useState<DirectPageMode>('interact');
  const [directPageState, setDirectPageState] = useState<DirectPageState>(
    storedState?.directUrl ? 'loading' : 'none',
  );
  const [directCaptureState, setDirectCaptureState] = useState<DirectCaptureState>('unavailable');
  const [directCapturePreview, setDirectCapturePreview] = useState<string | null>(null);
  const [directCaptureSize, setDirectCaptureSize] = useState<{ width: number; height: number } | null>(null);
  const [directCaptureError, setDirectCaptureError] = useState<string | null>(null);
  const [presets, setPresets] = useState<CapturePreset[]>(
    storedState?.presets?.length ? storedState.presets : clonePresets(DEFAULT_PRESETS),
  );
  const [activePresetId, setActivePresetId] = useState<string>(
    storedState?.activePresetId || 'stream-main',
  );
  const [activeZoneIndex, setActiveZoneIndex] = useState(0);
  const [settings, setSettings] = useState<CaptureSettings>({
    ...DEFAULT_SETTINGS,
    ...(storedState?.settings || {}),
    intervalTime: Math.max(
      250,
      Number(storedState?.settings?.intervalTime || DEFAULT_SETTINGS.intervalTime),
    ),
  });
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [obsHealth, setObsHealth] = useState<ObsHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthCheckedAt, setHealthCheckedAt] = useState('Nunca');
  const [captureEvents, setCaptureEvents] = useState<CaptureEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastCaptureTime, setLastCaptureTime] = useState('Nunca');
  const [currentRawText, setCurrentRawText] = useState('');
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [frameWarning, setFrameWarning] = useState<string | null>(null);
  const [isSelectingRegion, setIsSelectingRegion] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [currentSelection, setCurrentSelection] = useState<SelectionRect | null>(null);
  const [draggingZoneIndex, setDraggingZoneIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [resizingZoneIndex, setResizingZoneIndex] = useState<number | null>(null);

  const livePreviewRef = useRef<HTMLVideoElement | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const directWebviewRef = useRef<ElectronWebviewElement | null>(null);
  const directIframeRef = useRef<HTMLIFrameElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventsScrollRef = useRef<HTMLDivElement | null>(null);
  const isBusyRef = useRef(false);
  const zonesRef = useRef<CaptureZone[]>([]);
  const settingsRef = useRef(settings);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const lastFrameHashRef = useRef<string | null>(null);
  const repeatedFrameCountRef = useRef(0);
  const lastOpenedDirectUrlRef = useRef<string | null>(storedState?.directUrl || null);
  const runCaptureCycleRef = useRef<(() => Promise<void>) | null>(null);

  // OCR engine for screen-capture mode.
  // Unified interface so TextDetector and Tesseract.js are interchangeable.
  const ocrWorkerRef = useRef<{
    recognize: (img: string) => Promise<{ data: { text: string; words?: OcrWord[] } }>;
    terminate?: () => Promise<void>;
  } | null>(null);
  const ocrInitStartedRef = useRef(false);
  const ocrLoadingRef = useRef(false);
  const ocrErrorRef = useRef<string | null>(null);

  // Gift catalog — kept in sync with localStorage (updated by ReactiveFlowBoard).
  // Used for visual gift icon matching during the OCR capture loop.
  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogEntry[]>([]);
  useEffect(() => {
    setGiftCatalog(loadGiftCatalog());
    const onStorage = (e: StorageEvent) => {
      if (e.key?.includes('gift-catalog')) setGiftCatalog(loadGiftCatalog());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Visual detection debug — shows what the algorithm is seeing.
  // Declared here (before handleSaveVisualReference) so the useCallback
  // dependency array [visualDebug, ...] does not reference it in TDZ.
  const [visualDebug, setVisualDebug] = useState<{
    zoneImageUrl: string;    // full zone capture (what the camera sees)
    regionDataUrl: string;   // extracted colorful region (or '' if none)
    bestKey: string;         // best catalog match key
    bestScore: number;       // best similarity score (0–1) across all strategies
    fired: boolean;          // whether threshold was exceeded and trigger fired
    time: string;
    allScores: Array<{ strategy: string; key: string; score: number }>;
    zoneColor: [number, number, number] | null;  // dominant hue/sat/val of hotspot
  } | null>(null);

  // Selected gift key for the "Salvar como referência" button in the debug panel
  const [refSaveKey, setRefSaveKey] = useState<string>('');
  const [refSaved, setRefSaved] = useState(false);

  const handleSaveVisualReference = useCallback(() => {
    if (!visualDebug?.regionDataUrl || !refSaveKey) return;
    const imageUrl = visualDebug.regionDataUrl;
    setGiftCatalog(prev => {
      const updated = prev.map(e =>
        e.key === refSaveKey
          ? { ...e, imageUrl, updatedAt: new Date().toISOString() }
          : e,
      );
      saveGiftCatalog(updated);
      // Invalidate caches so the new reference takes effect on the next frame
      _catalogFgCache.delete(refSaveKey);
      _catalogColorCache.delete(refSaveKey);
      return updated;
    });
    setRefSaved(true);
    setTimeout(() => setRefSaved(false), 2000);
  }, [visualDebug, refSaveKey]);

  // Per-zone deduplication: zoneId → Map<normalizedLine, timestampMs>
  const lineSeenRef = useRef<Map<string, Map<string, number>>>(new Map());
  // Per-zone last image fingerprint — skip OCR entirely if pixels haven't changed
  const lastZoneImgFpRef = useRef<Map<string, string>>(new Map());
  // Per-gift-key last fired timestamp — prevents same sticker from firing twice
  const lastGiftFiredRef = useRef<Map<string, number>>(new Map());

  // Recently detected gift stickers
  const [recentGifts, setRecentGifts] = useState<
    Array<{ id: string; name: string; emoji: string; count: number; time: string; triggered: boolean; sender?: string; ocrRaw?: string }>
  >([]);

  const activePreset = useMemo(
    () => presets.find((preset) => preset.id === activePresetId) || presets[0],
    [activePresetId, presets],
  );
  const zones = useMemo(() => activePreset?.zones || [], [activePreset?.zones]);
  const activeZone = zones[activeZoneIndex] || zones[0];

  const lastEvent = captureEvents[captureEvents.length - 1];
  const successfulEvents = useMemo(
    () => captureEvents.filter((event) => event.routeStatus !== 'error'),
    [captureEvents],
  );
  const { averageConfidence, averageLatency } = useMemo(() => {
    let confidenceSum = 0;
    let confidenceCount = 0;
    let latencySum = 0;
    let latencyCount = 0;
    for (const event of successfulEvents) {
      if (event.confidence !== null && event.confidence !== undefined) {
        confidenceSum += event.confidence;
        confidenceCount++;
      }
      if (event.latencyMs !== null && event.latencyMs !== undefined) {
        latencySum += event.latencyMs;
        latencyCount++;
      }
    }
    return {
      averageConfidence: confidenceSum / Math.max(1, confidenceCount),
      averageLatency: latencySum / Math.max(1, latencyCount),
    };
  }, [successfulEvents]);
  const desktopRuntime = (window as ElectronRuntimeWindow).odessaDesktop;
  const isElectronRuntime = Boolean(desktopRuntime?.isElectron);
  const canUseDirectWebCapture = Boolean(desktopRuntime?.canUseDirectWebCapture);
  const runtimeRenderer = isElectronRuntime ? 'electron' : 'browser';

  // ----- Webview diagnostic log state (visible in the console visual) -----
  const [webviewLogs, setWebviewLogs] = useState<string[]>([]);
  const addDirectLog = useCallback((msg: string) => {
    const line = `[${formatClock()}] ${msg}`;
    setWebviewLogs((prev) => [...prev.slice(-80), line]);
    if (settingsRef.current.debugMode) {

      console.log(line);
    }
  }, []);
  const backendOnline = backendHealth?.status === 'ok' && !healthError;

  // When running in browser mode (not Electron), route the iframe through
  // the backend proxy to strip X-Frame-Options / CSP headers.
  const directRenderer: DirectRenderer = useMemo(() => {
    if (!directPageUrl) return 'none';
    if (isElectronRuntime) return 'electron-webview';
    return backendOnline ? 'proxy-preview' : 'iframe';
  }, [backendOnline, directPageUrl, isElectronRuntime]);
  const proxyIframeUrl = useMemo(() => {
    if (!directPageUrl) return '';
    if (isElectronRuntime) return directPageUrl; // webview doesn't need proxy
    // Derive the server origin from API_BASE_URL (e.g. http://localhost:8000)
    const apiOrigin = API_BASE_URL.replace(/\/api.*$/, '');
    return `${apiOrigin}/proxy?url=${encodeURIComponent(directPageUrl)}`;
  }, [directPageUrl, isElectronRuntime]);
  const obsReady = Boolean(
    obsHealth?.ok && obsHealth.connected && obsHealth.sourceReady && obsHealth.screenshotReady,
  );
  const screenReady = Boolean(screenStream?.active);
  const directReady = Boolean(
    directPageUrl &&
      isElectronRuntime &&
      directRenderer === 'electron-webview' &&
      directPageReady &&
      directPageState === 'rendered',
  );
  const directCaptureTested = directCaptureState === 'tested' && Boolean(directCapturePreview);
  const sourceReady =
    captureMode === 'screen' ? screenReady : captureMode === 'direct' ? directReady : obsReady;
  const hasDirectUrl = directUrl.trim().length > 0;
  const canStartCapture =
    backendOnline &&
    status !== CaptureStatus.CAPTURING &&
    (captureMode === 'screen' ||
      (captureMode === 'direct' ? directReady && directCaptureTested : sourceReady));
  const hasPreview =
    captureMode === 'screen'
      ? screenReady
      : captureMode === 'direct'
        ? Boolean(directPageUrl)
        : Boolean(previewImage);
  const canEditZones = captureMode !== 'direct' || directPageMode === 'crop' || isSelectingRegion;

  useEffect(() => {
    if (captureMode !== 'direct') return;
    addDirectLog(`[Runtime] Electron detectado: ${isElectronRuntime}`);
    addDirectLog(`[Runtime] isElectron=${isElectronRuntime}`);
    addDirectLog(`[Runtime] canUseDirectWebCapture=${canUseDirectWebCapture}`);
    addDirectLog(`[Runtime] renderer=${runtimeRenderer}`);
    addDirectLog(`[LinkDireto] webviewTag habilitado: ${Boolean(desktopRuntime?.webviewTagEnabled)}`);
  }, [
    addDirectLog,
    canUseDirectWebCapture,
    captureMode,
    desktopRuntime?.webviewTagEnabled,
    isElectronRuntime,
    runtimeRenderer,
  ]);

  const updateActivePresetZones = useCallback(
    (updater: CaptureZone[] | ((current: CaptureZone[]) => CaptureZone[])) => {
      setPresets((currentPresets) =>
        currentPresets.map((preset) => {
          if (preset.id !== activePresetId) return preset;
          const nextZones = typeof updater === 'function' ? updater(preset.zones) : updater;
          return { ...preset, zones: nextZones };
        }),
      );
    },
    [activePresetId],
  );

  const updateSettings = <Key extends keyof CaptureSettings>(
    key: Key,
    value: CaptureSettings[Key],
  ) => {
    const nextValue =
      key === 'intervalTime'
        ? (Math.max(250, Number(value) || DEFAULT_SETTINGS.intervalTime) as CaptureSettings[Key])
        : value;
    setSettings((current) => ({ ...current, [key]: nextValue }));
  };

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/health'));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as BackendHealth;
      setBackendHealth(data);
      setHealthError(null);
      setHealthCheckedAt(formatClock());
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : 'Backend indisponivel');
      setBackendHealth(null);
      setHealthCheckedAt(formatClock());
    }
  }, []);

  const refreshObsHealth = useCallback(async () => {
    try {
      const params = new URLSearchParams({ sourceName });
      const response = await fetch(apiUrl(`/obs/health?${params.toString()}`));
      const data = (await response.json().catch(() => ({}))) as ObsHealth;
      setObsHealth(data);
      if (!response.ok || !data.ok) {
        setError(data.error || `OBS indisponivel: HTTP ${response.status}`);
      } else {
        setError((current) => (current?.startsWith('OBS') ? null : current));
      }
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OBS WebSocket indisponivel';
      const data: ObsHealth = {
        ok: false,
        connected: false,
        sourceReady: false,
        sourceName,
        currentScene: null,
        screenshotReady: false,
        error: message,
      };
      setObsHealth(data);
      setError(message);
      return data;
    }
  }, [sourceName]);

  const noteFrameMetadata = useCallback((frameHash?: string | null, capturedAt?: string | null) => {
    if (!frameHash) return;
    if (lastFrameHashRef.current === frameHash) {
      repeatedFrameCountRef.current += 1;
    } else {
      lastFrameHashRef.current = frameHash;
      repeatedFrameCountRef.current = 0;
      setFrameWarning(null);
      return;
    }

    if (repeatedFrameCountRef.current >= 3) {
      const when = capturedAt ? ` Capturado em ${new Date(capturedAt).toLocaleTimeString()}.` : '';
      setFrameWarning(
        `OBS retornou o mesmo frame ${repeatedFrameCountRef.current + 1} vezes.${when} Atualize a Browser Source se o chat estiver parado.`,
      );
    }
  }, []);

  const refreshObsPreview = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/obs/screenshot'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceName, format: 'png' }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        image?: string | null;
        width?: number | null;
        height?: number | null;
        frameHash?: string | null;
        capturedAt?: string | null;
        error?: string | null;
      };
      if (!response.ok || !data.ok || !data.image) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setPreviewImage(data.image);
      if (data.width && data.height) setPreviewSize({ width: data.width, height: data.height });
      noteFrameMetadata(data.frameHash, data.capturedAt);
      setStatus((current) => (current === CaptureStatus.CAPTURING ? current : CaptureStatus.SELECTING));
      setError(null);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao capturar preview OBS');
      setStatus(CaptureStatus.ERROR);
      return null;
    }
  }, [noteFrameMetadata, sourceName]);

  const clearCaptureTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleScreenShareEnded = useCallback(() => {
    clearCaptureTimer();
    screenStreamRef.current = null;
    setScreenStream(null);
    setStatus(CaptureStatus.IDLE);
    setIsProcessing(false);
    isBusyRef.current = false;
    setError('Compartilhamento da janela encerrado.');
  }, [clearCaptureTimer]);

  const stopScreenStream = useCallback(() => {
    const stream = screenStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    screenStreamRef.current = null;
    setScreenStream(null);
    if (livePreviewRef.current) {
      livePreviewRef.current.srcObject = null;
    }
  }, []);

  const requestScreenStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Captura de janela/tela nao esta disponivel neste navegador.');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', handleScreenShareEnded, { once: true });
    });
    screenStreamRef.current = stream;
    setScreenStream(stream);
    setPreviewImage(null);
    setFrameWarning(null);
    setError(null);
    return stream;
  }, [handleScreenShareEnded]);

  const updateDirectPageSize = useCallback(() => {
    const element = directWebviewRef.current || directIframeRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || element.clientWidth || 1));
    const height = Math.max(1, Math.round(rect.height || element.clientHeight || 1));
    const nextSize = { width, height };
    setPreviewSize(nextSize);
    return nextSize;
  }, []);

  useEffect(() => {
    zonesRef.current = zones;
  }, [zones]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    screenStreamRef.current = screenStream;
    const video = livePreviewRef.current;
    if (!video) return;
    if (!screenStream) {
      video.srcObject = null;
      return;
    }
    video.srcObject = screenStream;
    void video.play().catch(() => undefined);
  }, [screenStream]);

  useEffect(() => {
    return () => {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Initialise OCR engine when screen capture mode is active.
  // Tries window.TextDetector first (instant, no download — Chrome/Edge when OS supports it).
  // Falls back to Tesseract.js (~10 MB download on first use, works in ALL browsers).
  useEffect(() => {
    if (captureMode !== 'screen' || ocrInitStartedRef.current) return;
    ocrInitStartedRef.current = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const TD = typeof (window as any).TextDetector === 'function' ? (window as any).TextDetector : null;
    if (TD) {
      try {
        const td = new TD() as { detect: (img: HTMLImageElement) => Promise<Array<{ rawValue: string }>> };
        ocrWorkerRef.current = {
          recognize: async (imageDataUrl: string) => {
            const img = await loadImageElement(imageDataUrl);
            const texts = await td.detect(img);
            return { data: { text: texts.map((t) => t.rawValue).join('\n') } };
          },
        };
        return; // TextDetector ready — no Tesseract needed
      } catch {
        // TextDetector instantiation failed — fall through to Tesseract.js
      }
    }

    ocrLoadingRef.current = true;
    import('tesseract.js')
      .then(({ createWorker }) => createWorker('por', 1, { logger: () => undefined }))
      .then((worker) => {
        ocrWorkerRef.current = {
          recognize: async (img: string) => {
            const result = await worker.recognize(img);
            // Flatten the nested blocks→paragraphs→lines→words tree into a flat array.
            // Each word carries its bounding box (x0,y0,x1,y1) in image-pixel space,
            // which we use later to locate the gift icon to the right of "enviou".
            const words: OcrWord[] = [];
            for (const block of result.data.blocks ?? []) {
              for (const para of block.paragraphs ?? []) {
                for (const line of para.lines ?? []) {
                  for (const word of line.words ?? []) {
                    words.push({ text: word.text, bbox: word.bbox, confidence: word.confidence });
                  }
                }
              }
            }
            return { data: { text: result.data.text, words } };
          },
          terminate: () => worker.terminate().then(() => undefined),
        };
        ocrLoadingRef.current = false;
      })
      .catch((err: unknown) => {
        ocrLoadingRef.current = false;
        ocrErrorRef.current = err instanceof Error ? err.message : 'Falha ao carregar OCR';
        ocrInitStartedRef.current = false; // allow retry on next mount
      });
  }, [captureMode]);

  // Terminate Tesseract worker when component unmounts
  useEffect(() => {
    return () => {
      void ocrWorkerRef.current?.terminate?.();
    };
  }, []);

  useEffect(() => {
    if (captureMode !== 'obs') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(apiUrl('/obs/settings'));
          const data = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            settings?: { ocrSourceName?: unknown };
          };
          const nextSource = data.settings?.ocrSourceName;
          if (!cancelled && data.ok && typeof nextSource === 'string' && nextSource.trim()) {
            setSourceName(nextSource.trim());
          }
        } catch {
          // The local CaptureStudio state remains usable when settings are offline.
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [captureMode]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activePresetId,
        captureMode: captureMode === 'direct' ? 'direct' : 'screen',
        directUrl,
        presets,
        settings,
        sourceName,
      }),
    );
  }, [activePresetId, captureMode, directUrl, presets, settings, sourceName]);

  // ----- Webview diagnostic listeners (tasks 2 & 3) -----
  useEffect(() => {
    if (captureMode !== 'direct' || !directPageUrl) return;
    const webview = directWebviewRef.current;
    if (!webview) return;

    const addLog = (msg: string) => {
      const ts = formatClock();
      const line = `[${ts}] [LinkDireto] ${msg}`;
      setWebviewLogs((prev) => [...prev.slice(-80), line]);
      if (settings.debugMode) {

        console.log(line);
      }
    };

    addLog(`webview attached – src=${directPageUrl}`);

    addLog('Renderer escolhido: webview');
    addLog('webview anexado ao DOM');

    const onStartLoading = () => {
      addLog('did-start-loading');
      setDirectPageState('loading');
      setDirectCaptureState('available');
      setDirectCaptureError(null);
    };
    const onStopLoading = () => {
      addLog('did-stop-loading');
      updateDirectPageSize();
    };
    const onDomReady = () => {
      addLog('dom-ready');
      setDirectPageState('dom-ready');
      setDirectPageReady(false);
      setIsOpeningDirectLink(false);
      setDirectLinkStatus(`DOM pronto as ${formatClock()}`);
      updateDirectPageSize();
      setError(null);
      // Check capturePage availability
      const hasCapture = typeof webview.capturePage === 'function';
      addLog(`capturePage disponivel: ${hasCapture}`);
      setDirectCaptureState(hasCapture ? 'available' : 'unavailable');
    };
    const onFinishLoad = () => {
      addLog('did-finish-load');
      setDirectPageState('rendered');
      setDirectPageReady(true);
      setIsOpeningDirectLink(false);
      setDirectLinkStatus(`Renderizada as ${formatClock()}; teste a captura antes de iniciar OCR.`);
      updateDirectPageSize();
      setError(null);
    };
    const onFailLoad = (event: Event) => {
      const details = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        validatedURL?: string;
        isMainFrame?: boolean;
      };
      if (details.isMainFrame === false) return;
      addLog(
        `did-fail-load: errorCode=${details.errorCode ?? '?'}, ` +
        `errorDescription=${details.errorDescription ?? '?'}, ` +
        `validatedURL=${details.validatedURL ?? '?'}`,
      );
      setDirectPageState('failed');
      setDirectPageReady(false);
      setDirectCaptureState('unavailable');
      setIsOpeningDirectLink(false);
      setDirectLinkStatus(null);
      setError(details.errorDescription || 'Nao foi possivel carregar a pagina direta.');
    };
    const onConsoleMessage = (event: Event) => {
      const msg = (event as Event & { message?: string }).message;
      if (msg) addLog(`console-message da pagina: ${msg.slice(0, 200)}`);
    };
    const onCrashed = () => {
      addLog('CRASHED / render-process-gone');
      setDirectPageState('failed');
      setDirectPageReady(false);
      setDirectCaptureState('unavailable');
    };

    webview.addEventListener('did-start-loading', onStartLoading);
    webview.addEventListener('did-stop-loading', onStopLoading);
    webview.addEventListener('dom-ready', onDomReady);
    webview.addEventListener('did-finish-load', onFinishLoad);
    webview.addEventListener('did-fail-load', onFailLoad);
    webview.addEventListener('console-message', onConsoleMessage);
    webview.addEventListener('crashed', onCrashed);
    webview.addEventListener('render-process-gone', onCrashed);

    window.requestAnimationFrame(() => updateDirectPageSize());

    return () => {
      webview.removeEventListener('did-start-loading', onStartLoading);
      webview.removeEventListener('did-stop-loading', onStopLoading);
      webview.removeEventListener('dom-ready', onDomReady);
      webview.removeEventListener('did-finish-load', onFinishLoad);
      webview.removeEventListener('did-fail-load', onFailLoad);
      webview.removeEventListener('console-message', onConsoleMessage);
      webview.removeEventListener('crashed', onCrashed);
      webview.removeEventListener('render-process-gone', onCrashed);
    };
  }, [captureMode, directPageUrl, settings.debugMode, updateDirectPageSize]);

  useEffect(() => {
    if (!captureEvents.length || !eventsScrollRef.current) return;
    eventsScrollRef.current.scrollTop = eventsScrollRef.current.scrollHeight;
  }, [captureEvents.length]);

  useEffect(() => {
    const firstRun = window.setTimeout(refreshHealth, 0);
    const obsFirstRun =
      captureMode === 'obs'
        ? window.setTimeout(() => {
            void refreshObsHealth();
            void refreshObsPreview();
          }, 250)
        : null;
    const interval = window.setInterval(refreshHealth, 15000);
    const obsInterval =
      captureMode === 'obs' ? window.setInterval(refreshObsHealth, 15000) : null;
    return () => {
      window.clearTimeout(firstRun);
      if (obsFirstRun) window.clearTimeout(obsFirstRun);
      window.clearInterval(interval);
      if (obsInterval) window.clearInterval(obsInterval);
    };
  }, [captureMode, refreshHealth, refreshObsHealth, refreshObsPreview]);


  const pauseCapture = useCallback(() => {
    setStatus(CaptureStatus.IDLE);
    clearCaptureTimer();
  }, [clearCaptureTimer]);

  const changeCaptureMode = useCallback(
    (mode: CaptureSourceMode) => {
      if (mode === captureMode) return;
      clearCaptureTimer();
      setStatus(CaptureStatus.IDLE);
      setIsSelectingRegion(false);
      setCaptureMode(mode);
      setError(null);
      setFrameWarning(null);
      if (mode !== 'screen') {
        stopScreenStream();
        if (mode === 'direct') {
          setPreviewImage(null);
          setDirectPageMode('interact');
        }
      } else {
        setPreviewImage(null);
      }
      setDirectLinkStatus(null);
    },
    [captureMode, clearCaptureTimer, stopScreenStream],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const addZone = () => {
    if (zones.length >= MAX_ZONES) return;
    const nextZone: CaptureZone = {
      id: `zone-${Date.now()}`,
      name: `Zona ${zones.length + 1}`,
      role: 'custom',
      color: '#A78BFA',
      x: 140 + zones.length * 28,
      y: 140 + zones.length * 28,
      width: 300,
      height: 200,
    };
    updateActivePresetZones((currentZones) => [...currentZones, nextZone]);
    setActiveZoneIndex(zones.length);
  };

  const removeZone = (idx: number) => {
    if (zones.length <= 1) return;
    updateActivePresetZones((currentZones) => currentZones.filter((_, index) => index !== idx));
    setActiveZoneIndex((currentIndex) => Math.max(0, Math.min(currentIndex, zones.length - 2)));
  };

  const updateZone = (idx: number, patch: Partial<CaptureZone>) => {
    updateActivePresetZones((currentZones) =>
      currentZones.map((zone, index) => (index === idx ? { ...zone, ...patch } : zone)),
    );
  };

  const resetPreset = () => {
    const defaultPreset = DEFAULT_PRESETS.find((preset) => preset.id === activePresetId);
    if (!defaultPreset) return;
    updateActivePresetZones(clonePresets([defaultPreset])[0].zones);
    setActiveZoneIndex(0);
  };

  const downloadLog = () => {
    const content = capturedText.map((item) => `[${item.time}] ${item.text}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `captura_${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const getPreviewDimensions = () => {
    const liveVideo = livePreviewRef.current;
    const image = previewImageRef.current;
    const directElement = directWebviewRef.current || directIframeRef.current;
    const element =
      captureMode === 'screen' && liveVideo?.srcObject
        ? liveVideo
        : captureMode === 'direct'
          ? directElement
          : image;
    const width =
      captureMode === 'screen'
        ? liveVideo?.videoWidth || previewSize?.width || 0
        : captureMode === 'direct'
          ? previewSize?.width || directElement?.clientWidth || 0
          : image?.naturalWidth || previewSize?.width || 0;
    const height =
      captureMode === 'screen'
        ? liveVideo?.videoHeight || previewSize?.height || 0
        : captureMode === 'direct'
          ? previewSize?.height || directElement?.clientHeight || 0
          : image?.naturalHeight || previewSize?.height || 0;
    return { element, width, height };
  };

  const getMousePreviewCoords = (clientX: number, clientY: number) => {
    const { element, width, height } = getPreviewDimensions();
    if (!element || !width || !height) return null;
    const rect = element.getBoundingClientRect();

    const scale = Math.min(rect.width / width, rect.height / height);
    const displayedWidth = width * scale;
    const displayedHeight = height * scale;
    const offsetX = (rect.width - displayedWidth) / 2;
    const offsetY = (rect.height - displayedHeight) / 2;
    const imageLeft = rect.left + offsetX;
    const imageTop = rect.top + offsetY;
    const mouseX = clientX - imageLeft;
    const mouseY = clientY - imageTop;

    return {
      x: Math.max(0, Math.min(width, mouseX / scale)),
      y: Math.max(0, Math.min(height, mouseY / scale)),
    };
  };

  const getZoneOverlayStyle = (zone: CaptureZone) => {
    if (!previewSize?.width || !previewSize.height) return {};

    return {
      left: `${(zone.x / previewSize.width) * 100}%`,
      top: `${(zone.y / previewSize.height) * 100}%`,
      width: `${(zone.width / previewSize.width) * 100}%`,
      height: `${(zone.height / previewSize.height) * 100}%`,
    };
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (!canEditZones) return;
    if (!isSelectingRegion) return;
    event.preventDefault();
    const coords = getMousePreviewCoords(event.clientX, event.clientY);
    if (!coords) return;
    setSelectionStart(coords);
    setCurrentSelection({ x: coords.x, y: coords.y, width: 0, height: 0 });
  };

  const startDraggingZone = (event: React.PointerEvent, idx: number) => {
    if (!canEditZones) return;
    if (isSelectingRegion) return;
    event.preventDefault();
    event.stopPropagation();
    const coords = getMousePreviewCoords(event.clientX, event.clientY);
    if (!coords) return;
    setDraggingZoneIndex(idx);
    setDragOffset({
      x: coords.x - zones[idx].x,
      y: coords.y - zones[idx].y,
    });
    setActiveZoneIndex(idx);
  };

  const startResizingZone = (event: React.PointerEvent, idx: number) => {
    if (!canEditZones) return;
    if (isSelectingRegion) return;
    event.preventDefault();
    event.stopPropagation();
    setResizingZoneIndex(idx);
    setActiveZoneIndex(idx);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!canEditZones) return;
    event.preventDefault();
    const coords = getMousePreviewCoords(event.clientX, event.clientY);
    if (!coords) return;

    if (isSelectingRegion && selectionStart) {
      const x = Math.min(selectionStart.x, coords.x);
      const y = Math.min(selectionStart.y, coords.y);
      const width = Math.abs(coords.x - selectionStart.x);
      const height = Math.abs(coords.y - selectionStart.y);
      setCurrentSelection({ x, y, width, height });
      return;
    }

    if (draggingZoneIndex !== null && dragOffset) {
      const dimensions = getPreviewDimensions();
      const imageWidth = dimensions.width || 10000;
      const imageHeight = dimensions.height || 10000;
      updateActivePresetZones((currentZones) => {
        const nextZones = [...currentZones];
        const zone = nextZones[draggingZoneIndex];
        const nextX = Math.max(0, Math.min(coords.x - dragOffset.x, imageWidth - zone.width));
        const nextY = Math.max(0, Math.min(coords.y - dragOffset.y, imageHeight - zone.height));
        nextZones[draggingZoneIndex] = { ...zone, x: nextX, y: nextY };
        return nextZones;
      });
      return;
    }

    if (resizingZoneIndex !== null) {
      updateActivePresetZones((currentZones) => {
        const nextZones = [...currentZones];
        const zone = nextZones[resizingZoneIndex];
        nextZones[resizingZoneIndex] = {
          ...zone,
          width: Math.max(24, coords.x - zone.x),
          height: Math.max(24, coords.y - zone.y),
        };
        return nextZones;
      });
    }
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (!canEditZones) return;
    event.preventDefault();

    if (draggingZoneIndex !== null || resizingZoneIndex !== null) {
      setDraggingZoneIndex(null);
      setResizingZoneIndex(null);
      setDragOffset(null);
      return;
    }

    if (!isSelectingRegion || !selectionStart || !currentSelection) return;

    if (currentSelection.width > 12 && currentSelection.height > 12) {
      updateActivePresetZones((currentZones) =>
        currentZones.map((zone, index) =>
          index === activeZoneIndex ? { ...zone, ...currentSelection } : zone,
        ),
      );
      if (status !== CaptureStatus.CAPTURING) {
        setStatus(CaptureStatus.SELECTING);
      }
    }

    setIsSelectingRegion(false);
    setSelectionStart(null);
    setCurrentSelection(null);
  };

  const addCaptureEvent = (event: CaptureEvent) => {
    setCaptureEvents((current) => [...current, event].slice(-MAX_EVENTS));
  };

  const captureZoneFromLiveVideo = useCallback((zone: CaptureZone) => {
    const video = livePreviewRef.current;
    const sourceWidth = video?.videoWidth || 0;
    const sourceHeight = video?.videoHeight || 0;
    if (!video || !sourceWidth || !sourceHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    const settingsSnapshot = settingsRef.current;
    const magnification = Math.max(1, Math.round(settingsSnapshot.magnification || 1));
    const left = Math.max(0, Math.min(sourceWidth - 1, Math.round(zone.x)));
    const top = Math.max(0, Math.min(sourceHeight - 1, Math.round(zone.y)));
    const width = Math.max(1, Math.min(sourceWidth - left, Math.round(zone.width)));
    const height = Math.max(1, Math.min(sourceHeight - top, Math.round(zone.height)));
    const canvas = captureCanvasRef.current || document.createElement('canvas');
    captureCanvasRef.current = canvas;
    canvas.width = width * magnification;
    canvas.height = height * magnification;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas OCR indisponivel neste navegador.');
    }

    context.imageSmoothingEnabled = false;
    context.filter = [
      'grayscale(1)',
      `contrast(${settingsSnapshot.contrast || 1})`,
      `brightness(${settingsSnapshot.brightness || 1})`,
    ].join(' ');
    context.drawImage(video, left, top, width, height, 0, 0, canvas.width, canvas.height);
    context.filter = 'none';
    return canvas.toDataURL('image/png');
  }, []);

  const captureZoneFromImage = useCallback(
    (
      image: HTMLImageElement,
      displaySize: { width: number; height: number },
      zone: CaptureZone,
    ) => {
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      if (!sourceWidth || !sourceHeight || !displaySize.width || !displaySize.height) {
        return null;
      }

      const scaleX = sourceWidth / displaySize.width;
      const scaleY = sourceHeight / displaySize.height;
      const settingsSnapshot = settingsRef.current;
      const magnification = Math.max(1, Math.round(settingsSnapshot.magnification || 1));
      const left = Math.max(0, Math.min(sourceWidth - 1, Math.round(zone.x * scaleX)));
      const top = Math.max(0, Math.min(sourceHeight - 1, Math.round(zone.y * scaleY)));
      const width = Math.max(1, Math.min(sourceWidth - left, Math.round(zone.width * scaleX)));
      const height = Math.max(1, Math.min(sourceHeight - top, Math.round(zone.height * scaleY)));
      const canvas = document.createElement('canvas');
      canvas.width = width * magnification;
      canvas.height = height * magnification;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas OCR indisponivel neste navegador.');
      }

      context.imageSmoothingEnabled = false;
      context.filter = [
        'grayscale(1)',
        `contrast(${settingsSnapshot.contrast || 1})`,
        `brightness(${settingsSnapshot.brightness || 1})`,
      ].join(' ');
      context.drawImage(image, left, top, width, height, 0, 0, canvas.width, canvas.height);
      context.filter = 'none';
      return canvas.toDataURL('image/png');
    },
    [],
  );

  const testDirectCapture = useCallback(async () => {
    const webview = directWebviewRef.current;
    if (!isElectronRuntime || directRenderer !== 'electron-webview') {
      const msg = 'Captura direta de pagina externa indisponivel no modo web. Use captura de tela do navegador, OBS ou proxy/iframe de preview.';
      setDirectCaptureState('unavailable');
      setDirectCaptureError(msg);
      addDirectLog(`[LinkDireto] capturePage disponivel: false`);
      return false;
    }
    if (!webview || typeof webview.capturePage !== 'function') {
      const msg = 'capturePage nao esta disponivel na superficie Electron.';
      setDirectCaptureState('failed');
      setDirectCaptureError(msg);
      addDirectLog(`[LinkDireto] capturePage disponivel: false`);
      return false;
    }

    addDirectLog(`[LinkDireto] capturePage disponivel: true`);
    let dataUrl = '';
    try {
      const captured = await webview.capturePage();
      dataUrl = captured.toDataURL();
    } catch (err) {
      const msg = `capturePage falhou: ${err instanceof Error ? err.message : 'erro desconhecido'}`;
      setDirectCaptureState('failed');
      setDirectCaptureError(msg);
      addDirectLog(`[LinkDireto] ${msg}`);
      return false;
    }

    try {
      const frame = await loadImageElement(dataUrl);
      const width = frame.naturalWidth || frame.width;
      const height = frame.naturalHeight || frame.height;
      addDirectLog(`[LinkDireto] screenshot capturado: ${width} x ${height}`);
      const zone = activeZone;
      const zoneInside = Boolean(
        zone &&
          width > 0 &&
          height > 0 &&
          zone.x >= 0 &&
          zone.y >= 0 &&
          zone.width > 0 &&
          zone.height > 0 &&
          zone.x + zone.width <= width &&
          zone.y + zone.height <= height,
      );
      addDirectLog(
        `[LinkDireto] zona ativa: ${Math.round(zone?.x || 0)}, ${Math.round(zone?.y || 0)}, ${Math.round(
          zone?.width || 0,
        )}, ${Math.round(zone?.height || 0)}`,
      );

      if (!width || !height || dataUrl.length < 64) {
        const msg =
          'Pagina carregada, mas captura retornou imagem vazia. Verifique se a superficie Electron esta ativa e visivel.';
        setDirectPageState('empty');
        setDirectCaptureState('failed');
        setDirectCaptureError(msg);
        addDirectLog(`[LinkDireto] ${msg}`);
        return false;
      }
      if (!zoneInside) {
        const msg = 'Zona ativa fora dos limites da imagem capturada.';
        setDirectCaptureState('failed');
        setDirectCaptureError(msg);
        addDirectLog(`[LinkDireto] ${msg}`);
        return false;
      }

      setDirectCapturePreview(dataUrl);
      setDirectCaptureSize({ width, height });
      setDirectCaptureState('tested');
      setDirectCaptureError(null);
      setDirectPageState('rendered');
      setDirectPageReady(true);
      setDirectLinkStatus(`Captura testada com sucesso: ${width}x${height}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Nao foi possivel validar a captura.';
      setDirectCaptureState('failed');
      setDirectCaptureError(msg);
      addDirectLog(`[LinkDireto] ${msg}`);
      return false;
    }
  }, [activeZone, addDirectLog, directRenderer, isElectronRuntime]);

  const runScreenOcrCycle = useCallback(async () => {
    const video = livePreviewRef.current;
    if (!video?.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setCurrentRawText('Aguardando frames da janela...');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }

    // Wait for OCR engine to be ready (Tesseract.js may still be downloading)
    const engine = ocrWorkerRef.current;
    if (!engine) {
      if (ocrErrorRef.current) {
        setCurrentRawText(`Erro ao inicializar OCR: ${ocrErrorRef.current}`);
      } else if (ocrLoadingRef.current) {
        setCurrentRawText('Motor OCR carregando (~10 MB na primeira vez), aguarde...');
      } else {
        setCurrentRawText('Inicializando OCR...');
      }
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }

    setPreviewSize({ width: video.videoWidth, height: video.videoHeight });
    const results: OcrResponse[] = [];

    for (const zone of zonesRef.current) {
      const imageDataUrl = captureZoneFromLiveVideo(zone);
      if (!imageDataUrl) continue;

      // ── Layer-1 dedup: skip OCR entirely if pixels haven't changed ──────
      // Same pixels → same fingerprint → Tesseract would return the exact same
      // text, so there is nothing new to process.
      const fp = zoneImgFingerprint(imageDataUrl);
      if (lastZoneImgFpRef.current.get(zone.id) === fp) continue;
      lastZoneImgFpRef.current.set(zone.id, fp);

      const startMs = performance.now();
      try {
        const { data } = await engine.recognize(imageDataUrl);
        const text = data.text.trim();
        results.push({
          text,
          full_text: text,
          error: null,
          zone_id: zone.id,
          zone_name: zone.name,
          confidence: null,
          latency_ms: Math.round(performance.now() - startMs),
          captureMode: 'screen',
          imageDataUrl,          // raw zone capture — used for visual gift matching
          words: data.words,     // word-level bboxes — used to locate gift icon position
        });
      } catch (err) {
        results.push({
          text: '',
          full_text: '',
          error: err instanceof Error ? err.message : 'Erro OCR',
          zone_id: zone.id,
          zone_name: zone.name,
          confidence: null,
          latency_ms: Math.round(performance.now() - startMs),
          captureMode: 'screen',
        });
      }
    }

    return {
      waiting: false,
      width: video.videoWidth,
      height: video.videoHeight,
      results,
    };
  }, [captureZoneFromLiveVideo]);

  const runDirectPageOcrCycle = useCallback(async () => {
    // --- Task 6: Validate Electron + webview before OCR ---
    if (!isElectronRuntime) {
      setCurrentRawText('No modo web, use captura de tela do navegador, OBS ou proxy/iframe para OCR.');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    const webview = directWebviewRef.current;
    if (!webview) {
      setCurrentRawText('Webview nao encontrado. Recarregue a pagina.');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    if (typeof webview.capturePage !== 'function') {
      const msg = 'capturePage nao esta disponivel neste webview. Verifique a versao do Electron.';
      setCurrentRawText(msg);
      setWebviewLogs((prev) => [...prev.slice(-60), `[${formatClock()}] [LinkDireto] ERRO: ${msg}`]);
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    if (!directPageReady) {
      setCurrentRawText('Aguardando carregamento da pagina direta...');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    if (directCaptureState !== 'tested') {
      setCurrentRawText('Teste a captura da pagina antes de iniciar o OCR automatico.');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }

    const size = updateDirectPageSize();
    if (!size) {
      setCurrentRawText('Aguardando area da pagina direta...');
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }

    let captured: ElectronImage;
    try {
      captured = await webview.capturePage();
    } catch (err) {
      const msg = `capturePage falhou: ${err instanceof Error ? err.message : 'erro desconhecido'}`;
      setCurrentRawText(msg);
      setWebviewLogs((prev) => [...prev.slice(-60), `[${formatClock()}] [LinkDireto] ERRO: ${msg}`]);
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    const frameDataUrl = captured.toDataURL();
    const frame = await loadImageElement(frameDataUrl);
    const frameWidth = frame.naturalWidth || frame.width;
    const frameHeight = frame.naturalHeight || frame.height;
    addDirectLog(`[LinkDireto] screenshot capturado: ${frameWidth} x ${frameHeight}`);
    if (!frameWidth || !frameHeight || frameDataUrl.length < 64) {
      const msg =
        'Pagina carregada, mas captura retornou imagem vazia. Verifique se a superficie Electron esta ativa e visivel.';
      setDirectPageState('empty');
      setDirectCaptureState('failed');
      setDirectCaptureError(msg);
      addDirectLog(`[LinkDireto] ${msg}`);
      return { waiting: true, width: 0, height: 0, results: [] as OcrResponse[] };
    }
    const results: OcrResponse[] = [];

    for (const zone of zonesRef.current) {
      addDirectLog(
        `[LinkDireto] zona ativa: ${Math.round(zone.x)}, ${Math.round(zone.y)}, ${Math.round(zone.width)}, ${Math.round(
          zone.height,
        )}`,
      );
      const image = captureZoneFromImage(frame, size, zone);
      if (!image) continue;
      addDirectLog('[LinkDireto] OCR enviado para /ocr/process');
      const response = await fetch(apiUrl('/ocr/process'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zone_id: zone.id,
          zone_name: zone.name,
          x: zone.x,
          y: zone.y,
          width: zone.width,
          height: zone.height,
          image,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as OcrResponse;
      addDirectLog(
        result.text?.trim() || result.full_text?.trim()
          ? '[LinkDireto] OCR retornou texto encontrado'
          : '[LinkDireto] OCR retornou texto vazio',
      );
      results.push({
        ...result,
        error: response.ok ? result.error : result.error || `HTTP ${response.status}`,
        zone_id: result.zone_id || zone.id,
        zone_name: result.zone_name || zone.name,
      });
    }

    return {
      waiting: false,
      width: size.width,
      height: size.height,
      results,
    };
  }, [
    captureZoneFromImage,
    addDirectLog,
    directCaptureState,
    directPageReady,
    isElectronRuntime,
    updateDirectPageSize,
  ]);

  const scheduleNextCaptureCycle = useCallback(() => {
    timerRef.current = setTimeout(() => {
      void runCaptureCycleRef.current?.();
    }, settingsRef.current.intervalTime);
  }, []);

  const runCaptureCycle = useCallback(async () => {
    if (status !== CaptureStatus.CAPTURING) {
      return;
    }
    if (isBusyRef.current) {
      scheduleNextCaptureCycle();
      return;
    }

    try {
      isBusyRef.current = true;
      setIsProcessing(true);
      if (!zonesRef.current.length) {
        throw new Error('Nenhuma zona OCR configurada');
      }

      const requestStartedAt = performance.now();
      let data: ObsCycleResponse;
      if (captureMode === 'screen') {
        const screenData = await runScreenOcrCycle();
        if (screenData.waiting) return;
        data = {
          ok: true,
          sourceName: 'Janela/tela',
          width: screenData.width,
          height: screenData.height,
          results: screenData.results,
          latency_ms: Math.round(performance.now() - requestStartedAt),
          error: null,
        };
      } else if (captureMode === 'direct') {
        const directData = await runDirectPageOcrCycle();
        if (directData.waiting) return;
        data = {
          ok: true,
          sourceName: 'Pagina direta',
          width: directData.width,
          height: directData.height,
          results: directData.results,
          latency_ms: Math.round(performance.now() - requestStartedAt),
          error: null,
        };
      } else {
        const response = await fetch(apiUrl('/ocr/obs-cycle'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceName,
            zones: zonesRef.current,
            settings: settingsRef.current,
          }),
        });

        data = (await response.json().catch(() => ({}))) as ObsCycleResponse;
        if (!response.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }

        if (data.image) setPreviewImage(data.image);
        if (data.width && data.height) setPreviewSize({ width: data.width, height: data.height });
        noteFrameMetadata(data.frameHash, data.capturedAt);
      }

      const results = Array.isArray(data.results) ? data.results : [];
      for (const [index, result] of results.entries()) {
        const zone =
          zonesRef.current.find((candidate) => candidate.id === result.zone_id) ||
          zonesRef.current[index] ||
          zonesRef.current[0];
        if (!zone) continue;

        try {
          const fullText = result.full_text?.trim() || '';
          const newText = result.text?.trim() || '';
          const latencyMs =
            result.latency_ms ??
            data.latency_ms ??
            Math.round(performance.now() - requestStartedAt);
          const time = formatClock();

          if (zone.id === zonesRef.current[activeZoneIndex]?.id) {
            setCurrentRawText(fullText || '(nenhum texto detectado)');
            setLastCaptureTime(time);
          }

          if (result.error) {
            addCaptureEvent({
              id: makeEventId(),
              zoneId: zone.id,
              zoneName: zone.name,
              text: '',
              rawText: fullText,
              time,
              routeStatus: 'error',
              confidence: result.confidence ?? null,
              latencyMs,
              error: result.error,
              deduped: result.deduped,
              duplicateReason: result.duplicateReason,
              captureMode: result.captureMode,
              sourceHealth: result.sourceHealth,
            });
            setError(`OCR ${zone.name}: ${result.error}`);
            continue;
          }

          // ── Direct visual gift detection ───────────────────────────────────
          // On TikTok, gifts appear as large animated card overlays — the OCR
          // rarely reads a clean "enviou" sentence from them.  So we compare
          // the raw zone image against catalog reference images on every frame
          // change, completely independent of the OCR text.
          //
          // Uses two strategies (full frame @threshold 0.60 and center-crop
          // @threshold 0.65); the higher-confidence result wins.  Cooldown is
          // shared with text-based dedup via lastGiftFiredRef.
          const DEDUP_TTL_MS = 30_000;
          const nowMs = Date.now();

          if (result.imageDataUrl) {
            try {
              const { match: vMatch, debugInfo } = await detectVisualGiftInZone(result.imageDataUrl, giftCatalog);
              // Always update the debug panel so the user can see what the algorithm found,
              // even when no threshold is exceeded.
              setVisualDebug({
                zoneImageUrl: result.imageDataUrl,
                regionDataUrl: debugInfo.colorRegion ?? '',
                bestKey: debugInfo.bestKey,
                bestScore: debugInfo.bestScore,
                fired: vMatch !== null,
                time: formatClock(),
                allScores: debugInfo.allScores,
                zoneColor: debugInfo.zoneColor ?? null,
              });
              if (vMatch) {
                const cooldownKey = `visual:${vMatch.key}`;
                const lastFired = lastGiftFiredRef.current.get(cooldownKey) ?? 0;
                if (nowMs - lastFired >= DEDUP_TTL_MS) {
                  lastGiftFiredRef.current.set(cooldownKey, nowMs);
                  // Fire trigger directly via /video/trigger
                  fetch(apiUrl('/video/trigger'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ eventType: 'gift', giftKey: vMatch.key, gift_key: vMatch.key }),
                  }).catch(() => undefined);
                  // Update Presentes panel
                  setRecentGifts((prev) => [
                    {
                      id: makeEventId(),
                      name: vMatch.key,
                      emoji: getGiftEmoji(vMatch.key, giftCatalog),
                      count: 1,
                      time: formatClock(),
                      triggered: true,
                    },
                    ...prev,
                  ].slice(0, 20));
                }
              }
            } catch {
              /* visual detection is best-effort — never block text processing */
            }
          }

          // ── Layer-2 dedup: normalised per-line comparison (TTL = 30 s) ─────
          if (!lineSeenRef.current.has(zone.id)) lineSeenRef.current.set(zone.id, new Map());
          const seenMap = lineSeenRef.current.get(zone.id)!;
          // Expire old entries
          for (const [ln, ts] of seenMap.entries()) if (nowMs - ts > DEDUP_TTL_MS) seenMap.delete(ln);
          const allTextLines = newText.split('\n').map((l) => l.trim()).filter((l) => l.length > 1);
          const freshLines = allTextLines.filter((l) => {
            const key = normForDedup(l);
            return key.length > 0 && !seenMap.has(key);
          });
          // Mark ALL fresh lines in this zone's dedup map right away so that
          // even cross-zone-dropped lines don't re-fire from this zone later.
          for (const l of freshLines) seenMap.set(normForDedup(l), nowMs);

          // ── Layer-3: cross-zone gift dedup ────────────────────────────────
          // lineSeenRef is keyed per-zone, so two overlapping zones (e.g. "Zona 2"
          // and "Chat") both see the same gift line as fresh. lastGiftFiredRef is
          // shared across all zones: if zone A already fired a gift this cycle,
          // zone B silently drops the same line.
          const ingestLines = freshLines.filter((l) => {
            const isGift = GIFT_VERB_RE_CLIENT.test(l) || GIFT_TIKTOK_RE_CLIENT.test(l);
            if (!isGift) return true; // chat lines always pass
            const key = normForDedup(l);
            const lastFired = lastGiftFiredRef.current.get(key) ?? 0;
            if (nowMs - lastFired < DEDUP_TTL_MS) return false; // already fired by another zone
            lastGiftFiredRef.current.set(key, nowMs);
            return true;
          });
          if (ingestLines.length === 0) continue; // nothing to ingest after all dedup layers

          // ── Layer-4: visual gift key resolution ───────────────────────────
          // For lines that match a gift verb pattern, replace the ambiguous OCR
          // token (V, E, ", J, .3…) with the exact catalog key (gift.coracao,
          // gift.rosa…) identified by comparing the gift icon pixel region
          // against catalog reference images via perceptual hashing (aHash).
          // Falls back to the original line if catalog has no images, the verb
          // bbox is not found, or similarity is below threshold.
          const resolvedLines = await resolveGiftLinesVisually(
            ingestLines,
            result.words ?? [],
            result.imageDataUrl ?? '',
            giftCatalog,
          );
          const processText = resolvedLines.join('\n');

          if (processText.length > 0) {
            // ── Route to /ocr/ingest — the central trigger routing engine ──────
            // Sends resolved lines so the server sees clean gift keys ("gift.coracao")
            // rather than raw OCR artifacts ("V", "E", """).
            let ingestResult: OcrIngestResult | null = null;
            try {
              const ingestResponse = await fetch(apiUrl('/ocr/ingest'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lines: resolvedLines,       // visually-resolved lines
                  text: processText,
                  source: 'ocr',
                  zoneName: result.zone_name || zone.name,
                  zoneRole: zone.role,
                  zoneId: result.zone_id || zone.id,
                }),
              });
              ingestResult = (await ingestResponse.json().catch(() => null)) as OcrIngestResult | null;
              if (!ingestResponse.ok) {
                throw new Error(`HTTP ${ingestResponse.status}`);
              }

              // ── Old-server fallback ─────────────────────────────────────
              // If the running Node.js process hasn't been restarted yet,
              // /ocr/ingest returns the legacy {simulated: true} format.
              // In that case parse the already-resolved lines here in the browser
              // and call /video/trigger (which exists in the old server).
              if ((ingestResult as Record<string, unknown> | null)?.['simulated'] === true) {
                ingestResult = await clientSideIngestFallback(resolvedLines, zone.role, apiUrl);
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Falha ao rotear evento';
              addCaptureEvent({
                id: makeEventId(),
                zoneId: result.zone_id || zone.id,
                zoneName: result.zone_name || zone.name,
                text: processText,
                rawText: fullText,
                time,
                routeStatus: 'error',
                confidence: result.confidence ?? null,
                latencyMs,
                error: `OCR ingest: ${message}`,
                deduped: result.deduped,
                duplicateReason: result.duplicateReason,
                captureMode: result.captureMode,
                sourceHealth: result.sourceHealth,
              });
              setError(`OCR ingest: ${message}`);
              continue;
            }

            const firstTrigger = ingestResult?.triggered?.[0] ?? null;
            const captureEvent: CaptureEvent = {
              id: makeEventId(),
              zoneId: result.zone_id || zone.id,
              zoneName: result.zone_name || zone.name,
              text: processText,
              rawText: fullText,
              time,
              routeStatus: 'sent',
              confidence: result.confidence ?? null,
              latencyMs,
              deduped: result.deduped,
              duplicateReason: result.duplicateReason,
              captureMode: result.captureMode,
              sourceHealth: result.sourceHealth,
              // Trigger routing result
              triggersFired: ingestResult?.triggered?.length ?? 0,
              triggerName: firstTrigger?.triggerName ?? undefined,
              triggeredVideoId: firstTrigger?.targetVideoId ?? undefined,
              noMatchCount: ingestResult?.noMatch?.length ?? 0,
            };
            addCaptureEvent(captureEvent);

            // ── Build canonical OcrEvent from ingest context ─────────────────
            // Provides the AI pipeline with rich structured data (gift keys,
            // sender/author, zone role) without requiring reconstruction later.
            const firstTriggered = ingestResult?.triggered?.[0] ?? null;
            const firstNoMatch = ingestResult?.noMatch?.[0] ?? null;
            const giftKey =
              firstTriggered?.giftKey ??
              (firstNoMatch?.kind === 'gift' ? firstNoMatch.giftKey : undefined) ??
              null;
            const eventAuthor = firstTriggered?.sender ?? firstNoMatch?.sender ?? null;
            const ocrEventZone =
              zone.role === 'gifts' ? ('gift' as const)
              : zone.role === 'alerts' ? ('system' as const)
              : zone.role === 'custom' ? ('custom' as const)
              : ('chat' as const);
            const ocrEventType =
              zone.role === 'gifts' ? ('gift' as const)
              : zone.role === 'alerts' ? ('system' as const)
              : ('comment' as const);
            const canonicalOcrEvent: OcrEvent = buildOcrEvent(captureEvent.rawText, {
              source: 'ocr',
              zone: ocrEventZone,
              zoneName: captureEvent.zoneName,
              eventType: ocrEventType,
              confidence: captureEvent.confidence ?? 1,
              author: eventAuthor,
              metadata: {
                giftName: giftKey,
                giftKey,
                giftValue: null,
                originalFrameId: captureEvent.id,
                matchMethod: captureEvent.captureMode ?? null,
              },
            });

            const liveEvent = emitEvent({
              id: captureEvent.id,
              source: 'ocr',
              zoneName: captureEvent.zoneName,
              text: `${captureEvent.zoneName}: ${captureEvent.text}`,
              kind: kindFromZoneRole(zone.role),
              createdAt: new Date().toISOString(),
              time,
              metadata: {
                zoneId: captureEvent.zoneId,
                zoneRole: zone.role,
                rawText: captureEvent.rawText,
                confidence: captureEvent.confidence,
                latencyMs: captureEvent.latencyMs,
                triggersFired: captureEvent.triggersFired,
                triggerName: captureEvent.triggerName,
                triggeredVideoId: captureEvent.triggeredVideoId,
                // ── OcrEvent-compatible fields (flat, for easy access) ────────
                giftName: giftKey,
                giftKey,
                author: eventAuthor,
                // ── Full canonical OcrEvent (for direct AI pipeline consumption)
                ocrEvent: canonicalOcrEvent,
              },
            });
            setCapturedText((current) =>
              [...current.filter((event) => event.id !== liveEvent.id), liveEvent].slice(
                MAX_PERSONA_MESSAGES * -1,
              ),
            );
            // Show trigger feedback in the error bar
            if ((captureEvent.triggersFired ?? 0) > 0) {
              setError(null);
            }

            // Update "Presentes detectados" panel from server-side gift detections.
            // Shows BOTH triggered gifts (green) AND gifts with no trigger configured
            // (amber) so the user knows exactly what giftKey to configure.
            if (ingestResult) {
              const giftItems: typeof recentGifts = [];
              for (const t of ingestResult.triggered ?? []) {
                if (t.kind === 'gift') {
                  const giftKey = t.giftKey || t.line;
                  giftItems.push({ id: makeEventId(), name: giftKey, emoji: giftKeyToEmoji(giftKey), count: 1, time, triggered: true, ocrRaw: t.ocrRaw, sender: t.sender });
                }
              }
              for (const nm of ingestResult.noMatch ?? []) {
                if (nm.kind === 'gift' && nm.giftKey) {
                  giftItems.push({ id: makeEventId(), name: nm.giftKey, emoji: giftKeyToEmoji(nm.giftKey), count: 1, time, triggered: false, ocrRaw: nm.ocrRaw, sender: nm.sender });
                }
              }
              if (giftItems.length > 0) {
                setRecentGifts((prev) => [...giftItems, ...prev].slice(0, 20));
              }
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Erro desconhecido';
          const time = formatClock();
          addCaptureEvent({
            id: makeEventId(),
            zoneId: zone.id,
            zoneName: zone.name,
            text: '',
            rawText: '',
            time,
            routeStatus: 'error',
            confidence: null,
            latencyMs: null,
            error: message,
            captureMode,
          });
          if (index === activeZoneIndex) {
            setError(`Erro OCR: ${message}`);
          }
        }
      }
    } catch (err) {
      setError(`Erro no ciclo: ${err instanceof Error ? err.message : 'desconhecido'}`);
    } finally {
      setIsProcessing(false);
      isBusyRef.current = false;
      if (status === CaptureStatus.CAPTURING) {
        scheduleNextCaptureCycle();
      }
    }
  }, [
    activeZoneIndex,
    captureMode,
    noteFrameMetadata,
    runDirectPageOcrCycle,
    runScreenOcrCycle,
    scheduleNextCaptureCycle,
    setCapturedText,
    sourceName,
    status,
  ]);

  useEffect(() => {
    runCaptureCycleRef.current = runCaptureCycle;
  }, [runCaptureCycle]);

  const openDirectLink = useCallback(async () => {
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeDirectUrl(directUrl);
    } catch (err) {
      setStatus(CaptureStatus.ERROR);
      setError(err instanceof Error ? err.message : 'Link da live invalido.');
      return false;
    }

    setIsOpeningDirectLink(true);
    setDirectLinkStatus('Carregando pagina...');
    setDirectPageReady(false);
    setDirectPageState('loading');
    setDirectCaptureState(isElectronRuntime && canUseDirectWebCapture ? 'available' : 'unavailable');
    setDirectCapturePreview(null);
    setDirectCaptureSize(null);
    setDirectCaptureError(null);
    setDirectPageUrl(normalizedUrl);
    setDirectUrl(normalizedUrl);
    setDirectPageMode('interact');
    setPreviewImage(null);
    setFrameWarning(
      isElectronRuntime
        ? null
        : backendOnline
          ? null // proxy will handle it — no warning needed
          : 'Proxy do backend offline. A pagina pode ser bloqueada pelo site. Inicie o servidor backend para desbloquear.',
    );
    if (!isElectronRuntime) {
      setFrameWarning(
        'Modo web ativo: use captura de tela do navegador, OBS ou proxy/iframe para preview. OCR direto de pagina externa nao usa mais Electron.',
      );
    }
    addDirectLog(`[LinkDireto] URL solicitada: ${normalizedUrl}`);
    addDirectLog(
      `[LinkDireto] Renderer escolhido: ${
        isElectronRuntime ? 'webview' : backendOnline ? 'proxy preview' : 'iframe'
      }`,
    );
    lastOpenedDirectUrlRef.current = normalizedUrl;
    window.setTimeout(() => {
      updateDirectPageSize();
      setIsOpeningDirectLink(false);
    }, 0);
    setStatus((current) => (current === CaptureStatus.CAPTURING ? current : CaptureStatus.SELECTING));
    setError(
      isElectronRuntime
        ? null
        : 'Modo web ativo: para OCR use captura de tela do navegador, OBS ou uma zona de captura configurada.',
    );
    return true;
  }, [addDirectLog, backendOnline, canUseDirectWebCapture, directUrl, isElectronRuntime, updateDirectPageSize]);

  const startCapture = useCallback(async () => {
    lastFrameHashRef.current = null;
    repeatedFrameCountRef.current = 0;
    setFrameWarning(null);

    if (captureMode === 'screen') {
      try {
        if (!screenStreamRef.current?.active) {
          await requestScreenStream();
        }
        onStartAutopilot?.();
        setStatus(CaptureStatus.CAPTURING);
        setError(null);
      } catch (err) {
        setStatus(CaptureStatus.ERROR);
        setError(err instanceof Error ? err.message : 'Nao foi possivel iniciar a captura da janela.');
      }
      return;
    }

    if (captureMode === 'direct') {
      let normalizedUrl: string | null;
      try {
        normalizedUrl = hasDirectUrl ? normalizeDirectUrl(directUrl) : null;
      } catch (err) {
        setStatus(CaptureStatus.ERROR);
        setError(err instanceof Error ? err.message : 'Link da live invalido.');
        return;
      }

      if (normalizedUrl && (normalizedUrl !== lastOpenedDirectUrlRef.current || !sourceReady)) {
        const opened = await openDirectLink();
        if (!opened) return;
      }
      if (!isElectronRuntime) {
        setStatus(CaptureStatus.ERROR);
        setError('Modo web ativo: use captura de tela do navegador, OBS ou proxy/iframe para OCR.');
        addDirectLog('[LinkDireto] OCR bloqueado: runtime browser limitado');
        return;
      }
      if (!directReady || !directCaptureTested) {
        setStatus(CaptureStatus.ERROR);
        setError('Teste a captura da pagina antes de iniciar o OCR automatico.');
        addDirectLog('[LinkDireto] OCR bloqueado: captura ainda nao foi testada com sucesso');
        return;
      }
      onStartAutopilot?.();
      setStatus(CaptureStatus.CAPTURING);
      setError(null);
      return;
    }

    let health = await refreshObsHealth();
    const sourceNotRendering = health.sourceActive === false || health.sourceShowing === false;
    if (!health.ok || !health.connected || !health.sourceReady || !health.screenshotReady || sourceNotRendering) {
      try {
        setError(`Preparando a source "${sourceName}" no OBS...`);
        const repairResponse = await fetch(apiUrl('/obs/prepare-capture'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceName }),
        });
        const repair = (await repairResponse.json().catch(() => ({}))) as {
          ok?: boolean;
          health?: ObsHealth;
          error?: string | null;
        };
        if (!repairResponse.ok || !repair.ok) {
          throw new Error(repair.error || `HTTP ${repairResponse.status}`);
        }
        health = repair.health || (await refreshObsHealth());
        setObsHealth(health);
      } catch (err) {
        setStatus(CaptureStatus.ERROR);
        setError(
          err instanceof Error
            ? err.message
            : `Nao foi possivel preparar a source "${sourceName}" no OBS.`,
        );
        return;
      }
    }

    if (!health.ok || !health.connected || !health.sourceReady || !health.screenshotReady) {
      setStatus(CaptureStatus.ERROR);
      setError(
        health.error ||
          `Nao foi possivel iniciar a live assistida: a source "${sourceName}" nao esta pronta no OBS.`,
      );
      return;
    }
    if (health.sourceActive === false || health.sourceShowing === false) {
      setFrameWarning('A source OBS ainda nao reportou renderizacao ativa; o OCR vai tentar usar o frame disponivel.');
    }
    const preview = await refreshObsPreview();
    if (!preview) return;
    onStartAutopilot?.();
    setStatus(CaptureStatus.CAPTURING);
    setError(null);
  }, [
    captureMode,
    directUrl,
    hasDirectUrl,
    directCaptureTested,
    directReady,
    addDirectLog,
    isElectronRuntime,
    onStartAutopilot,
    openDirectLink,
    refreshObsHealth,
    refreshObsPreview,
    requestScreenStream,
    sourceName,
    sourceReady,
  ]);

  // Listen for start-live events to initiate capture when user clicks "Iniciar Live"
  useEffect(() => {
    const handler = () => {
      if (status === CaptureStatus.CAPTURING) return;
      void startCapture();
    };

    window.addEventListener('odessa:start-live', handler as EventListener);
    return () => window.removeEventListener('odessa:start-live', handler as EventListener);
  }, [startCapture, status]);

  useEffect(() => {
    if (status === CaptureStatus.CAPTURING) {
      timerRef.current = setTimeout(() => {
        void runCaptureCycleRef.current?.();
      }, 0);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status]);

  const pipeline = [
    {
      label:
        captureMode === 'screen'
          ? screenReady
            ? 'Janela ao vivo'
            : 'Selecionar janela'
          : captureMode === 'direct'
            ? directReady
              ? 'Pagina renderizada'
              : directPageUrl
                ? `Pagina: ${directPageState}`
                : 'Abrir link direto'
            : obsReady
              ? 'OBS Source pronta'
              : 'OBS Source pendente',
      icon: captureMode === 'screen' ? Camera : captureMode === 'direct' ? Link2 : Wifi,
      active: sourceReady,
    },
    { label: `${zones.length} zonas`, icon: Layers, active: zones.length > 0 },
    {
      label:
        captureMode === 'direct'
          ? directCaptureTested
            ? 'Captura testada'
            : 'Captura pendente'
          : backendOnline
            ? 'OCR backend online'
            : 'OCR backend offline',
      icon: ScanText,
      active: captureMode === 'direct' ? directCaptureTested : backendOnline,
    },
    {
      label: autopilotEnabled ? 'Autopilot ativo' : 'Autopilot liga ao iniciar',
      icon: Bot,
      active: autopilotEnabled,
    },
    {
      label: `${pendingAutopilotEvents} pendentes`,
      icon: FileText,
      active: pendingAutopilotEvents > 0,
    },
    {
      label: latestAutopilotActionStatus ? `Acao ${latestAutopilotActionStatus}` : 'Sem acao ainda',
      icon: Zap,
      active: Boolean(latestAutopilotActionStatus),
    },
  ];

  return (
    <main className="flex-1 overflow-y-auto bg-[var(--bg)] text-[var(--t1)] xl:overflow-hidden">
      <canvas ref={captureCanvasRef} className="hidden" aria-hidden="true" />
      <div className="grid min-h-full grid-cols-1 xl:h-full xl:grid-cols-[304px_minmax(0,1fr)_372px]">
        <aside className="border-b border-[var(--odessa-border)] bg-[var(--odessa-surface)] p-4 xl:overflow-y-auto xl:border-b-0 xl:border-r">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--t3)]">
                Capture Studio
              </p>
              <h2 className="mt-1 text-lg font-black text-[var(--t1)]">Extrator OCR</h2>
            </div>
            <StatusChip
              label={status === CaptureStatus.CAPTURING ? 'Live' : 'Standby'}
              tone={status === CaptureStatus.CAPTURING ? 'good' : 'idle'}
              icon={<Activity className="h-3.5 w-3.5" />}
            />
          </div>

          <section className="space-y-3 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--t3)]">Fonte</h3>
              <button
                onClick={() => {
                  void refreshHealth();
                  if (captureMode === 'obs') {
                    void refreshObsHealth();
                    void refreshObsPreview();
                  } else if (captureMode === 'direct') {
                    directWebviewRef.current?.reload?.();
                    updateDirectPageSize();
                  }
                }}
                className="rounded-md p-1.5 text-[var(--t3)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)]"
                title="Atualizar fonte"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => changeCaptureMode('screen')}
                  className={cn(
                    'rounded-md border px-3 py-2 text-xs font-black transition',
                    captureMode === 'screen'
                      ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-100'
                      : 'border-[var(--border)] bg-[var(--bg1)]/50 text-[var(--t3)] hover:border-[var(--border2)]',
                  )}
                >
                  Janela/tela
                </button>
                <button
                  type="button"
                  onClick={() => changeCaptureMode('obs')}
                  className={cn(
                    'rounded-md border px-3 py-2 text-xs font-black transition',
                    captureMode === 'obs'
                      ? 'border-sky-400/50 bg-sky-500/15 text-sky-100'
                      : 'border-[var(--border)] bg-[var(--bg1)]/50 text-[var(--t3)] hover:border-[var(--border2)]',
                  )}
                >
                  OBS
                </button>
                <button
                  type="button"
                  onClick={() => changeCaptureMode('direct')}
                  className={cn(
                    'rounded-md border px-2 py-2 text-xs font-black transition',
                    captureMode === 'direct'
                      ? 'border-violet-400/50 bg-violet-500/15 text-violet-100'
                      : 'border-[var(--border)] bg-[var(--bg1)]/50 text-[var(--t3)] hover:border-[var(--border2)]',
                  )}
                >
                  Link direto
                </button>
              </div>
              {captureMode === 'screen' ? (
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--t3)]">
                    Captura em tempo real
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[var(--t3)]">
                    Selecione a janela do TikTok/Live Studio para recortar o chat direto do video ao vivo.
                  </p>
                  <button
                    type="button"
                    onClick={() => void requestScreenStream()}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--bg3)] px-3 py-2 text-xs font-black text-[var(--t1)] transition hover:bg-[var(--bg4)]"
                  >
                    <Camera className="h-4 w-4" />
                    {screenReady ? 'Trocar janela' : 'Selecionar janela'}
                  </button>
                </div>
              ) : captureMode === 'obs' ? (
                <>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--t3)]">
                    Source OCR
                  </label>
                  <input
                    aria-label="Source OCR"
                    value={sourceName}
                    onChange={(event) => setSourceName(event.target.value)}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--bg1)]/70 px-3 py-2 text-xs font-bold text-[var(--t1)] outline-none transition focus:border-sky-400"
                  />
                </>
              ) : (
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--t3)]">
                    Link da live
                  </label>
                  <input
                    aria-label="Link da live"
                    value={directUrl}
                    onChange={(event) => {
                      setDirectUrl(event.target.value);
                      setDirectLinkStatus(null);
                    }}
                    placeholder="https://..."
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--bg1)]/70 px-3 py-2 text-xs font-bold text-[var(--t1)] outline-none transition focus:border-violet-400"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => void openDirectLink()}
                      disabled={!hasDirectUrl || isOpeningDirectLink}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-violet-500 px-3 py-2 text-xs font-black text-[var(--t1)] transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Link2 className="h-4 w-4" />
                      {isOpeningDirectLink ? 'Abrindo' : 'Abrir nesta tela'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        directWebviewRef.current?.reload?.();
                        setDirectPageReady(false);
                        setDirectPageState(directPageUrl ? 'loading' : 'none');
                        setDirectCaptureState('available');
                        setDirectCapturePreview(null);
                        setDirectCaptureSize(null);
                        setDirectCaptureError(null);
                        setDirectLinkStatus('Recarregando pagina...');
                        window.requestAnimationFrame(() => updateDirectPageSize());
                      }}
                      disabled={!directPageUrl}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--bg3)] px-3 py-2 text-xs font-black text-[var(--t1)] transition hover:bg-[var(--bg4)]"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Recarregar
                    </button>
                    <button
                      type="button"
                      onClick={() => void testDirectCapture()}
                      disabled={!isElectronRuntime || !directPageUrl || directPageState !== 'rendered'}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ScanText className="h-4 w-4" />
                      Testar captura
                    </button>
                  </div>
                  {directLinkStatus && (
                    <p className="truncate text-xs font-semibold text-emerald-300">
                      {directLinkStatus}
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-wide">
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-2 text-[var(--t3)]">
                  <p>
                    {captureMode === 'screen' ? 'Janela' : captureMode === 'direct' ? 'Link' : 'OBS'}
                  </p>
                  <p
                    className={cn(
                      'mt-1',
                      captureMode === 'screen'
                        ? screenReady
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                        : captureMode === 'direct'
                          ? directPageUrl
                            ? directReady
                              ? 'text-emerald-300'
                              : 'text-amber-300'
                            : 'text-[var(--t3)]'
                        : sourceReady
                          ? 'text-emerald-300'
                          : obsHealth?.connected
                            ? 'text-amber-300'
                            : 'text-rose-300',
                    )}
                  >
                    {captureMode === 'screen'
                      ? screenReady
                        ? 'ao vivo'
                        : 'pendente'
                      : captureMode === 'direct'
                        ? directPageUrl
                          ? directReady
                            ? 'aberto'
                            : 'carregando'
                          : 'pendente'
                      : sourceReady
                        ? 'pronto'
                        : obsHealth?.connected
                          ? 'conectado'
                          : 'offline'}
                  </p>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-2 text-[var(--t3)]">
                  <p>{captureMode === 'direct' ? 'Captura' : 'OCR'}</p>
                  <p
                    className={cn(
                      'mt-1',
                      captureMode === 'direct'
                        ? directCaptureTested
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                        : backendOnline
                          ? 'text-emerald-300'
                          : 'text-amber-300',
                    )}
                  >
                    {captureMode === 'direct'
                      ? directCaptureTested
                        ? 'testada'
                        : 'indisponivel'
                      : backendOnline
                        ? 'backend online'
                        : 'pendente'}
                  </p>
                </div>
              </div>
              {captureMode === 'obs' && obsHealth?.currentScene && (
                <p className="truncate text-xs text-[var(--t3)]">Cena atual: {obsHealth.currentScene}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void startCapture()}
                disabled={!canStartCapture}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-4 w-4 fill-current" />
                Iniciar
              </button>
              <button
                onClick={pauseCapture}
                disabled={status !== CaptureStatus.CAPTURING}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--bg3)] px-3 py-2 text-xs font-black text-[var(--t1)] transition hover:bg-[var(--bg4)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Pause className="h-4 w-4" />
                Pausar
              </button>
            </div>
            {captureMode === 'obs' && obsHealth?.error && (
              <p className="text-xs leading-5 text-amber-300">{obsHealth.error}</p>
            )}
          </section>

          <section className="mt-4 space-y-3 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--t3)]">
                Presets
              </h3>
              <button
                onClick={resetPreset}
                className="rounded-md p-1.5 text-[var(--t3)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)]"
                title="Restaurar preset"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => {
                    setActivePresetId(preset.id);
                    setActiveZoneIndex(0);
                  }}
                  className={cn(
                    'w-full rounded-md border p-3 text-left transition',
                    activePresetId === preset.id
                      ? 'border-sky-400/60 bg-sky-500/10'
                      : 'border-[var(--border)] bg-[var(--bg1)]/40 hover:border-[var(--border2)]',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-[var(--t1)]">{preset.name}</span>
                    <span className="rounded bg-[var(--bg2)] px-2 py-0.5 text-[10px] font-bold text-[var(--t3)]">
                      {preset.zones.length} zonas
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-4 text-[var(--t3)]">
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-4 space-y-3 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--t3)]">Zonas</h3>
              <button
                onClick={addZone}
                disabled={zones.length >= MAX_ZONES}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--bg3)] px-2 py-1 text-xs font-bold text-[var(--t1)] transition hover:bg-[var(--bg4)] disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Nova
              </button>
            </div>
            <div className="space-y-2">
              {zones.map((zone, index) => (
                <div
                  key={zone.id}
                  className={cn(
                    'flex items-stretch rounded-md border transition',
                    activeZoneIndex === index
                      ? 'border-sky-400/60 bg-sky-500/10'
                      : 'border-[var(--border)] bg-[var(--bg1)]/40 hover:border-[var(--border2)]',
                  )}
                >
                  <button
                    onClick={() => setActiveZoneIndex(index)}
                    className="min-w-0 flex-1 p-2.5 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: zone.color }}
                      />
                      <span className="truncate text-sm font-bold text-[var(--t1)]">{zone.name}</span>
                    </span>
                    <span className="mt-1 block font-mono text-[10px] text-[var(--t3)]">
                      {Math.round(zone.width)}x{Math.round(zone.height)} px
                    </span>
                  </button>
                  {zones.length > 1 && (
                    <button
                      onClick={() => removeZone(index)}
                      className="border-l border-[var(--border)] px-2 text-[var(--t3)] transition hover:bg-rose-500/10 hover:text-rose-300"
                      title={`Remover ${zone.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {activeZone && (
              <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-3">
                <label className="block text-xs font-semibold text-[var(--t3)]">
                  Nome da zona
                  <input
                    value={activeZone.name}
                    onChange={(event) => updateZone(activeZoneIndex, { name: event.target.value })}
                    className="mt-1 w-full rounded-md border border-[var(--border2)] bg-[var(--bg1)] px-2 py-1.5 text-sm font-semibold text-[var(--t1)] outline-none focus:border-sky-400"
                  />
                </label>
                <label className="block text-xs font-semibold text-[var(--t3)]">
                  Tipo
                  <select
                    value={activeZone.role}
                    onChange={(event) =>
                      updateZone(activeZoneIndex, {
                        role: event.target.value as CaptureZone['role'],
                      })
                    }
                    className="mt-1 w-full rounded-md border border-[var(--border2)] bg-[var(--bg1)] px-2 py-1.5 text-sm font-semibold text-[var(--t1)] outline-none focus:border-sky-400"
                  >
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </section>

          <section className="mt-4 space-y-4 rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-3">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-[var(--t3)]" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--t3)]">OCR</h3>
            </div>
            <SliderControl
              label="Contraste"
              value={settings.contrast}
              min={1}
              max={4}
              step={0.1}
              onChange={(value) => updateSettings('contrast', value)}
            />
            <SliderControl
              label="Luminosidade"
              value={settings.brightness}
              min={0.5}
              max={2}
              step={0.1}
              onChange={(value) => updateSettings('brightness', value)}
            />
            <SliderControl
              label="Zoom"
              value={settings.magnification}
              min={1}
              max={8}
              step={1}
              suffix="x"
              onChange={(value) => updateSettings('magnification', value)}
            />
            <SliderControl
              label="Intervalo"
              value={settings.intervalTime}
              min={250}
              max={5000}
              step={50}
              suffix="ms"
              onChange={(value) => updateSettings('intervalTime', value)}
            />
            <label className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--bg1)]/40 px-3 py-2 text-xs font-semibold text-[var(--t2)]">
              Console debug
              <input
                type="checkbox"
                checked={settings.debugMode}
                onChange={(event) => updateSettings('debugMode', event.target.checked)}
                className="accent-sky-400"
              />
            </label>
          </section>
        </aside>

        <section className="flex min-h-[720px] flex-col bg-[var(--bg)] xl:min-h-0">
          <div className="border-b border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {pipeline.map((step, index) => {
                const Icon = step.icon;
                return (
                  <React.Fragment key={step.label}>
                    <span
                      className={cn(
                        'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-black',
                        step.active
                          ? 'border-sky-400/30 bg-sky-500/10 text-sky-100'
                          : 'border-[var(--border)] bg-[var(--bg1)]/50 text-[var(--t3)]',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {step.label}
                    </span>
                    {index < pipeline.length - 1 && (
                      <span className="hidden text-slate-700 sm:inline">/</span>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div className="flex min-h-[420px] flex-1 flex-col border-b border-[var(--border)] bg-black">
            {/* Task 1: Runtime mode status indicator */}
            {captureMode === 'direct' && (
              <div
                className={cn(
                  'flex items-center gap-2 border-b px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide',
                  isElectronRuntime
                    ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                    : backendOnline
                      ? 'border-sky-400/20 bg-sky-500/10 text-sky-200'
                      : 'border-amber-400/20 bg-amber-500/10 text-amber-200',
                )}
              >
                {isElectronRuntime ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    MODO LEGADO: ELECTRON WEBVIEW
                  </>
                ) : false ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Preview proxy experimental indisponivel para OCR
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3.5 w-3.5" />
                    MODO WEB: use captura de tela, OBS ou proxy/iframe para fontes externas.
                  </>
                )}
              </div>
            )}
            {captureMode === 'direct' && (
              <div className="grid gap-px border-b border-[var(--border)] bg-[var(--bg3)] text-[10px] font-bold uppercase tracking-wide sm:grid-cols-4">
                <div className="bg-[#0B1018] px-3 py-2 text-[var(--t3)]">
                  Runtime
                  <span className="mt-1 block text-xs text-[var(--t1)]">
                    {isElectronRuntime ? 'Electron legado' : 'Web'}
                  </span>
                </div>
                <div className="bg-[#0B1018] px-3 py-2 text-[var(--t3)]">
                  Renderer da pagina
                  <span className="mt-1 block text-xs text-[var(--t1)]">
                    {directRenderer === 'electron-webview'
                      ? 'Electron WebView legado'
                      : directRenderer === 'proxy-preview'
                          ? 'Proxy preview'
                          : directRenderer === 'iframe'
                            ? 'Iframe'
                            : 'Nenhum'}
                  </span>
                </div>
                <div className="bg-[#0B1018] px-3 py-2 text-[var(--t3)]">
                  Pagina
                  <span className="mt-1 block text-xs text-[var(--t1)]">{directPageState}</span>
                </div>
                <div className="bg-[#0B1018] px-3 py-2 text-[var(--t3)]">
                  Captura
                  <span className="mt-1 block text-xs text-[var(--t1)]">{directCaptureState}</span>
                </div>
              </div>
            )}
            {frameWarning && (
              <div className="flex items-center gap-2 border-b border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-100">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{frameWarning}</span>
              </div>
            )}
            {hasPreview && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[#111722] px-4 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[var(--t3)]">
                  <Crosshair className="h-4 w-4 text-sky-300" />
                  <span>Zona ativa</span>
                  <select
                    value={activeZoneIndex}
                    onChange={(event) => setActiveZoneIndex(Number(event.target.value))}
                    className="rounded-md border border-[var(--border2)] bg-[var(--bg1)] px-2 py-1 text-xs font-black text-[var(--t1)] outline-none focus:border-sky-400"
                  >
                    {zones.map((zone, index) => (
                      <option key={zone.id} value={index}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {captureMode === 'direct' && (
                    <button
                      type="button"
                      onClick={() => {
                        setDirectPageMode((current) => (current === 'interact' ? 'crop' : 'interact'));
                        setIsSelectingRegion(false);
                        setCurrentSelection(null);
                      }}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-black transition',
                        directPageMode === 'interact'
                          ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-300'
                          : 'bg-sky-500 text-slate-950 hover:bg-sky-300',
                      )}
                    >
                      {directPageMode === 'interact' ? (
                        <MousePointer2 className="h-3.5 w-3.5" />
                      ) : (
                        <Crosshair className="h-3.5 w-3.5" />
                      )}
                      {directPageMode === 'interact' ? 'Interagir' : 'Editar recorte'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (captureMode === 'direct') setDirectPageMode('crop');
                      setIsSelectingRegion((current) => !current);
                    }}
                    disabled={!canEditZones && captureMode !== 'direct'}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-black transition',
                      isSelectingRegion
                        ? 'bg-rose-500 text-[var(--t1)]'
                        : 'bg-[var(--bg3)] text-[var(--t1)] hover:bg-[var(--bg4)]',
                    )}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                    {isSelectingRegion ? 'Cancelar recorte' : 'Desenhar recorte'}
                  </button>
                </div>
              </div>
            )}

            <div
              className={cn(
                'relative flex flex-1 items-center justify-center overflow-hidden',
                isSelectingRegion ? 'cursor-crosshair' : '',
              )}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              {hasPreview ? (
                <>
                  <div
                    className={cn(
                      'relative max-h-full max-w-full',
                      captureMode === 'direct' ? 'h-full w-full' : 'inline-flex',
                    )}
                  >
                    {captureMode === 'screen' ? (
                      <video
                        ref={livePreviewRef}
                        autoPlay
                        muted
                        playsInline
                        className="block max-h-full max-w-full object-contain"
                        onLoadedMetadata={(event) => {
                          const video = event.currentTarget;
                          if (video.videoWidth && video.videoHeight) {
                            setPreviewSize({ width: video.videoWidth, height: video.videoHeight });
                          }
                          void video.play().catch(() => undefined);
                        }}
                      />
                    ) : captureMode === 'direct' ? (
                      isElectronRuntime ? (
                        <webview
                          ref={directWebviewRef as unknown as React.RefObject<HTMLWebViewElement>}
                          src={directPageUrl}
                          partition="persist:odessa-capture"
                          allowpopups
                          useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                          webpreferences="contextIsolation=yes,nodeIntegration=no,javascript=yes"
                          onError={() => {
                            addDirectLog('[LinkDireto] did-fail-load: code=?, description=webview error, url=?');
                            setDirectPageState('failed');
                            setDirectPageReady(false);
                            setDirectCaptureState('unavailable');
                            setError('A superficie Electron falhou ao carregar a pagina.');
                          }}
                          style={{
                            position: 'absolute' as const,
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            minWidth: '100%',
                            minHeight: '100%',
                            display: 'flex',
                            background: '#fff',
                            zIndex: 0,
                            pointerEvents: directPageMode === 'crop' ? 'none' : 'auto',
                          }}
                        />
                      ) : (
                        /* Browser fallback: proxy strips X-Frame-Options/CSP so the page loads */
                        <div className="flex h-full w-full flex-col">
                          {!backendOnline && (
                            <div className="flex items-center gap-2 border-b border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-100">
                              <AlertCircle className="h-4 w-4 shrink-0" />
                              <span>
                                Backend offline — o proxy nao esta disponivel. Inicie o servidor para carregar a pagina ou use captura de tela/OBS.
                              </span>
                            </div>
                          )}
                          <iframe
                            ref={directIframeRef}
                            title="Pagina direta para captura"
                            src={proxyIframeUrl}
                            className="block flex-1 border-0 bg-white"
                            onLoad={() => {
                              setDirectPageReady(false);
                              setDirectPageState('dom-ready');
                              setDirectCaptureState('unavailable');
                              setDirectLinkStatus('Preview limitado carregado; OCR direto indisponivel no navegador comum.');
                              addDirectLog('[LinkDireto] iframe/proxy preview carregado');
                              updateDirectPageSize();
                            }}
                            onError={() => {
                              setDirectPageReady(false);
                              setDirectPageState('failed');
                              setDirectCaptureState('unavailable');
                              addDirectLog('[LinkDireto] did-fail-load: iframe/proxy preview falhou');
                              setError(
                                backendOnline
                                  ? 'O proxy nao conseguiu carregar a pagina. Tente o app desktop.'
                                  : 'Backend offline. Inicie o servidor e tente novamente.',
                              );
                            }}
                          />
                          <div className="flex items-center gap-3 border-t border-[var(--border)] bg-[#111722] px-4 py-2">
                            <button
                              type="button"
                              onClick={() => window.open(directPageUrl, '_blank', 'noopener')}
                              className="inline-flex items-center gap-2 rounded-md bg-[var(--bg3)] px-3 py-1.5 text-xs font-black text-[var(--t1)] transition hover:bg-[var(--bg4)]"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                              Abrir no navegador externo
                            </button>
                            <span className="text-[10px] text-[var(--t3)]">
                              {backendOnline
                                ? 'Preview experimental via proxy; OCR direto somente no app desktop'
                                : 'Backend offline; use Abrir no navegador externo'}
                            </span>
                          </div>
                        </div>
                      )
                    ) : (
                      <img
                        ref={previewImageRef}
                        src={previewImage || undefined}
                        alt="Preview da source OCR do OBS"
                        className="block max-h-full max-w-full object-contain"
                        onLoad={(event) => {
                          const image = event.currentTarget;
                          if (image.naturalWidth && image.naturalHeight) {
                            setPreviewSize({ width: image.naturalWidth, height: image.naturalHeight });
                          }
                        }}
                      />
                    )}
                    {isSelectingRegion && canEditZones && (
                      <div className="pointer-events-none absolute inset-0 z-10 bg-black/45">
                        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm font-black uppercase tracking-[0.22em] text-[var(--t1)]/55">
                          Arraste para redefinir {activeZone?.name || 'a zona'}
                        </div>
                      </div>
                    )}
                    {/* Task 5: Zone overlay — pointer-events depend on mode */}
                    <div
                      className="absolute inset-0 z-20"
                      style={{
                        pointerEvents:
                          captureMode === 'direct' && directPageMode === 'interact'
                            ? 'none'
                            : canEditZones
                              ? 'auto'
                              : 'none',
                      }}
                    >
                      {zones.map((zone, index) => (
                        <div
                          key={zone.id}
                          onPointerDown={(event) => startDraggingZone(event, index)}
                          className={cn(
                            'absolute border-2 transition-colors',
                            canEditZones ? 'pointer-events-auto' : 'pointer-events-none',
                            isSelectingRegion ? 'cursor-default' : 'cursor-move',
                            activeZoneIndex === index
                              ? 'shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]'
                              : 'opacity-80',
                            isSelectingRegion && activeZoneIndex === index ? 'hidden' : '',
                          )}
                          style={{
                            ...getZoneOverlayStyle(zone),
                            borderColor: zone.color,
                          }}
                        >
                          <span
                            className="absolute -top-7 left-0 rounded-t px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-950"
                            style={{ backgroundColor: zone.color }}
                          >
                            {zone.name}
                          </span>
                          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-[var(--t1)]">
                            {Math.round(zone.width)}x{Math.round(zone.height)}
                          </span>
                          {!isSelectingRegion && canEditZones && (
                            <div
                              onPointerDown={(event) => startResizingZone(event, index)}
                              className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize rounded-tl"
                              style={{ backgroundColor: zone.color }}
                            />
                          )}
                        </div>
                      ))}

                      {isSelectingRegion && currentSelection && previewSize && (
                        <div
                          className="absolute border-2 border-white bg-white/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                          style={getZoneOverlayStyle({
                            ...currentSelection,
                            id: 'selection',
                            name: 'Selecao',
                            role: 'custom',
                            color: '#FFFFFF',
                          })}
                        />
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
                  <div className="rounded-full border border-[var(--border)] bg-[var(--bg1)] p-5">
                    <Camera className="h-11 w-11 text-[var(--t4)]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-[var(--t1)]">
                      {captureMode === 'screen'
                        ? 'Selecione a janela do chat'
                        : captureMode === 'direct'
                          ? 'Abra o link da live'
                          : 'Conecte a source do OBS'}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--t3)]">
                      {captureMode === 'screen'
                        ? 'Use a captura de janela/tela para ver o chat se movendo em tempo real, ajustar as zonas e iniciar os gatilhos.'
                        : captureMode === 'direct'
                          ? 'Cole o link, abra a pagina aqui, interaja normalmente e alterne para editar o recorte quando precisar.'
                          : 'Atualize o preview da source dedicada, ajuste as zonas e inicie a leitura para alimentar a Persona em tempo real.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-px bg-[var(--bg3)] lg:grid-cols-4">
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--t3)]">
                <Clock3 className="h-4 w-4" />
                Ultima captura
              </div>
              <p className="mt-2 font-mono text-lg font-black text-[var(--t1)]">{lastCaptureTime}</p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--t3)]">
                <Gauge className="h-4 w-4" />
                Latencia media
              </div>
              <p className="mt-2 font-mono text-lg font-black text-[var(--t1)]">
                {successfulEvents.length ? `${Math.round(averageLatency)}ms` : '0ms'}
              </p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--t3)]">
                <Zap className="h-4 w-4" />
                Confianca OCR
              </div>
              <p className="mt-2 font-mono text-lg font-black text-[var(--t1)]">
                {successfulEvents.length ? `${Math.round(averageConfidence * 100)}%` : '0%'}
              </p>
            </div>
            <div className="bg-[#0B1018] p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--t3)]">
                <Activity className="h-4 w-4" />
                Ciclo
              </div>
              <p className="mt-2 font-mono text-lg font-black text-[var(--t1)]">
                {isProcessing ? 'Processando' : `${settings.intervalTime}ms`}
              </p>
            </div>
          </div>
        </section>

        <aside className="border-t border-[var(--odessa-border)] bg-[var(--odessa-surface)] xl:overflow-y-auto xl:border-l xl:border-t-0">
          <div className="space-y-4 p-4">
            <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-[var(--t1)]">Backend local</h3>
                  <p className="mt-1 text-xs text-[var(--t3)]">Verificado as {healthCheckedAt}</p>
                </div>
                <StatusChip
                  label={backendOnline ? 'online' : 'offline'}
                  tone={backendOnline ? 'good' : 'danger'}
                  icon={
                    backendOnline ? (
                      <Wifi className="h-3.5 w-3.5" />
                    ) : (
                      <WifiOff className="h-3.5 w-3.5" />
                    )
                  }
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-2">
                  <p className="text-[10px] font-bold uppercase text-[var(--t3)]">OCR</p>
                  <p className="mt-1 text-xs font-black text-[var(--t1)]">
                    {backendHealth?.ocr || '-'}
                  </p>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-2">
                  <p className="text-[10px] font-bold uppercase text-[var(--t3)]">IA</p>
                  <p className="mt-1 text-xs font-black text-[var(--t1)]">
                    {backendHealth?.gemini_configured
                      ? 'Gemini'
                      : backendHealth?.openai_ai_configured
                        ? 'OpenAI'
                        : '-'}
                  </p>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-2">
                  <p className="text-[10px] font-bold uppercase text-[var(--t3)]">TTS</p>
                  <p className="mt-1 text-xs font-black text-[var(--t1)]">
                    {backendHealth?.openai_tts_configured ? 'ok' : '-'}
                  </p>
                </div>
              </div>
              {healthError && (
                <p className="mt-3 rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {healthError}
                </p>
              )}
            </section>

            <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <div>
                  <h3 className="text-sm font-black text-[var(--t1)]">Fila para Persona</h3>
                  <p className="mt-1 text-xs text-[var(--t3)]">
                    {capturedText.length} mensagens roteadas
                  </p>
                </div>
                <button
                  onClick={downloadLog}
                  disabled={capturedText.length === 0}
                  className="rounded-md p-2 text-[var(--t3)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)] disabled:opacity-40"
                  title="Baixar log"
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>

              <div
                ref={eventsScrollRef}
                className="max-h-[420px] space-y-3 overflow-y-auto p-4 font-mono text-xs"
              >
                {error && (
                  <div className="flex gap-2 rounded-md border border-rose-400/30 bg-rose-500/10 p-3 text-rose-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {captureEvents.length === 0 ? (
                  <p className="py-8 text-center text-[var(--t4)]">Aguardando eventos OCR...</p>
                ) : (
                  captureEvents.map((event) => (
                    <div
                      key={event.id}
                      className={cn(
                        'rounded-md border p-3',
                        event.routeStatus === 'error'
                          ? 'border-rose-400/30 bg-rose-500/10'
                          : 'border-[var(--border)] bg-[var(--bg1)]/50',
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          {event.routeStatus === 'error' ? (
                            <AlertCircle className="h-3.5 w-3.5 text-rose-300" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                          )}
                          <span className="truncate font-sans text-xs font-black text-[var(--t1)]">
                            {event.zoneName}
                          </span>
                        </span>
                        <span className="text-[10px] text-[var(--t3)]">{event.time}</span>
                      </div>
                      {event.error ? (
                        <p className="whitespace-pre-wrap text-rose-200">{event.error}</p>
                      ) : (
                        <p className="break-words leading-5 text-[var(--t1)]">
                          <TypewriterText text={event.text} />
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2 font-sans text-[10px] font-bold uppercase tracking-wide text-[var(--t3)]">
                        <span>{event.routeStatus}</span>
                        {event.confidence !== null && (
                          <span>{Math.round(event.confidence * 100)}% conf.</span>
                        )}
                        {event.latencyMs !== null && <span>{Math.round(event.latencyMs)}ms</span>}
                        {event.deduped && <span>dedup: {event.duplicateReason || 'repetido'}</span>}
                        {event.captureMode && <span>{event.captureMode}</span>}
                      </div>
                      {/* Trigger routing result */}
                      {event.routeStatus === 'sent' && (
                        <div className="mt-2 font-sans text-[10px]">
                          {(event.triggersFired ?? 0) > 0 ? (
                            <span className="flex items-center gap-1.5 text-emerald-300">
                              <Zap className="h-3 w-3" />
                              <span className="font-bold">
                                {event.triggersFired} gatilho{(event.triggersFired ?? 0) > 1 ? 's' : ''} disparado{(event.triggersFired ?? 0) > 1 ? 's' : ''}
                              </span>
                              {event.triggerName && (
                                <span className="text-emerald-400/80">— {event.triggerName}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[var(--t4)]">sem gatilho correspondente</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* ── Presentes detectados ───────────────────────────────────── */}
            {/* ── Visual detection debug panel ───────────────────────────────── */}
            {visualDebug && (
              <section className="rounded-lg border border-amber-500/30 bg-amber-500/5">
                <div className="flex items-center gap-2 border-b border-amber-500/20 px-4 py-2.5">
                  <span className="text-xs font-bold text-amber-400">🔬 Debug Visual</span>
                  <span className="ml-auto text-[10px] text-[var(--t4)]">{visualDebug.time}</span>
                </div>
                <div className="space-y-3 p-3">

                  {/* Row 1: Zone + Hotspot + result status */}
                  <div className="flex items-start gap-3">
                    <div>
                      <p className="mb-1 text-[9px] font-semibold uppercase text-[var(--t4)]">Zona capturada</p>
                      {visualDebug.zoneImageUrl
                        ? <img src={visualDebug.zoneImageUrl} alt="zone" className="h-20 w-20 rounded border border-[var(--border)] object-contain" style={{ background: 'rgba(0,0,0,0.5)' }} />
                        : <div className="flex h-20 w-20 items-center justify-center rounded border border-[var(--border)] bg-[var(--bg1)] text-[9px] text-[var(--t4)]">sem img</div>
                      }
                    </div>
                    <div>
                      <p className="mb-1 text-[9px] font-semibold uppercase text-[var(--t4)]">Hotspot (96×96)</p>
                      {visualDebug.regionDataUrl
                        ? <img src={visualDebug.regionDataUrl} alt="hotspot" className="h-20 w-20 rounded border border-amber-500/40 object-contain" style={{ background: 'rgba(0,0,0,0.5)', imageRendering: 'pixelated' }} />
                        : <div className="flex h-20 w-20 items-center justify-center rounded border border-amber-500/20 bg-[var(--bg1)] text-[9px] text-[var(--t4)]">nenhum</div>
                      }
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <p className={cn('text-xs font-bold', visualDebug.fired ? 'text-emerald-400' : 'text-amber-400')}>
                        {visualDebug.fired
                          ? `✓ Disparado: ${visualDebug.bestKey}`
                          : `✗ Sem match — melhor: ${(visualDebug.bestScore * 100).toFixed(0)}% (${visualDebug.bestKey || 'nenhum'})`}
                      </p>
                      {/* Zone dominant color swatch */}
                      {visualDebug.zoneColor ? (
                        <div className="flex items-center gap-1.5">
                          <div
                            className="h-4 w-4 shrink-0 rounded-sm border border-white/20"
                            style={{ background: `hsl(${visualDebug.zoneColor[0].toFixed(0)}deg, ${(visualDebug.zoneColor[1] * 100).toFixed(0)}%, ${(visualDebug.zoneColor[2] * 50).toFixed(0)}%)` }}
                            title={`Matiz: ${visualDebug.zoneColor[0].toFixed(0)}° | Sat: ${(visualDebug.zoneColor[1] * 100).toFixed(0)}% | Val: ${(visualDebug.zoneColor[2] * 100).toFixed(0)}%`}
                          />
                          <span className="font-mono text-[9px] text-[var(--t4)]">
                            {visualDebug.zoneColor[0].toFixed(0)}° sat:{(visualDebug.zoneColor[1] * 100).toFixed(0)}%
                          </span>
                        </div>
                      ) : (
                        <p className="text-[9px] text-amber-400/70">Sem cor dominante detectada no hotspot</p>
                      )}
                      {!giftCatalog.some(e => e.imageUrl) && (
                        <p className="rounded bg-blue-500/20 px-2 py-1 text-[10px] text-blue-300">
                          ℹ Usando hues de referência pré-programadas. Salve capturas reais para maior precisão.
                        </p>
                      )}
                      {giftCatalog.some(e => e.imageUrl) && !visualDebug.fired && (
                        <p className="text-[10px] text-[var(--t4)]">
                          {giftCatalog.filter(e => e.imageUrl).length} referências no catálogo.
                          Se o hotspot não mostra o ícone, ajuste a posição da zona.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Scores + catalog thumbnails side-by-side */}
                  <div>
                    <p className="mb-1.5 text-[9px] font-semibold uppercase text-[var(--t4)]">Scores por estratégia</p>
                    {visualDebug.allScores.length === 0 ? (
                      <p className="text-[10px] text-[var(--t4)]">
                        {visualDebug.zoneColor
                          ? 'Scores abaixo do limiar — ajuste a zona de captura.'
                          : 'Zona muito escura ou sem cor — nenhum ícone detectado.'}
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {visualDebug.allScores.map((s, i) => {
                          const catEntry = giftCatalog.find(e => e.key === s.key);
                          return (
                            <div key={i} className="flex items-center gap-2">
                              {/* Catalog thumbnail for this match */}
                              <div className="h-6 w-6 shrink-0 overflow-hidden rounded border border-[var(--border)]" style={{ background: 'rgba(0,0,0,0.4)' }}>
                                {catEntry?.imageUrl
                                  ? <img src={catEntry.imageUrl} alt={catEntry.name} className="h-full w-full object-contain" />
                                  : <span className="flex h-full w-full items-center justify-center text-[10px]">{catEntry?.emoji || '🎁'}</span>
                                }
                              </div>
                              <span className="w-20 shrink-0 font-mono text-[10px] text-[var(--t3)]">{s.strategy}</span>
                              <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-[var(--bg2)]">
                                <div
                                  className={cn('h-full rounded-full transition-all',
                                    s.score >= 0.72 ? 'bg-emerald-500' : s.score >= 0.55 ? 'bg-amber-500' : 'bg-red-500/60')}
                                  style={{ width: `${Math.round(s.score * 100)}%` }}
                                />
                              </div>
                              <span className={cn('w-10 shrink-0 text-right font-mono text-[10px]',
                                s.score >= 0.72 ? 'text-emerald-400' : 'text-[var(--t3)]')}>
                                {(s.score * 100).toFixed(0)}%
                              </span>
                              <span className="w-20 shrink-0 truncate text-[10px] text-[var(--t4)]">{s.key}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Row 3: Save hotspot as catalog reference */}
                  {visualDebug.regionDataUrl && (
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                      <p className="mb-2 text-[10px] font-semibold text-[var(--t2)]">
                        💾 Salvar hotspot como referência do catálogo
                      </p>
                      <p className="mb-2 text-[9px] text-[var(--t4)]">
                        Quando um presente aparecer no OBS, clique aqui para associar a imagem capturada ao presente correto.
                        Isso treina o algoritmo com dados reais da sua live.
                      </p>
                      <div className="flex items-center gap-2">
                        <select
                          value={refSaveKey}
                          onChange={e => setRefSaveKey(e.target.value)}
                          className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg2)] px-2 py-1 text-[11px] text-[var(--t1)]"
                        >
                          <option value="">— selecione o presente —</option>
                          {giftCatalog.map(e => (
                            <option key={e.key} value={e.key}>
                              {e.emoji ? `${e.emoji} ` : ''}{e.name} ({e.key}){e.imageUrl ? ' ✓' : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={handleSaveVisualReference}
                          disabled={!refSaveKey}
                          className={cn(
                            'shrink-0 rounded-md px-3 py-1 text-[11px] font-semibold transition-colors',
                            refSaved
                              ? 'bg-emerald-500/30 text-emerald-300'
                              : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40',
                          )}
                        >
                          {refSaved ? '✓ Salvo!' : 'Salvar referência'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <div>
                  <h3 className="text-sm font-black text-[var(--t1)]">Presentes detectados</h3>
                  <p className="mt-1 text-xs text-[var(--t3)]">
                    Figurinhas capturadas pelo OCR na zona de Presentes
                  </p>
                </div>
                {recentGifts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setRecentGifts([])}
                    className="rounded-md p-1.5 text-[var(--t3)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)]"
                    title="Limpar lista"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="p-4">
                {recentGifts.length === 0 ? (
                  <div className="space-y-2 text-xs text-[var(--t3)]">
                    <p className="py-3 text-center">Nenhum presente detectado ainda.</p>
                    <p className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 px-3 py-2 leading-5">
                      <strong className="text-[var(--t2)]">Como configurar:</strong> crie uma zona
                      com papel <span className="font-mono text-amber-300">Presentes</span>, aponte
                      para a área de figurinhas da live. Quando uma figurinha aparecer, o nome é
                      detectado aqui e dispara um gatilho configurado em{' '}
                      <span className="font-mono text-sky-300">Fluxo Reativo</span> com tipo{' '}
                      <span className="font-mono text-emerald-300">gift</span> e condição{' '}
                      <span className="font-mono text-emerald-300">giftKey = NomeDaFigurinha</span>.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentGifts.map((gift) => (
                      <div
                        key={gift.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-lg leading-none" title={gift.name}>{gift.emoji}</span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-[var(--t1)]">
                              {gift.name}
                              {gift.sender && <span className="ml-1 font-normal text-[var(--t3)]">de {gift.sender}</span>}
                            </p>
                            <p className="text-[10px] text-[var(--t3)]">
                              {gift.time}
                              {gift.ocrRaw && gift.ocrRaw !== gift.name && (
                                <span className="ml-1 font-mono opacity-50">(OCR: {gift.ocrRaw})</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase',
                            gift.triggered
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-[var(--bg2)] text-[var(--t3)]',
                          )}
                        >
                          {gift.triggered ? 'disparado' : 'sem gatilho'}
                        </span>
                      </div>
                    ))}
                    <p className="pt-1 text-[10px] text-[var(--t4)]">
                      Configure gatilhos em{' '}
                      <span className="font-mono text-sky-400">Fluxo Reativo</span> → tipo{' '}
                      <span className="font-mono text-emerald-400">gift</span> → condição{' '}
                      <span className="font-mono text-emerald-400">giftKey</span>.
                    </p>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]">
              <div className="border-b border-[var(--border)] px-4 py-3">
                <h3 className="text-sm font-black text-[var(--t1)]">Texto bruto</h3>
                <p className="mt-1 text-xs text-[var(--t3)]">
                  Zona ativa: {activeZone?.name || 'nenhuma'}
                </p>
              </div>
              <div className="space-y-3 p-4">
                {previewImage && (
                  <img
                    src={previewImage}
                    alt="Preview OCR"
                    className="h-28 w-full rounded-md border border-[var(--border)] bg-black object-contain"
                    style={{ imageRendering: 'pixelated' }}
                  />
                )}
                {captureMode === 'direct' && directCapturePreview && (
                  <div className="space-y-2">
                    <img
                      src={directCapturePreview}
                      alt="Preview da captura Link Direto"
                      className="h-28 w-full rounded-md border border-[var(--border)] bg-black object-contain"
                    />
                    <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                      Captura testada: {directCaptureSize?.width || 0}x{directCaptureSize?.height || 0}
                    </p>
                  </div>
                )}
                {captureMode === 'direct' && directCaptureError && (
                  <p className="rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {directCaptureError}
                  </p>
                )}
                <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--bg1)]/70 p-3 text-xs leading-5 text-[var(--t2)]">
                  {currentRawText || '(aguardando captura)'}
                </pre>
                {lastEvent && (
                  <div className="rounded-md border border-[var(--border)] bg-[var(--bg1)]/50 p-3 text-xs text-[var(--t3)]">
                    <span className="font-bold text-[var(--t1)]">Ultima rota:</span>{' '}
                    {lastEvent.routeStatus} / {lastEvent.zoneName}
                  </div>
                )}
              </div>
            </section>

            {/* Task 3: Webview diagnostic logs (console visual) */}
            {captureMode === 'direct' && webviewLogs.length > 0 && (
              <section className="rounded-lg border border-[var(--odessa-border)] bg-[var(--odessa-surface-strong)]">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                  <h3 className="text-sm font-black text-[var(--t1)]">Console WebView</h3>
                  <button
                    type="button"
                    onClick={() => setWebviewLogs([])}
                    className="rounded-md p-1.5 text-[var(--t3)] transition hover:bg-[var(--bg3)] hover:text-[var(--t1)]"
                    title="Limpar logs"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="max-h-[200px] overflow-y-auto p-3">
                  {webviewLogs.map((log, idx) => (
                    <p key={idx} className="font-mono text-[10px] leading-4 text-[var(--t3)]">
                      {log}
                    </p>
                  ))}
                </div>
              </section>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
});

export default CaptureStudio;
