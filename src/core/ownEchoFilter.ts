/**
 * Reconhece o eco da própria persona no chat.
 *
 * O observer da bridge captura qualquer texto novo no chat, inclusive a
 * mensagem que a Odessa acabou de enviar. Se esse eco fosse tratado como fala
 * de espectador, ele duplicaria o histórico e, no modo Autônomo, a IA
 * responderia a si mesma.
 *
 * A mensagem é registrada ANTES do envio: a bridge só termina o /send depois
 * de ver a mensagem no chat (#158), então o eco chega antes da resposta. Cada
 * registro reconhece um único eco. A bridge nova também marca o eco como
 * `own`; este filtro cobre a bridge antiga e o eco que chega depois do prazo
 * de confirmação dela.
 */
const OWN_ECHO_WINDOW_MS = 60_000;

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

export function createOwnEchoFilter(windowMs = OWN_ECHO_WINDOW_MS) {
  let pending: { text: string; at: number }[] = [];

  const prune = (now: number) => {
    pending = pending.filter((entry) => now - entry.at < windowMs);
  };

  return {
    /** Registra uma mensagem prestes a ser enviada; devolve como desistir dela (envio falhou). */
    expect(text: string, now = Date.now()): () => void {
      const entry = { text: normalize(text), at: now };
      pending.push(entry);
      return () => {
        pending = pending.filter((item) => item !== entry);
      };
    },
    /** A mensagem recebida é o eco de algo que enviamos? Consome o registro. */
    consume(text: string, now = Date.now()): boolean {
      prune(now);
      const index = pending.findIndex((entry) => entry.text === normalize(text));
      if (index === -1) return false;
      pending.splice(index, 1);
      return true;
    },
  };
}
