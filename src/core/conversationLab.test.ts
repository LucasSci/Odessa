import { afterEach, describe, expect, it } from 'vitest';
import {
  chatHistoryFor,
  clearStoredConversation,
  conversationToText,
  formatClock,
  loadConversation,
  MAX_STORED_MESSAGES,
  providerLabel,
  saveConversation,
  type LabMessage,
} from './conversationLab';

const msg = (role: LabMessage['role'], text: string, extra: Partial<LabMessage> = {}): LabMessage => ({
  role,
  username: role === 'user' ? 'Voce' : role === 'assistant' ? 'Barbara' : 'sistema',
  text,
  ...extra,
});

afterEach(() => window.localStorage.clear());

describe('persistência da conversa', () => {
  it('salva e recarrega por persona', () => {
    saveConversation('barbara', [msg('user', 'oi'), msg('assistant', 'oi, amor!')]);
    saveConversation('julia', [msg('user', 'olá')]);
    expect(loadConversation('barbara').map((m) => m.text)).toEqual(['oi', 'oi, amor!']);
    expect(loadConversation('julia')).toHaveLength(1);
    expect(loadConversation('outra')).toEqual([]);
  });

  it('guarda só as últimas mensagens', () => {
    saveConversation('b', Array.from({ length: MAX_STORED_MESSAGES + 30 }, (_, i) => msg('user', `m${i}`)));
    const stored = loadConversation('b');
    expect(stored).toHaveLength(MAX_STORED_MESSAGES);
    expect(stored[stored.length - 1].text).toBe(`m${MAX_STORED_MESSAGES + 29}`);
  });

  it('descarta itens inválidos e tolera JSON corrompido', () => {
    window.localStorage.setItem('odessa.conversationLab.x', JSON.stringify([{ role: 'hacker', text: 'x', username: 'y' }, { role: 'user' }, msg('user', 'ok')]));
    expect(loadConversation('x').map((m) => m.text)).toEqual(['ok']);
    window.localStorage.setItem('odessa.conversationLab.y', '{lixo');
    expect(loadConversation('y')).toEqual([]);
  });

  it('limpar remove do armazenamento', () => {
    saveConversation('b', [msg('user', 'oi')]);
    clearStoredConversation('b');
    expect(loadConversation('b')).toEqual([]);
  });
});

describe('chatHistoryFor', () => {
  it('tira avisos e falhas do contexto e limita o tamanho', () => {
    const list = [msg('user', 'a'), msg('system', 'aviso'), msg('assistant', 'b'), msg('system', 'falhou', { error: true }), msg('user', 'c')];
    expect(chatHistoryFor(list).map((m) => m.text)).toEqual(['a', 'b', 'c']);
    expect(chatHistoryFor(list, 2).map((m) => m.text)).toEqual(['b', 'c']);
  });
});

describe('formatClock / conversationToText / providerLabel', () => {
  it('formata hora e ignora datas inválidas', () => {
    expect(formatClock('2026-09-20T14:05:00')).toMatch(/14:05/);
    expect(formatClock('lixo')).toBe('');
    expect(formatClock(undefined)).toBe('');
  });

  it('exporta como texto sem as mensagens de erro', () => {
    const text = conversationToText('Barbara', [msg('user', 'oi', { timestamp: '2026-09-20T14:05:00' }), msg('system', 'falhou', { error: true }), msg('assistant', 'oi!')]);
    expect(text).toContain('Conversa com Barbara');
    expect(text).toMatch(/\[14:05\] Voce: oi/);
    expect(text).toContain('Barbara: oi!');
    expect(text).not.toContain('falhou');
  });

  it('rotula o provedor real', () => {
    expect(providerLabel('ollama', 'qwen2.5:latest')).toBe('Ollama · qwen2.5:latest');
    expect(providerLabel('ollama')).toBe('Ollama');
    expect(providerLabel('gemini')).toBe('Gemini');
    expect(providerLabel('claude')).toBe('Claude');
  });
});
