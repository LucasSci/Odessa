import { describe, expect, it } from 'vitest';
import {
  cleanReply,
  friendlyName,
  nowContextLine,
  personaExampleReplies,
  rejectReason,
  soundsLikeAssistant,
} from './humanizeReply';

const IDENTITY = `EXEMPLOS:
Mensagem "oi linda" → "Boa noite. Veio pela conversa ou pela vista?"
Mensagem "o que você tá assistindo?" → "Casablanca, pela décima vez. Clássicos não envelhecem. E você?"`;

describe('humanizeReply', () => {
  it('reconhece fala de atendente', () => {
    expect(soundsLikeAssistant('Dragon Ball é o mais visto. Quer saber mais sobre isso?')).toBe(true);
    expect(soundsLikeAssistant('Não soube responder de forma respeitosa à sua pergunta.')).toBe(true);
    expect(soundsLikeAssistant('What aspect of Dragon Ball interests you the most?')).toBe(true);
    expect(soundsLikeAssistant('Dragon Ball, fácil. Cresci vendo na TV.')).toBe(false);
  });

  it('cópia de exemplo só é rejeitada quando a pergunta é outra', () => {
    const examples = personaExampleReplies(IDENTITY);
    expect(examples).toHaveLength(2);
    expect(examples[1].message).toBe('o que você tá assistindo?');
    const copia = 'Casablanca, pela décima vez. Clássicos não envelhecem. E você?';
    expect(rejectReason(copia, [], examples, 'Perfeita')).toBe('copia_exemplo');
    expect(rejectReason(copia, [], examples, 'o que vc ta assistindo hoje?')).toBeNull();
    expect(rejectReason('Revi Casablanca ontem, aliás.', [], examples, 'Perfeita')).toBeNull();
  });

  it('pega o "pesquise nas fontes" de assistente', () => {
    expect(soundsLikeAssistant('Não acompanho, mas geralmente são buscadas nos principais veículos de notícias.')).toBe(true);
    expect(soundsLikeAssistant('Não acompanho esse tipo de estatística, mas é um tópico pesquisável.')).toBe(true);
    expect(soundsLikeAssistant('Não posso fazer isso, mas fique à vontade para continuar conversando!')).toBe(true);
    expect(soundsLikeAssistant('Política eu não acompanho, prefiro meus livros.')).toBe(false);
  });

  it('pega repetição das falas recentes dela (inteira ou mesma abertura)', () => {
    const recent = ['Tudo sim, tomando meu chá aqui. E você?', 'Boa noite, que bom te ver.'];
    expect(rejectReason('Tudo sim, tomando meu chá aqui! E você? 😊', recent)).toBe('repeticao');
    expect(rejectReason('Boa noite, que bom que chegou.', recent)).toBe('repeticao');
    expect(rejectReason('Chegou na hora certa, o vinho acabou de abrir.', recent)).toBeNull();
  });

  it('limpa aspas, markdown e o "e você?" repetido', () => {
    expect(cleanReply('“Rússia. Um continente inteiro, na verdade.” 🍷', [])).toBe('Rússia. Um continente inteiro, na verdade. 🍷');
    expect(cleanReply('**Claro**, adoro jazz', [])).toBe('Claro, adoro jazz');
    expect(cleanReply('Hoje foi calmo, li bastante. E você?', ['Tudo certo por aqui. E você?'])).toBe('Hoje foi calmo, li bastante.');
    expect(cleanReply('Hoje foi calmo, li bastante. E você?', ['Boa noite.'])).toBe('Hoje foi calmo, li bastante. E você?');
  });

  it('só usa nomes de gente', () => {
    expect(friendlyName('carlos_sp')).toBe('carlos_sp');
    expect(friendlyName('War Elephant')).toBe('War Elephant');
    expect(friendlyName('$100,Give-l00K,Coin')).toBeNull();
    expect(friendlyName('user837261')).toBeNull();
    expect(friendlyName('Espectador')).toBeNull();
  });

  it('linha de "agora" com dia e período', () => {
    expect(nowContextLine(new Date(2026, 9, 2, 22, 5))).toBe('[AGORA] sexta-feira, 22h05 (noite). Você está ao vivo.');
  });
});
