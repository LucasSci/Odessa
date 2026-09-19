export interface PaletteCommand {
  id: string;
  title: string;
  group: string;
  /** Termos extras que também casam na busca (ids, categoria, sinônimos). */
  keywords?: string;
  /** Texto curto à direita (ex.: atalho ou estado atual). */
  hint?: string;
  run: () => void | Promise<void>;
}

/** Minúsculas e sem acentos, para "transicao" achar "Transições". */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Pontuação de um comando para a busca: 0 = não casa. Todos os termos digitados
 * precisam aparecer (título, grupo ou palavras-chave); começar o título e casar
 * no início de uma palavra pontuam mais que casar no meio.
 */
export function scoreCommand(command: PaletteCommand, query: string): number {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  const title = normalizeText(command.title);
  const splitWords = (text: string) => text.split(/[\s\-_/:.,]+/).filter(Boolean);
  const titleWords = splitWords(title);
  const otherWords = splitWords(`${normalizeText(command.group)} ${normalizeText(command.keywords ?? '')}`);
  let total = 0;
  for (const token of tokens) {
    if (title.startsWith(token)) total += 4;
    else if (titleWords.some((word) => word.startsWith(token))) total += 3;
    else if (otherWords.some((word) => word.startsWith(token))) total += 1;
    // No meio da palavra só vale com 3+ letras: senão "ao" casaria dentro de "navegAOo".
    else if (token.length >= 3 && title.includes(token)) total += 2;
    else if (token.length >= 3 && otherWords.some((word) => word.includes(token))) total += 1;
    else return 0;
  }
  return total;
}

/** Filtra e ordena (maior pontuação primeiro; empate mantém a ordem original). */
export function filterCommands(commands: PaletteCommand[], query: string, limit = 60): PaletteCommand[] {
  if (normalizeText(query) === '') return commands.slice(0, limit);
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.command);
}
