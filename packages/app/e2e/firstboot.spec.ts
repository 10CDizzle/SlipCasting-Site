/**
 * Photographs the cold-arrival experience, for the README.
 * Opt-in, like the other capture spec.
 */
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = join(process.cwd(), '../../docs/media');

test.use({ viewport: { width: 1440, height: 880 } });

test('first boot', async ({ page }) => {
  await mkdir(OUT, { recursive: true });

  // A genuinely cold browser: nothing stored, nothing seen.
  await page.goto('/');

  await expect(page.getByTestId('mass-properties')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: join(OUT, 'first-boot.png') });
});
