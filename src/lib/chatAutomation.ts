import { apiUrl } from './api';

const TARGET_STORAGE_KEY = 'odessa:chat-automation-target:v1';

export type ChatAutomationAllowEntry = {
  id: string;
  label: string;
  mode?: 'selector' | 'visual';
  domain: string;
  urlPattern: string;
  inputSelector: string;
  sendSelector: string;
  inputPoint?: ChatAutomationPoint;
  sendPoint?: ChatAutomationPoint;
  viewport?: ChatAutomationViewport;
  submitWithEnter: boolean;
  typingDelayMs: number;
  maxPerMinute: number;
  enabled: boolean;
};

export type ChatAutomationPoint = {
  x: number;
  y: number;
};

export type ChatAutomationViewport = {
  width: number;
  height: number;
};

export type ChatAutomationTarget = {
  mode: 'selector' | 'visual';
  url: string;
  inputSelector: string;
  sendSelector?: string;
  inputPoint?: ChatAutomationPoint;
  sendPoint?: ChatAutomationPoint;
  viewport?: ChatAutomationViewport;
};

export type ChatAutomationConfig = {
  allowlist: ChatAutomationAllowEntry[];
  logs: Array<Record<string, unknown>>;
};

export type ChatAutomationSendResult = {
  status: 'blocked' | 'dry_run' | 'ready' | string;
  allowed: boolean;
  reason?: string;
  target?: ChatAutomationAllowEntry;
  text?: string;
  wouldType?: boolean;
  wouldSend?: boolean;
  wouldClick?: boolean;
  executed?: boolean;
  queued?: boolean;
  queueSize?: number;
  executionMode?: string;
  command?: Record<string, unknown>;
  execution?: {
    ok?: boolean;
    error?: string;
    executor?: string;
    screen?: Record<string, unknown>;
    clickedInput?: Record<string, unknown>;
    clickedSend?: Record<string, unknown> | null;
    submittedWithEnter?: boolean;
  };
};

export const LIVE_CHAT_SCREENSHOT_TARGET: ChatAutomationTarget = {
  mode: 'visual',
  url: 'tango-live-window',
  inputSelector: '',
  sendSelector: '',
  inputPoint: { x: 0.097, y: 0.928 },
  viewport: { width: 1920, height: 938 },
};

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { detail?: string; error?: string };
  if (!response.ok) {
    throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  }
  return data;
}

export function loadChatAutomationTarget(): ChatAutomationTarget {
  try {
    if (typeof window === 'undefined') return { mode: 'selector', url: '', inputSelector: '', sendSelector: '' };
    const raw = window.localStorage.getItem(TARGET_STORAGE_KEY);
    if (!raw) return { mode: 'selector', url: '', inputSelector: '', sendSelector: '' };
    const parsed = JSON.parse(raw) as Partial<ChatAutomationTarget>;
    return {
      mode: parsed.mode === 'visual' ? 'visual' : 'selector',
      url: typeof parsed.url === 'string' ? parsed.url : '',
      inputSelector: typeof parsed.inputSelector === 'string' ? parsed.inputSelector : '',
      sendSelector: typeof parsed.sendSelector === 'string' ? parsed.sendSelector : '',
      inputPoint: normalizePoint(parsed.inputPoint),
      sendPoint: normalizePoint(parsed.sendPoint),
      viewport: normalizeViewport(parsed.viewport),
    };
  } catch {
    return { mode: 'selector', url: '', inputSelector: '', sendSelector: '' };
  }
}

export function saveChatAutomationTarget(target: ChatAutomationTarget): ChatAutomationTarget {
  const normalized = {
    mode: target.mode === 'visual' ? 'visual' : 'selector',
    url: target.url.trim(),
    inputSelector: target.inputSelector.trim(),
    sendSelector: target.sendSelector?.trim() || '',
    inputPoint: normalizePoint(target.inputPoint),
    sendPoint: normalizePoint(target.sendPoint),
    viewport: normalizeViewport(target.viewport),
  };
  try {
    if (typeof window === 'undefined') return normalized;
    window.localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Browser storage may be unavailable in embedded contexts.
  }
  return normalized;
}

export function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function normalizePoint(point?: Partial<ChatAutomationPoint>): ChatAutomationPoint | undefined {
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return undefined;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  return {
    x: Math.max(0, Math.min(point.x, 1)),
    y: Math.max(0, Math.min(point.y, 1)),
  };
}

function normalizeViewport(viewport?: Partial<ChatAutomationViewport>): ChatAutomationViewport | undefined {
  if (!viewport || typeof viewport.width !== 'number' || typeof viewport.height !== 'number') return undefined;
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return undefined;
  return {
    width: Math.max(1, Math.round(viewport.width)),
    height: Math.max(1, Math.round(viewport.height)),
  };
}

export async function getChatAutomationConfig(): Promise<ChatAutomationConfig> {
  return parseJson<ChatAutomationConfig>(await fetch(apiUrl('/chat-automation/config')));
}

export async function saveChatAutomationConfig(
  allowlist: ChatAutomationAllowEntry[],
): Promise<ChatAutomationConfig> {
  return parseJson<ChatAutomationConfig>(
    await fetch(apiUrl('/chat-automation/config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowlist }),
    }),
  );
}

export async function validateChatAutomationTarget(
  target: ChatAutomationTarget,
): Promise<{ allowed: boolean; target?: ChatAutomationAllowEntry; reason?: string }> {
  return parseJson<{ allowed: boolean; target?: ChatAutomationAllowEntry; reason?: string }>(
    await fetch(apiUrl('/chat-automation/validate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: target.mode,
        url: target.url,
        inputSelector: target.inputSelector || undefined,
        inputPoint: target.inputPoint,
        sendPoint: target.sendPoint,
        viewport: target.viewport,
      }),
    }),
  );
}

export async function sendChatAutomationMessage(payload: {
  mode?: 'selector' | 'visual';
  url: string;
  inputSelector?: string;
  inputPoint?: ChatAutomationPoint;
  sendPoint?: ChatAutomationPoint;
  viewport?: ChatAutomationViewport;
  text: string;
  dryRun?: boolean;
}): Promise<ChatAutomationSendResult> {
  return parseJson<ChatAutomationSendResult>(
    await fetch(apiUrl('/chat-automation/send'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}
