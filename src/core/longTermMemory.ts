/**
 * Memória de fatos por espectador (ex.: "pedido: …", "gosta: …").
 *
 * Alimentada pelo aprendizado do chat (`chatLearning.ts`) e lida pela Diretora
 * (`retrieveContext` em `personaRuntime.ts`). Fica no navegador do operador
 * e segue os controles de privacidade da memória do chat (#254):
 * - "Resetar aprendizado" apaga tudo (`clear`);
 * - "Esquecer" um espectador apaga os fatos dele (`forgetUser`);
 * - espectador oculto não entra no contexto nem ganha fatos novos (`setHidden`);
 * - há teto por espectador e no total, para não crescer para sempre.
 */

export interface UserFact {
  id: string;
  userId: string;
  topic: string;
  content: string;
  timestamp: string;
}

const FACTS_KEY = 'odessa:rag-memory:v1';
const HIDDEN_KEY = 'odessa:rag-memory:hidden:v1';
const MAX_FACTS_PER_USER = 10;
const MAX_FACTS_TOTAL = 500;

/** O mesmo espectador com ou sem "@" e com maiúsculas diferentes. */
function userKey(userId: string): string {
  return userId.trim().replace(/^@/, '').toLowerCase();
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readList<T>(key: string, isItem: (value: unknown) => value is T): T[] {
  if (!canUseStorage()) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, items: unknown[]) {
  if (!canUseStorage()) return;
  try {
    if (items.length) window.localStorage.setItem(key, JSON.stringify(items));
    else window.localStorage.removeItem(key);
  } catch {
    // Sem espaço no navegador: a memória segue só nesta sessão.
  }
}

const isFact = (value: unknown): value is UserFact =>
  Boolean(value) && typeof (value as UserFact).userId === 'string' && typeof (value as UserFact).content === 'string';
const isString = (value: unknown): value is string => typeof value === 'string';

export class LongTermMemoryManager {
  private facts: UserFact[] = readList(FACTS_KEY, isFact);
  private hidden = new Set(readList(HIDDEN_KEY, isString));

  /** Guarda um fato sobre o espectador (ignorado se ele estiver oculto). */
  public storeFact(userId: string, topic: string, content: string): void {
    const key = userKey(userId);
    if (!key || this.hidden.has(key)) return;
    if (this.facts.some((f) => userKey(f.userId) === key && f.topic === topic && f.content === content)) return;

    this.facts.push({
      id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      topic,
      content,
      timestamp: new Date().toISOString(),
    });
    // Tetos: ficam os fatos mais recentes do espectador e da memória toda.
    const mine = this.facts.filter((f) => userKey(f.userId) === key);
    if (mine.length > MAX_FACTS_PER_USER) {
      const oldest = new Set(mine.slice(0, mine.length - MAX_FACTS_PER_USER));
      this.facts = this.facts.filter((f) => !oldest.has(f));
    }
    if (this.facts.length > MAX_FACTS_TOTAL) this.facts = this.facts.slice(-MAX_FACTS_TOTAL);
    writeList(FACTS_KEY, this.facts);
  }

  /** Fatos de quem está na live, para o prompt da Diretora (sem os ocultos). */
  public retrieveContext(userIds: string[]): string {
    const wanted = new Set(userIds.map(userKey).filter((key) => key && !this.hidden.has(key)));
    if (wanted.size === 0) return '';

    const relevantFacts = this.facts.filter((f) => wanted.has(userKey(f.userId)));
    if (relevantFacts.length === 0) return '';

    const contextLines = relevantFacts.map((f) => `- [${f.userId}] sobre ${f.topic}: ${f.content}`);
    return `\n\n[MEMORIA VETORIAL (RAG)] - Fatos conhecidos sobre quem esta na live:\n${contextLines.join('\n')}\n`;
  }

  /** "Esquecer" um espectador: apaga os fatos dele. */
  public forgetUser(userId: string): void {
    const key = userKey(userId);
    this.facts = this.facts.filter((f) => userKey(f.userId) !== key);
    this.hidden.delete(key);
    writeList(FACTS_KEY, this.facts);
    writeList(HIDDEN_KEY, [...this.hidden]);
  }

  /** Oculto: continua guardado, mas não entra no contexto nem ganha fatos novos. */
  public setHidden(userId: string, hidden: boolean): void {
    const key = userKey(userId);
    if (!key) return;
    if (hidden) this.hidden.add(key);
    else this.hidden.delete(key);
    writeList(HIDDEN_KEY, [...this.hidden]);
  }

  /** "Resetar aprendizado": apaga todos os fatos e a lista de ocultos. */
  public clear(): void {
    this.facts = [];
    this.hidden.clear();
    writeList(FACTS_KEY, []);
    writeList(HIDDEN_KEY, []);
  }
}

export const globalRAGMemory = new LongTermMemoryManager();
