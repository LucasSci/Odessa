/**
 * Odessa - Arquitetura de Memoria de Longo Prazo (RAG)
 *
 * Este modulo gerencia o armazenamento e recuperacao de fatos sobre os usuarios.
 * Futuramente, isso devera se conectar aos endpoints /ai/memory/query no backend (Vector DB).
 * Por enquanto, utiliza uma simulacao de armazenamento local estruturado.
 */

export interface UserFact {
  id: string;
  userId: string;
  topic: string;
  content: string;
  timestamp: string;
}

export class LongTermMemoryManager {
  private facts: UserFact[] = [];
  private readonly storageKey = 'odessa:rag-memory:v1';

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        this.facts = JSON.parse(raw);
      }
    } catch {
      this.facts = [];
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.facts));
    } catch {
      // Ignora erro de limite de quota
    }
  }

  /**
   * Salva um fato importante sobre o usuario.
   */
  public storeFact(userId: string, topic: string, content: string): void {
    const isDuplicate = this.facts.some(
      (f) => f.userId === userId && f.topic === topic && f.content === content,
    );
    if (isDuplicate) return;

    this.facts.push({
      id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      topic,
      content,
      timestamp: new Date().toISOString(),
    });
    this.saveToStorage();
  }

  /**
   * Recupera o contexto do usuario para injecao no prompt da IA (Simulando uma RAG Query).
   */
  public retrieveContext(userIds: string[]): string {
    if (userIds.length === 0) return '';

    const relevantFacts = this.facts.filter((f) => userIds.includes(f.userId));
    if (relevantFacts.length === 0) return '';

    const contextLines = relevantFacts.map((f) => `- [${f.userId}] sobre ${f.topic}: ${f.content}`);

    return `\n\n[MEMORIA VETORIAL (RAG)] - Fatos conhecidos sobre quem esta na live:\n${contextLines.join('\n')}\n`;
  }
}

export const globalRAGMemory = new LongTermMemoryManager();
