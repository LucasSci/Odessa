/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Chave da Gemini API embutida na build (opcional). */
  readonly VITE_GEMINI_API_KEY?: string;
  /** Sentry (opcional): sem DSN, nada é carregado nem enviado. */
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  /** 0 a 1 — fração de navegações com tracing de performance. Padrão 0. */
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
