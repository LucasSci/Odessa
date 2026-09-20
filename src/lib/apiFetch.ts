import { apiUrl } from './api';

/** Erro de uma chamada ao backend: status HTTP, mensagem legível e o `code` do detalhe (ex.: ai_unavailable). */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** Objeto enviado como JSON (com Content-Type). Para outros corpos use `rawBody`. */
  json?: unknown;
  rawBody?: BodyInit;
  /** Padrão: 15 s. `0` desliga o timeout. */
  timeoutMs?: number;
}

/** Extrai texto legível do `detail` do FastAPI (string, {message,code} ou lista de validação). */
export function describeErrorBody(status: number, body: unknown): { message: string; code?: string } {
  const fallback = `Falha na chamada ao backend (HTTP ${status}).`;
  if (!body || typeof body !== 'object') return { message: typeof body === 'string' && body ? body.slice(0, 240) : fallback };
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return { message: detail };
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => (item && typeof item === 'object' && 'msg' in item ? String((item as { msg: unknown }).msg) : ''))
      .filter(Boolean);
    return { message: parts.join('; ') || fallback };
  }
  if (detail && typeof detail === 'object') {
    const info = detail as { message?: unknown; code?: unknown; errors?: unknown };
    const errors = Array.isArray(info.errors) ? info.errors.map(String).join(' | ') : '';
    const message = [typeof info.message === 'string' ? info.message : '', errors].filter(Boolean).join(' — ');
    return { message: message || fallback, code: typeof info.code === 'string' ? info.code : undefined };
  }
  return { message: fallback };
}

/**
 * fetch para o backend com o que os `fetch` soltos esquecem: timeout, checagem de
 * `.ok` (erro vira `ApiError` em vez de o chamador ler um JSON de erro como se fosse
 * dado) e corpo JSON tipado. Resolve o caminho com `apiUrl`.
 */
export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { json, rawBody, timeoutMs = 15_000, headers, signal, ...init } = options;
  const finalHeaders = new Headers(headers);
  let body: BodyInit | undefined = rawBody;
  if (json !== undefined) {
    body = JSON.stringify(json);
    if (!finalHeaders.has('Content-Type')) finalHeaders.set('Content-Type', 'application/json');
  }

  const signals: AbortSignal[] = [];
  if (signal) signals.push(signal);
  if (timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers: finalHeaders,
      body,
      signal: signals.length ? AbortSignal.any(signals) : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ApiError(0, `O backend não respondeu em ${Math.round(timeoutMs / 1000)}s.`, 'timeout');
    }
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, error instanceof Error ? error.message : 'Backend inacessível.', 'network');
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = response.ok ? undefined : text;
    }
  }

  if (!response.ok) {
    const { message, code } = describeErrorBody(response.status, parsed);
    throw new ApiError(response.status, message, code, parsed);
  }
  return parsed as T;
}
