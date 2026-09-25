import type { SendOutcome } from './tangoChatSession';

export type SendOutcomeTone = 'confirmed' | 'sent' | 'unconfirmed' | 'simulated' | 'failed';

/**
 * O que aconteceu com uma mensagem enviada, numa frase para o operador (#158).
 * Usado no teste de envio da Configuração Automática e no envio manual: só
 * "confirmed" prova que a mensagem apareceu no chat do Tango.
 */
export function describeSendOutcome(outcome: SendOutcome, text: string): { tone: SendOutcomeTone; message: string } {
  const command = outcome.commandId ? `\nComando ${outcome.commandId} (aparece nos logs da bridge).` : '';
  if (outcome.status === 'simulated') {
    return {
      tone: 'simulated',
      message: 'Modo teste: nada foi enviado ao Tango. Ligue o Envio real e rode de novo para validar no chat de verdade.',
    };
  }
  if (outcome.status === 'failed') {
    return { tone: 'failed', message: `Não foi enviada: ${outcome.error || 'a bridge não respondeu.'}${command}` };
  }
  if (outcome.confirmed === true) {
    return { tone: 'confirmed', message: `Enviada e confirmada no chat do Tango: "${text}"${command}` };
  }
  if (outcome.confirmed === false) {
    return {
      tone: 'unconfirmed',
      message:
        `O Tango aceitou o envio, mas a mensagem não apareceu no chat a tempo: "${text}". ` +
        `Confira no Tango; se ela saiu, ajuste o seletor das mensagens em Configurações.${command}`,
    };
  }
  return {
    tone: 'sent',
    message: `Enviada ao Tango: "${text}". Esta bridge não confirma a entrega — reinicie a bridge para ter a confirmação.`,
  };
}

export const SEND_OUTCOME_ICON: Record<SendOutcomeTone, string> = {
  confirmed: '✅',
  sent: '✅',
  unconfirmed: '⚠️',
  simulated: '🧪',
  failed: '❌',
};
