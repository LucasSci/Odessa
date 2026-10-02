/**
 * humanizeReply — o que faz a resposta soar como gente, valha a IA que for
 * (local ou API). O prompt pede; aqui se garante:
 *  - limpeza: aspas, markdown, nome da persona no começo, "e você?" repetido;
 *  - rejeição (com uma nova tentativa): frase de atendente, repetição das falas
 *    anteriores dela e cópia literal dos exemplos da persona;
 *  - nome usável de quem escreveu e a linha "agora é…" do prompt.
 */

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Frases de assistente/atendente: ninguém fala assim num chat de live. */
const ASSISTANT_PHRASES = [
  /\bquer saber mais\b/,
  /\bposso (te )?ajudar\b/,
  /\bcomo posso\b/,
  /\bem que posso\b/,
  /\be importante (verificar|lembrar|notar|ressaltar)\b/,
  /\bcomo (uma )?(ia|assistente|modelo)\b/,
  /\bsou (uma )?(ia|inteligencia artificial|assistente virtual|modelo de linguagem)\b/,
  /\bnao (tenho|possuo) (acesso|informacoes) (a|em) tempo real\b/,
  /\bfico feliz em (ajudar|saber)\b/,
  /\bestou aqui para\b/,
  /\bcomo (gostaria|voce gostaria) de\b/,
  /\bespero (ter )?ajudado\b/,
  /\bnao soube responder\b/,
  /\bgostaria de saber mais\b/,
  /\bnao posso fazer isso\b/,
  /\bfique a vontade para\b/,
  /\bpesquisave(l|is)\b/,
  /\b(pesquise|pesquisar|consulte|consultar) (em|nos|nas|o|a)\b/,
  /\bveiculos de (noticias?|comunicacao)\b/,
  /\bfontes (oficiais|confiaveis)\b/,
  /\bwhat (aspect|else) .* interests? you\b/,
  /\bhow can i (help|assist)\b/,
];

export function soundsLikeAssistant(reply: string): boolean {
  const text = fold(reply);
  return ASSISTANT_PHRASES.some((re) => re.test(text));
}

export interface PersonaExample {
  message: string;
  reply: string;
}

/** Exemplos da persona (Mensagem "x" → "resposta"): mostram o tom, não são respostas prontas. */
export function personaExampleReplies(identity: string): PersonaExample[] {
  const examples: PersonaExample[] = [];
  for (const match of identity.matchAll(/["“]([^"”]+)["”]\s*→\s*["“]([^"”]+)["”]/g)) {
    examples.push({ message: match[1], reply: match[2] });
  }
  return examples;
}

function tokens(text: string): Set<string> {
  return new Set(fold(text).split(' ').filter((w) => w.length > 2));
}

/** Semelhança entre duas falas (palavras em comum / total). */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

const opening = (text: string) => fold(text).split(' ').slice(0, 3).join(' ');

export type RejectReason = 'assistente' | 'repeticao' | 'copia_exemplo';

/** Por que esta resposta não deve ir para o chat (ou null se está boa). */
export function rejectReason(
  reply: string,
  recentOwn: string[],
  examples: PersonaExample[] = [],
  incomingText = '',
): RejectReason | null {
  if (soundsLikeAssistant(reply)) return 'assistente';
  const folded = fold(reply);
  // Copiar um exemplo só é ruim quando a pergunta é outra ("Perfeita" →
  // "Casablanca, pela décima vez"). Para a mesma pergunta, a resposta do
  // exemplo é a resposta dela; repetir na mesma live é barrado logo abaixo.
  const copied = examples.find((ex) => fold(ex.reply) === folded || (folded.length > 12 && similarity(ex.reply, reply) >= 0.8));
  if (copied && !(incomingText && similarity(copied.message, incomingText) >= 0.3)) return 'copia_exemplo';
  const recent = recentOwn.slice(-15);
  if (
    recent.some((own) => fold(own) === folded || similarity(own, reply) >= 0.7) ||
    (opening(reply).split(' ').length === 3 && recent.slice(-4).some((own) => opening(own) === opening(reply)))
  ) {
    return 'repeticao';
  }
  return null;
}

export function describeRejection(reason: RejectReason): string {
  return {
    assistente: 'soou como atendente/assistente',
    repeticao: 'repetiu uma fala recente dela',
    copia_exemplo: 'copiou um exemplo da persona',
  }[reason];
}

const TRAILING_RETURN_QUESTION = /[\s,.!…-]*(e (você|vc|tu)|and you)\s*\?+\s*(\p{Extended_Pictographic}️?)?\s*$/iu;

/**
 * Limpeza final: aspas e markdown que a IA põe em volta, e o "e você?" no fim
 * quando ela acabou de usar isso (o vício mais visível de robô).
 */
export function cleanReply(reply: string, recentOwn: string[]): string {
  let text = reply.trim();
  text = text.replace(/\*\*?|__|`/g, '');
  // Aspas que fecham antes de um emoji final: “frase.” 🍷
  text = text.replace(/["”’»]+(\s*\p{Extended_Pictographic}️?\s*)$/u, '$1');
  text = text.replace(/^[\s"'“”‘’«»]+|[\s"'“”‘’«»]+$/g, '').trim();
  // "alguém" é só o rótulo de quem tem nome de spam na conversa: não é vocativo.
  text = text.replace(/,\s*algu[ée]m(?=\s*[.!?…]|\s*$)/giu, '').replace(/^algu[ée]m\s*,\s*/iu, '').trim();
  const lastTwo = recentOwn.slice(-2);
  if (TRAILING_RETURN_QUESTION.test(text) && lastTwo.some((own) => TRAILING_RETURN_QUESTION.test(own))) {
    const trimmed = text.replace(TRAILING_RETURN_QUESTION, '').trim();
    if (trimmed.length >= 3) text = /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  }
  return text;
}

/**
 * Nome que dá para usar na conversa. Nomes de "loja"/spam ($100,Give-l00K,Coin)
 * ou só números viram null — a IA não deve chamar ninguém assim.
 */
export function friendlyName(username: string | undefined): string | null {
  const name = (username || '').trim().replace(/^@/, '');
  if (!name || name.length > 24) return null;
  if (/[$€£,;|<>{}[\]=+]/.test(name)) return null;
  const letters = (name.match(/\p{L}/gu) || []).length;
  const digits = (name.match(/\d/g) || []).length;
  if (letters < 2 || digits > letters) return null;
  if (/^(espectador|unknown|usu[aá]rio|user)$/i.test(name)) return null;
  return name;
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** "Agora é sexta-feira, 22h10 (noite)": dá contexto real ("boa noite", "fim de semana"). */
export function nowContextLine(date = new Date()): string {
  const h = date.getHours();
  const period = h < 5 ? 'madrugada' : h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite';
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `[AGORA] ${WEEKDAYS[date.getDay()]}, ${h}h${mm} (${period}). Você está ao vivo.`;
}
