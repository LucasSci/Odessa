/**
 * Login automático (opt-in, por aparelho).
 *
 * Mantém a sessão SEMPRE válida re-logando em segundo plano, pra o app nunca
 * pedir login — essencial pra lives 24/7 e pra acessar de vários dispositivos
 * sem ficar relogando.
 *
 * ⚠️ Trade-off: as credenciais ficam guardadas SÓ neste aparelho (localStorage),
 * levemente ofuscadas (base64 — não é criptografia). É uma escolha de
 * conveniência do operador, pra ferramenta própria.
 */

import { apiUrl } from './api';

const CREDS_KEY = 'odessa:auto-login:v1';
const TOKEN_KEY = 'odessa:admin-session-token:v1';
const REFRESH_BUFFER_SEC = 60 * 60; // renova quando faltar < 1h pra expirar
const CHECK_INTERVAL_MS = 20 * 60 * 1000; // re-checa a cada 20 min

type Creds = { email: string; password: string };

function enc(s: string): string {
  try { return btoa(unescape(encodeURIComponent(s))); } catch { return s; }
}
function dec(s: string): string {
  try { return decodeURIComponent(escape(atob(s))); } catch { return s; }
}

/** Ativa o login automático neste aparelho guardando as credenciais. */
export function setAutoLoginCredentials(email: string, password: string): void {
  try {
    localStorage.setItem(CREDS_KEY, JSON.stringify({ e: enc(email), p: enc(password) }));
  } catch { /* ignore */ }
}

/** Desativa o login automático e apaga as credenciais guardadas. */
export function clearAutoLogin(): void {
  try { localStorage.removeItem(CREDS_KEY); } catch { /* ignore */ }
}

export function isAutoLoginEnabled(): boolean {
  try { return Boolean(localStorage.getItem(CREDS_KEY)); } catch { return false; }
}

function getCreds(): Creds | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { e?: string; p?: string };
    if (!o.e || !o.p) return null;
    return { email: dec(o.e), password: dec(o.p) };
  } catch {
    return null;
  }
}

function tokenExpEpoch(): number | null {
  try {
    const tok = localStorage.getItem(TOKEN_KEY);
    if (!tok || !tok.includes('.')) return null;
    const payload = JSON.parse(atob(tok.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    return Number(payload.exp) || null;
  } catch {
    return null;
  }
}

/** True se há um token de sessão ainda válido (não expirado). */
export function hasValidSession(): boolean {
  const exp = tokenExpEpoch();
  if (!exp) return false;
  return exp - Date.now() / 1000 > 60; // válido por mais de 1 min
}

let inFlight = false;

/**
 * Garante uma sessão fresca: se o login automático está ativo e o token está
 * faltando ou perto de expirar, re-loga em segundo plano. Retorna true se a
 * sessão está/ficou válida.
 */
export async function ensureFreshSession(force = false): Promise<boolean> {
  if (inFlight) return false;
  const creds = getCreds();
  if (!creds) return false; // login automático não ativado
  const exp = tokenExpEpoch();
  const now = Date.now() / 1000;
  if (!force && exp && exp - now > REFRESH_BUFFER_SEC) return true; // ainda válido por > 1h

  inFlight = true;
  try {
    const res = await fetch(apiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: creds.email, password: creds.password }),
    });
    const data = (await res.json().catch(() => ({}))) as { authenticated?: boolean; sessionToken?: string };
    if (res.ok && data.sessionToken) {
      localStorage.setItem(TOKEN_KEY, data.sessionToken);
      return true;
    }
    return false;
  } catch {
    return false; // offline — tenta de novo no próximo tick
  } finally {
    inFlight = false;
  }
}

let started = false;

/** Inicia o loop de login automático (no boot do app). Idempotente. */
export function startAutoLogin(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void ensureFreshSession();
  window.setInterval(() => void ensureFreshSession(), CHECK_INTERVAL_MS);
  // Reforça quando a aba volta a ficar visível (ex.: PC dormiu a noite toda).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void ensureFreshSession();
  });
}
