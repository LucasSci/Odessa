import { describe, expect, it } from 'vitest';
import { describeSendOutcome } from './sendOutcome';

describe('describeSendOutcome (#158)', () => {
  it('só chama de confirmada quando a mensagem apareceu no chat', () => {
    expect(describeSendOutcome({ status: 'sent', confirmed: true, commandId: 'abc123' }, 'oi chat')).toEqual({
      tone: 'confirmed',
      message: 'Enviada e confirmada no chat do Tango: "oi chat"\nComando abc123 (aparece nos logs da bridge).',
    });
  });

  it('enviada sem aparecer no chat pede para conferir no Tango', () => {
    const { tone, message } = describeSendOutcome({ status: 'sent', confirmed: false }, 'oi chat');
    expect(tone).toBe('unconfirmed');
    expect(message).toMatch(/não apareceu no chat/);
    expect(message).toMatch(/seletor das mensagens/);
  });

  it('modo teste deixa claro que nada saiu', () => {
    expect(describeSendOutcome({ status: 'simulated' }, 'oi').message).toMatch(/nada foi enviado ao Tango/);
  });

  it('falha mostra o motivo da bridge', () => {
    expect(describeSendOutcome({ status: 'failed', error: 'O Tango não aceitou o envio' }, 'oi')).toMatchObject({
      tone: 'failed',
      message: 'Não foi enviada: O Tango não aceitou o envio',
    });
  });

  it('bridge antiga (sem confirmação) não finge que confirmou', () => {
    expect(describeSendOutcome({ status: 'sent' }, 'oi')).toMatchObject({ tone: 'sent' });
    expect(describeSendOutcome({ status: 'sent' }, 'oi').message).toMatch(/não confirma a entrega/);
  });
});
