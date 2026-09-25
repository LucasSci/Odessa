import { expect, test, type Page } from '@playwright/test';

// O preview não tem backend: as chamadas /api falham de propósito. O app
// precisa continuar navegável — o que não pode acontecer é exceção não
// tratada (página branca) ou painel lazy que nunca sai do skeleton.

const PAGES = [
  { label: 'Ao Vivo', slug: 'ao-vivo' },
  { label: 'Biblioteca', slug: 'biblioteca' },
  { label: 'Automações', slug: 'automacoes' },
  { label: 'Conversar', slug: 'conversar' },
  { label: 'Personas', slug: 'personas' },
  { label: 'Histórico', slug: 'historico' },
  { label: 'Configurações', slug: 'configuracoes' },
  { label: 'Diagnóstico', slug: 'diagnostico' },
];

function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('o shell carrega sem exceções não tratadas', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Páginas' })).toBeVisible();
  await expect(page.locator('.odsa-topbar h1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('navega por todas as páginas e cada uma sai do carregamento', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Páginas' });

  for (const { label, slug } of PAGES) {
    await nav.getByRole('button', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/${slug}$`));
    const section = page.getByRole('region', { name: label, exact: true });
    await expect(section).toBeVisible();
    // Painéis lazy mostram skeleton (aria-busy) enquanto o chunk baixa.
    await expect(section.locator('[aria-busy="true"][data-skeleton="panel"]')).toHaveCount(0, { timeout: 15_000 });
  }

  expect(errors).toEqual([]);
});

test('painel lazy mostra skeleton enquanto o chunk baixa', async ({ page }) => {
  // Segura o chunk da página Histórico até o teste ver o skeleton. Um atraso
  // fixo não serve: o app pré-carrega os chunks quando o navegador fica ocioso
  // e, com a máquina carregada, o chunk chegava antes do clique.
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/SessionHistoryPanel-.*\.js$/, async (route) => {
    await released;
    await route.continue();
  });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Páginas' }).getByRole('button', { name: 'Histórico', exact: true }).click();
  const section = page.getByRole('region', { name: 'Histórico', exact: true });
  const skeleton = section.locator('[data-skeleton="panel"]');
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute('aria-busy', 'true');
  release();
  await expect(skeleton).toHaveCount(0, { timeout: 15_000 });
});

test('paleta de comandos abre com Ctrl+K e fecha com Esc', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('rota direta pela URL abre a página certa', async ({ page }) => {
  await page.goto('/#/historico');
  await expect(page.getByRole('region', { name: 'Histórico', exact: true })).toBeVisible();
});

test.describe('movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce' });

  test('respeita prefers-reduced-motion nas transições', async ({ page }) => {
    await page.goto('/');
    const duration = await page
      .locator('.odsa-page:not([hidden])')
      .first()
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duration)).toBeLessThan(0.01);
  });
});
