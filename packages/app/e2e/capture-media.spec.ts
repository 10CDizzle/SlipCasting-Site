/**
 * Generates the README's screenshots and GIF.
 *
 * It drives the REAL app, through the same flow a user would take. So the images
 * cannot drift away from the product and cannot show a workflow that does not
 * work: if the capture run cannot complete the flow, it fails, and there are no
 * images. Marketing that is also a test.
 *
 *   docker compose -f docker-compose.test.yml run --rm e2e \
 *     sh -c 'cd packages/app && npx playwright test capture-media --grep-invert=nothing'
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = join(process.cwd(), '../../docs/media');

test.use({ viewport: { width: 1440, height: 880 } });

async function shot(page: Page, name: string) {
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

test('capture', async ({ page }) => {
  // A cold browser auto-opens a sample, which would skip straight past the page we
  // want to photograph first. Present as a returning visitor.
  await page.addInitScript(() => {
    window.localStorage.setItem('slipcast.seen', '1');
  });

  // 1. The Documents dashboard.
  await page.goto('/');
  await page.getByTestId('filter-samples').click();
  await page.waitForTimeout(300);
  await shot(page, 'documents');

  // 2. The workspace, on the part that makes the point: a mug, which cannot be
  //    molded along its own axis and has to be parted through the handle.
  await page.getByTestId('sample-mug').click();
  await expect(page.getByTestId('mass-properties')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200); // let the camera settle
  await shot(page, 'workspace');

  // 3. The undercut heatmap, in the Part Studio.
  await page.getByTestId('feature-pullDir').click();
  await page.waitForTimeout(600);
  await shot(page, 'heatmap');

  // 4. The mold, exploded.
  await page.getByTestId('tab-mold').click();
  await page.getByTestId('explode-slider').fill('1');
  await page.waitForTimeout(1400);
  await shot(page, 'exploded');

  // 5. An illegal reorder going red, which is the Onshape behaviour: the app shows
  //    you what broke rather than refusing the gesture.
  await page.getByTestId('feature-split').dragTo(page.getByTestId('feature-block'));
  await expect(page.getByTestId('feature-split')).toHaveAttribute('data-error', 'true');
  await shot(page, 'feature-error');

  // 6. The generated bench sheet. Re-open the sample rather than reloading: the
  //    workspace lives in memory, so a reload lands back on the Documents page.
  await page.goto('/');
  await page.getByTestId('filter-samples').click();
  await page.getByTestId('sample-cup').click();
  await expect(page.getByTestId('mass-properties')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('tab-instructions').click();
  await expect(page.getByTestId('instructions')).toBeVisible({ timeout: 60_000 });
  await shot(page, 'instructions');

  // 7. The refusal. A sealed void cannot be molded from any direction, and the
  //    tool says so instead of handing over a plausible-looking file.
  await page.goto('/');
  await page.getByTestId('filter-samples').click();
  await page.getByTestId('sample-sealed').click();
  await expect(page.getByTestId('fatal')).toBeVisible({ timeout: 60_000 });
  await shot(page, 'refusal');

  // 8. An animated turntable of the exploded mold, as an APNG-free GIF built from
  //    raw frames. Written as individual PNGs; assemble-gif.ts stitches them.
  await page.goto('/');
  await page.getByTestId('filter-samples').click();
  await page.getByTestId('sample-cup').click();
  await expect(page.getByTestId('mass-properties')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('tab-mold').click();

  const frames: Buffer[] = [];
  for (let i = 0; i <= 20; i++) {
    await page.getByTestId('explode-slider').fill(String(i / 20));
    await page.waitForTimeout(90);
    frames.push(await page.getByTestId('viewport').screenshot());
  }
  for (let i = 20; i >= 0; i--) {
    frames.push(frames[i]!);
  }

  await mkdir(join(OUT, 'frames'), { recursive: true });
  await Promise.all(
    frames.map((buf, i) =>
      writeFile(join(OUT, 'frames', `explode-${String(i).padStart(3, '0')}.png`), buf),
    ),
  );
});
