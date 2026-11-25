import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.plot > svg')).toBeVisible();
});

test('renders a nonblank story without viewport overflow', async ({ page }) => {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);

  await expect(page.getByRole('heading', { name: 'Baseline', exact: true })).toBeVisible();
  await expect(page.locator('.bead')).toHaveCount(10);
  await expect(page).toHaveScreenshot('intent-stage.png');
});

test('plays the next demonstration stage', async ({ page }) => {
  await page.getByRole('button', { name: 'Play demonstration' }).click();
  await expect(page.getByRole('heading', { name: 'Provenance', exact: true })).toBeVisible({
    timeout: 4_000,
  });
  await expect(page.getByRole('button', { name: 'Pause demonstration' })).toBeVisible();
});

test('surfaces semantic drift and its attached evidence', async ({ page }) => {
  await page.getByRole('button', { name: /Go to step 7: Verify/ }).click();
  await expect(page.getByRole('heading', { name: 'Drift detected', exact: true })).toBeVisible();
  await expect(
    page.getByText('Thirty-day retention contradicts the no-retention baseline.'),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'evidence' }).click();
  await expect(page.getByText('Semantic baseline comparison')).toBeVisible();
  await expect(page).toHaveScreenshot('drift-evidence-stage.png');
});
