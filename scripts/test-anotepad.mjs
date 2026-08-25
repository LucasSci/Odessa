import { chromium } from 'playwright';

async function testAnotepad() {
  console.log('🚀 Iniciando teste automatizado no anotepad.com...');
  const browser = await chromium.launch({ headless: false }); // headless false para poder visualizar ou headless true
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
  });
  const page = await context.newPage();

  try {
    console.log('🌐 Navegando para https://pt.anotepad.com/...');
    await page.goto('https://pt.anotepad.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('🔍 Localizando campos de título e conteúdo...');
    // Procura título
    const titleSelector = '#edit_title, input[placeholder*="título" i], input[placeholder*="Title" i], #note_title';
    const contentSelector = '#edit_textarea, textarea, [contenteditable="true"]';
    const saveButtonSelector = '#btnSaveNote, #btn_save_note, input[value*="Salvar" i], button:has-text("Salvar")';

    await page.waitForSelector(contentSelector, { timeout: 15000 });

    // Preenche Título se existir
    const titleElement = page.locator(titleSelector).first();
    if (await titleElement.isVisible().catch(() => false)) {
      console.log('✍️ Digitando título da nota...');
      await titleElement.click();
      await titleElement.fill('');
      await titleElement.pressSequentially('Odessa MVP - Teste de Automação de Chat', { delay: 35 });
    }

    // Digita mensagem no Bloco de Notas simulando digitação humana
    console.log('✍️ Simulando digitação da mensagem no corpo da nota...');
    const contentElement = page.locator(contentSelector).first();
    await contentElement.click();
    await contentElement.fill('');
    
    const messageText = `=== ODESSA LIVE CHAT AUTOMATION ===\nData do Teste: ${new Date().toLocaleString('pt-BR')}\nStatus: Operacional\n\nEste é um teste automatizado simulando a digitação humana do agente Odessa.\nA bridge e o motor de automação estão integrados com sucesso!\n====================================`;

    await contentElement.pressSequentially(messageText, { delay: 25 });
    console.log('✅ Mensagem digitada com sucesso!');

    // Clicar em Salvar se disponível
    const saveButton = page.locator(saveButtonSelector).first();
    if (await saveButton.isVisible().catch(() => false)) {
      console.log('💾 Salvando nota...');
      await saveButton.click();
      await page.waitForTimeout(2000);
      console.log('✅ Nota salva!');
    }

    // Tira screenshot de comprovação
    const screenshotPath = 'test_anotepad_result.png';
    await page.screenshot({ path: screenshotPath });
    console.log(`📸 Screenshot salvo em: ${screenshotPath}`);

    console.log('🎉 Teste automatizado concluído com 100% de sucesso!');
    return { ok: true, screenshotPath };
  } catch (err) {
    console.error('❌ Erro durante o teste:', err);
    return { ok: false, error: String(err) };
  } finally {
    await page.waitForTimeout(3000);
    await browser.close();
  }
}

testAnotepad();
