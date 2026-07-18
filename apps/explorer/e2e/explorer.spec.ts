import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.protocol-graph canvas').last()).toBeVisible();
});

test('renders a nonblank accountable transformation without viewport overflow', async ({
  page,
}) => {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);

  const coloredSamples = await page.locator('.protocol-graph canvas').evaluateAll((canvases) =>
    canvases.reduce((total, canvas) => {
      const htmlCanvas = canvas as HTMLCanvasElement;
      const context = htmlCanvas.getContext('2d');
      if (!context) return total;
      const pixels = context.getImageData(0, 0, htmlCanvas.width, htmlCanvas.height).data;
      let colored = 0;
      const stride = Math.max(4, Math.floor(pixels.length / 12_000 / 4) * 4);
      for (let index = 0; index < pixels.length; index += stride) {
        if (pixels[index + 3]! > 0) colored += 1;
      }
      return total + colored;
    }, 0),
  );
  expect(coloredSamples).toBeGreaterThan(100);

  await expect(
    page.getByRole('heading', { name: 'The constraint begins with the intent' }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot('intent-stage.png');
});

test('animates into the next accountable transformation stage', async ({ page }) => {
  await page.getByRole('button', { name: 'Play demonstration' }).click();
  await expect(
    page.getByRole('heading', { name: 'An AI proposes a path, not a decision' }),
  ).toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole('button', { name: 'Pause demonstration' })).toBeVisible();
});

test('switches to the confidence heatmap and selects a record by clicking a cell', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Confidence' }).click();
  await expect(page.getByRole('heading', { name: 'Confidence heatmap' })).toBeVisible();
  await expect(page.locator('.protocol-graph canvas')).toHaveCount(0);

  const cell = page.getByRole('button', { name: /AI-assisted triage: Semantic confidence/ });
  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'AI-assisted triage' })).toBeVisible();

  await page.getByRole('button', { name: 'Timeline' }).click();
  await expect(
    page.getByRole('heading', { name: 'An AI proposes a path, not a decision' }),
  ).toBeVisible();
});

test('surfaces semantic drift and its attached evidence', async ({ page }) => {
  await page.getByRole('slider', { name: 'Transformation timeline' }).fill('6');
  await expect(
    page.getByRole('heading', { name: 'The baseline exposes intent drift' }),
  ).toBeVisible();
  await expect(
    page.getByText('Thirty-day retention contradicts the no-retention baseline.'),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'evidence' }).click();
  await expect(page.getByText('Semantic baseline comparison')).toBeVisible();
  await expect(page).toHaveScreenshot('drift-evidence-stage.png');
});
