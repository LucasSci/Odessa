/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Chave da Gemini API embutida na build (opcional). */
  readonly VITE_GEMINI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
