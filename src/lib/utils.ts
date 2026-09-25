import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// http(s), blob:, data:image/… e caminhos relativos ao app. Qualquer outro
// esquema (javascript:, data:text/html…) é descartado.
const SAFE_IMAGE_SRC = /^(https?:\/\/|blob:|data:image\/(png|jpe?g|gif|webp|avif);|\/(?!\/)|\.{1,2}\/)/i;

/**
 * URL digitada pelo usuário → `src` de imagem seguro (ou `undefined`).
 * Use sempre que o `src` vier de um campo de texto ou de dado salvo pelo usuário.
 */
export function safeImageSrc(url: string | null | undefined): string | undefined {
  const value = (url ?? '').trim();
  return value && SAFE_IMAGE_SRC.test(value) ? value : undefined;
}
