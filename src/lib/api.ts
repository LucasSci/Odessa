const env = (
  import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }
).env;

const browserOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000';
const browserHostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLocalHost = ['localhost', '127.0.0.1', '::1', ''].includes(browserHostname);
const forceExternalApi = env?.VITE_FORCE_API_BASE_URL === 'true';
const usesSameOriginCloudApi = !isLocalHost && !forceExternalApi;
export const LOCAL_ODESSA_API_ORIGIN = env?.VITE_LOCAL_API_ORIGIN || 'http://127.0.0.1:8000';
const defaultApiBaseUrl = `${browserOrigin}/api/v1`;

const rawApiBaseUrl = (usesSameOriginCloudApi ? defaultApiBaseUrl : env?.VITE_API_BASE_URL || defaultApiBaseUrl).replace(
  /\/$/,
  '',
);
const API_ORIGIN = rawApiBaseUrl.replace(/\/api\/v1$/, '').replace(/\/api$/, '');

export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

const API_V1_PREFIXES = [
  '/video',
  '/workflow',
  '/automation',
  '/ocr',
  '/ai',
  '/tts',
  '/memory',
  '/misc',
  '/conversations',
  '/chat-automation',
];

export function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;

  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (usesSameOriginCloudApi && (normalized === '/obs' || normalized.startsWith('/obs/') || normalized.startsWith('/obs?'))) {
    const [pathPart, query = ''] = normalized.split('?');
    const action = pathPart.replace(/^\/obs\/?/, '') || 'status';
    const params = new URLSearchParams(query);
    params.set('obsAction', action);
    return `${browserOrigin}/api/agent?${params.toString()}`;
  }
  if (
    usesSameOriginCloudApi &&
    ['/auth', '/health', '/ocr', '/webhooks', '/proxy', '/agent'].some(
      (prefix) =>
        normalized === prefix ||
        normalized.startsWith(`${prefix}/`) ||
        normalized.startsWith(`${prefix}?`),
    )
  ) {
    return `${browserOrigin}/api${normalized}`;
  }
  if (normalized.startsWith('/api/v1/')) return `${API_ORIGIN}${normalized}`;
  if (normalized.startsWith('/api/')) return `${API_BASE_URL}${normalized.replace(/^\/api/, '')}`;
  if (API_V1_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    return `${API_BASE_URL}${normalized}`;
  }
  return `${API_ORIGIN}${normalized}`;
}
