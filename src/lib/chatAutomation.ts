import { apiUrl } from './api';

const TARGET_STORAGE_KEY = 'odessa:chat-automation-target:v1';

export type ChatAutomationAllowEntry = {
  id: string;
  label: string;
  domain: string;
  urlPattern: string;
  inputSelector: string;
  sendSelector: string;
  submitWithEnter: boolean;
  typingDelayMs: number;
  maxPerMinute: number;
  enabled: boolean;
};

export type ChatAutomationTarget = {
  url: string;
  inputSelector: string;
  sendSelector?: string;
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
    if (typeof window === 'undefined') return { url: '', inputSelector: '', sendSelector: '' };
    const raw = window.localStorage.getItem(TARGET_STORAGE_KEY);
    if (!raw) return { url: '', inputSelector: '', sendSelector: '' };
    const parsed = JSON.parse(raw) as Partial<ChatAutomationTarget>;
    return {
      url: typeof parsed.url === 'string' ? parsed.url : '',
      inputSelector: typeof parsed.inputSelector === 'string' ? parsed.inputSelector : '',
      sendSelector: typeof parsed.sendSelector === 'string' ? parsed.sendSelector : '',
    };
  } catch {
    return { url: '', inputSelector: '', sendSelector: '' };
  }
}

export function saveChatAutomationTarget(target: ChatAutomationTarget): ChatAutomationTarget {
  const normalized = {
    url: target.url.trim(),
    inputSelector: target.inputSelector.trim(),
    sendSelector: target.sendSelector?.trim() || '',
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
        url: target.url,
        inputSelector: target.inputSelector || undefined,
      }),
    }),
  );
}

export async function sendChatAutomationMessage(payload: {
  url: string;
  inputSelector?: string;
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
