import { expect, test } from '@playwright/test';

// Central da Live (#168): em uma olhada, dá para saber se o chat real pode ser
// ligado; ligar o envio real sempre pede confirmação.

test.beforeEach(async ({ page }) => {
  // Começa em modo teste para o cenário ser determinístico.
  await page.addInitScript(() => {
    window.localStorage.setItem('odessa:tango:autonomy:v1', JSON.stringify({ autonomyMode: 'assistido', executionMode: 'dry_run' }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Central da Live' }).click();
});

test('mostra a prontidão da live com veredito, subsistemas e últimas respostas', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Prontidão da Live' });
  await expect(panel).toBeVisible();
  // Sem backend/bridge no preview: modo teste, envio real ainda não.
  await expect(panel.getByRole('heading')).toHaveText(/Modo teste — envio real ainda não/);
  for (const item of ['IA', 'Captura do chat', 'Envio no chat', 'OBS', 'Vídeo']) {
    await expect(panel.getByText(item, { exact: true })).toBeVisible();
  }
  await expect(panel.getByText('Última enviada:')).toBeVisible();
  await expect(panel.getByText('Última bloqueada:')).toBeVisible();
});

test('ligar o envio real pede confirmação e cancelar mantém o modo teste', async ({ page }) => {
  await page.getByRole('button', { name: /Dry-Run/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Ligar envio real no chat' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('digitadas e enviadas de verdade');
  await dialog.getByRole('button', { name: 'Continuar em teste' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Dry-Run/ })).toBeVisible();

  await page.getByRole('button', { name: /Dry-Run/ }).click();
  await page.getByRole('dialog', { name: 'Ligar envio real no chat' }).getByRole('button', { name: 'Ligar envio real' }).click();
  await expect(page.getByRole('button', { name: /Envio Real/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Prontidão da Live' }).getByRole('heading')).toHaveText(
    /Envio real ligado, mas não vai sair nada/,
  );
});
