/**
 * tangoReplyFallback.ts — Motor de respostas prontas (sem API).
 *
 * Gera respostas contextuais e naturais para o chat do Tango SEM precisar de
 * chave Gemini. Classifica a mensagem por intenção (saudação, elogio, presente,
 * pergunta, etc.) e devolve uma resposta variada da persona Odessa, curta
 * (<= 140 chars) e chamando a pessoa pelo nome.
 *
 * Quando o usuário configurar uma chave Gemini válida, o serviço principal
 * (tangoAiChatService) usa a IA real e este motor só é usado como fallback
 * final caso a chamada falhe.
 */

import type { TangoChatMessage } from './tangoAiChatService';

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const nameOf = (username: string) => {
  const clean = (username || 'amado').replace(/^@/, '').trim();
  return clean.length > 16 ? clean.slice(0, 16) : clean;
};

type Intent =
  | 'gift'
  | 'greeting'
  | 'compliment'
  | 'question'
  | 'follow'
  | 'goodbye'
  | 'generic';

function classify(text: string): Intent {
  const t = text.toLowerCase().trim();

  if (/(🌹|🌷|🎁|💜|💖|❤️|coroa|diamant|diamante|joia|presente|rosa|rose|gift|galaxy|tiktok coin)/.test(t))
    return 'gift';
  if (/(^|\s)(oi|ol[áa]|hello|hi|hey|salve|e ai|e a[ií]|boa noite|bom dia|boa tarde|fala)/.test(t))
    return 'greeting';
  if (/(lind|bonit|gostos|amo[- ]?voc|amor|maravilh|perfeit|divin|saudad|beautiful|love you|adoro)/.test(t))
    return 'compliment';
  if (/(segui|seguir|follow|segui de volta|ja segui|acabei de seguir)/.test(t))
    return 'follow';
  if (/(tchau|bye|at[ée] logo|at[ée] mais|vou saindo|good ?bye)/.test(t))
    return 'goodbye';
  if (/[?？]$/.test(t) || /^(como|qual|quais|que|q\b|o que|o q|onde|quando|por ?que|pq|vc|voc[êe]|tem|voc[êe]s|quantos|quanto)/.test(t))
    return 'question';

  return 'generic';
}

const RESPONSES: Record<Intent, (name: string) => string> = {
  gift: (n) =>
    pick([
      `Nossa @${n}, que presente lindo! Muito obrigada 💖✨`,
      `@${n} você me deixou sem palavras, obrigada! 🌹💕`,
      `Que carinho @${n}! Muito obrigada de coração 💜`,
      `@${n} que fofo! Agradecida demais por esse presente 🥰`,
    ]),
  greeting: (n) =>
    pick([
      `Oi @${n}! Que bom te ver por aqui ✨`,
      `Oii @${n}, seja bem-vindo(a) à live! 💕`,
      `@${n} oi amor! Já vai ficar comigo? 🥰`,
      `E aí @${n}, que alegria ter você aqui ✨`,
    ]),
  compliment: (n) =>
    pick([
      `Aaah @${n} para, tô ficando sem jeito 🙈💕`,
      `@${n} que doce, obrigada! Você é um amor 💖`,
      `Nossa @${n} obrigada demais, você é fofo 🥰`,
      `@${n} que fofura, me deixou feliz agora ✨`,
    ]),
  question: (n) =>
    pick([
      `Boa pergunta @${n}! Já respondo direitinho 💕`,
      `@${n} anotada a pergunta, já já respondo ✨`,
      `Oii @${n}! Tô vendo sua pergunta, já respondo 🥰`,
      `@${n} deixa comigo, vou responder já 💖`,
    ]),
  follow: (n) =>
    pick([
      `Valeu @${n} pelo follow! Bem-vindo à família 💕`,
      `@${n} obrigada por seguir! Fica comigo na live ✨`,
      `Que massa @${n}, agradecida pelo follow! 💖`,
    ]),
  goodbye: (n) =>
    pick([
      `Tchau @${n}! Volta sempre viu? 💕`,
      `@${n} já vai? Volta logo, vou sentir saudade 🥺`,
      `Até mais @${n}! Obrigada por ficar comigo ✨`,
    ]),
  generic: (n) =>
    pick([
      `@${n} obrigada por estar aqui comigo! 💕`,
      `Adorei sua mensagem @${n} ✨`,
      `@${n} que bom ter você na live hoje! 🥰`,
      `@${n} vi aqui, obrigada pelo carinho! 💖`,
    ]),
};

/**
 * Gera uma resposta pronta e contextual sem usar IA externa.
 * Retorna { reply, intent } para o serviço principal usar.
 */
export function generateLocalReply(
  incoming: TangoChatMessage,
  _recentHistory: TangoChatMessage[] = [],
): { reply: string; intent: Intent } {
  const name = nameOf(incoming.username);
  const intent = classify(incoming.text);
  let reply = RESPONSES[intent](name);
  if (reply.length > 140) reply = reply.slice(0, 139) + '…';
  return { reply, intent };
}

/** True se há risco da resposta ser genérica demais (sem contexto real). */
export function isFallbackIntent(intent: Intent): boolean {
  return intent === 'generic';
}
