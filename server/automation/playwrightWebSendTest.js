import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sendAutomatedMessage } from './sendController.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(path.join(__dirname, 'playwrightTestPage.html')).href;

async function runTest() {
  console.log('URL de teste:', url);

  const response = await sendAutomatedMessage({
    conversationContext: {
      conversationId: 'conv-test-001',
      participantName: 'Teste',
      messages: [{ role: 'user', text: 'Verificar campo de chat' }],
    },
    url,
    inputSelector: '#chat-input',
    sendButtonSelector: '#send-button',
    typingDelayMs: 20,
    metadata: { source: 'playwright-local-test' },
  });

  console.log('Resposta do envio automatizado:');
  console.log(response);

  if (!response.ok) {
    process.exit(1);
  }

  const typedValue = response.result?.typedValue ?? response.result?.typedValue;
  console.log('Valor digitado no campo:', typedValue);
}

runTest().catch((error) => {
  console.error('Erro no teste de envio:', error);
  process.exit(1);
});
