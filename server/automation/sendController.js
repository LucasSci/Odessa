// server/automation/sendController.js
// Controlador central: orquestra AI Engine, Playwright e histórico de envio.

import { buildChatMessageText } from './aiEngine.js';
import { sendMessageOnWeb } from './playwrightClient.js';
import { createSendIntent, updateSendStatus } from './sendHistory.js';

export async function sendAutomatedMessage({
  conversationContext,
  url,
  inputSelector,
  sendButtonSelector,
  typingDelayMs,
  metadata,
}) {
  const intent = createSendIntent({
    conversationId: conversationContext?.conversationId,
    description: 'Automated chat message send',
    metadata,
  });

  try {
    const message = buildChatMessageText(conversationContext);

    const result = await sendMessageOnWeb({
      url,
      inputSelector,
      sendButtonSelector,
      message,
      typingDelayMs,
    });

    updateSendStatus(intent.id, 'Enviado', { result });

    return {
      ok: true,
      intentId: intent.id,
      message,
      result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateSendStatus(intent.id, 'Erro', { error: errorMessage });
    return {
      ok: false,
      intentId: intent.id,
      error: errorMessage,
    };
  }
}

// Exemplo de uso:
// import { sendAutomatedMessage } from './server/automation/sendController.js';
// const response = await sendAutomatedMessage({
//   conversationContext: {
//     conversationId: 'conv-123',
//     participantName: 'João',
//     messages: [
//       { role: 'user', text: 'Oi, Odessa!' },
//       { role: 'assistant', text: 'Olá! Em que posso ajudar?' },
//     ],
//   },
//   url: 'https://plataforma-de-chat.com',
//   inputSelector: '#chat-input', // inserir seletor real aqui
//   sendButtonSelector: '#send-button', // inserir seletor real aqui
//   typingDelayMs: 65,
//   metadata: { channel: 'tiktok', automation: true },
// });
