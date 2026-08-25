// server/automation/sendExample.js
// Exemplo de uso do controlador de envio automatizado.

import { sendAutomatedMessage } from './sendController.js';

async function runExample() {
  const response = await sendAutomatedMessage({
    conversationContext: {
      conversationId: 'conv-demo-001',
      participantName: 'João',
      tone: 'amigável e direto',
      topic: 'responder ao comentário do chat sobre o agendamento da live',
      messages: [
        { role: 'user', text: 'Odessa, quando começa a live?' },
      ],
    },
    url: 'https://example-chat-page.com',
    inputSelector: '#chat-input', // substitua pelo seletor real do campo de chat
    sendButtonSelector: '#chat-send-button', // substitua pelo seletor real do botão de envio
    typingDelayMs: 80,
    metadata: { source: 'automation-demo' },
  });

  console.log('Resultado do envio automatizado:', response);
}

runExample().catch((error) => {
  console.error('Falha no exemplo de envio automatizado:', error);
});
