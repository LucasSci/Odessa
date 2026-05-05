const env = (
  import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }
).env;

export const API_BASE_URL = (env?.VITE_API_BASE_URL || 'http://localhost:8000/api/v1').replace(/\/$/, '');

export function apiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
