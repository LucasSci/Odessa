// server/automation/playwrightClient.js
// Camada de Interação Web: usa Playwright para simular digitação humana e enviar a mensagem.

import { chromium } from 'playwright';

const DEFAULT_SELECTOR_TIMEOUT = 10000;

export async function sendMessageOnWeb({ url, inputSelector, sendButtonSelector, message, typingDelayMs = 75 }) {
  let browser;
  let context;
  let page;

  if (!url) throw new Error('URL de destino é obrigatória.');
  if (!inputSelector) throw new Error('Seletor de input é obrigatório.');
  if (!sendButtonSelector) throw new Error('Seletor do botão de envio é obrigatório.');
  if (!message || typeof message !== 'string') throw new Error('Mensagem deve ser uma string não vazia.');

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const input = page.locator(inputSelector);
    await input.waitFor({ state: 'visible', timeout: DEFAULT_SELECTOR_TIMEOUT });
    await input.click({ timeout: DEFAULT_SELECTOR_TIMEOUT });
    await input.fill('');
    await input.type(message, { delay: Math.max(15, Math.min(typingDelayMs, 150)) });

    const typedValue = await input.inputValue().catch(() => null);

    const sendButton = page.locator(sendButtonSelector);
    await sendButton.waitFor({ state: 'visible', timeout: DEFAULT_SELECTOR_TIMEOUT });
    await sendButton.click({ timeout: DEFAULT_SELECTOR_TIMEOUT });

    return {
      ok: true,
      deliveredAt: new Date().toISOString(),
      url,
      message,
      typedValue,
    };
  } catch (error) {
    const normalized = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha ao enviar mensagem no navegador: ${normalized}`);
  } finally {
    try {
      if (page) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (cleanupError) {
      console.error('Erro ao fechar recursos do Playwright:', cleanupError);
    }
  }
}
