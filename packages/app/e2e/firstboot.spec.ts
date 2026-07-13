/**
 * Photographs the cold-arrival experience and the mold-inspection views, for the
 * README and the docs. Opt-in, like the other capture spec.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = join(process.cwd(), '../../docs/media');

test.use({ viewport: { width: 1440, height: 880 } });

async function shot(page: Page, name: string) {
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

test('first boot', async ({ page }) => {
  // A genuinely cold browser: nothing stored, nothing seen.
  await page.goto('/');

  await expect(page.getByTestId('mass-properties')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);

  await shot(page, 'first-boot');
});

test('inspecting one half of the mold', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('mass-properties')).toBeVisible({ timeout: 60_000 });

  await page.getByTestId('tab-mold').click();

  // Right-click a body to isolate it: everything else disappears.
  await page.getByTestId('part-plaster-lower').click({ button: 'right' });
  await page.waitForTimeout(1200);

  await shot(page, 'half-mold');
});

test('placing the pour spare by clicking the part', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('mass-properties')).toBeVisible({ timeout: 60_000 });

  await page.getByTestId('feature-spare').click();
  await page.getByTestId('pick-spare').click();

  const box = (await page.getByTestId('viewport').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 45, box.y + box.height / 2 + 10);

  await expect(page.getByTestId('pick-spare')).toContainText('mm', { timeout: 30_000 });
  await page.waitForTimeout(1400);

  await shot(page, 'spare-placed');
});

test('sectioning the mold to see the cavity', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('mass-properties')).toBeVisible({ timeout: 60_000 });

  await page.getByTestId('tab-mold').click();
  await page.getByTestId('part-plaster-lower').click({ button: 'right' }); // isolate a half
  await page.getByTestId('toggle-section').click();
  await page.getByTestId('section-slider').fill('0.5');
  await page.waitForTimeout(1200);

  await shot(page, 'section');
});
