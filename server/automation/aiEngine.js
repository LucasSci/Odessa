// server/automation/aiEngine.js
// Camada de Inteligência: recebe contexto da conversa e retorna apenas o texto exato que será digitado.

export function buildChatMessageText(conversationContext) {
  const context = conversationContext || {};
  const messages = Array.isArray(context.messages) ? context.messages : [];
  const participant = String(context.participantName || context.participantId || 'Usuário').trim();
  const tone = String(context.tone || 'simples e amigável').trim();
  const topic = String(context.topic || 'responda o comentário recebido').trim();

  const historyLines = messages
    .slice(-6)
    .map((message) => `${message.role === 'assistant' ? 'Odessa' : message.role}: ${message.text}`)
    .join('\n');

  const promptLines = [
    `Contexto da conversa:
${historyLines}`.trim(),
    `
Gere o texto exato que deve ser digitado no chat.`,
    `- Destinatário: ${participant}`,
    `- Tom: ${tone}`,
    `- Objetivo: ${topic}`,
    'Não inclua comandos, tags ou metadados.',
    'Retorne apenas o texto da mensagem, sem aspas extras.',
  ];

  return promptLines.join('\n');
}

export function buildSimpleReply(conversationContext) {
  const messages = Array.isArray(conversationContext?.messages) ? conversationContext.messages : [];
  const lastMessage = messages.length ? messages[messages.length - 1] : null;
  const snippet = lastMessage ? String(lastMessage.text).trim() : 'Olá!';

  return `Olá! Obrigado pela mensagem. ${snippet}`;
}
