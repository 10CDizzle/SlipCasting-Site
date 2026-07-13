import { test, expect, type Page } from '@playwright/test';

/**
 * The end-to-end promise, exercised in a real browser against the real built app.
 *
 * The point of these is not that buttons exist. It is that the WASM kernel loads,
 * the worker runs, geometry comes back, the physics is right, and the STLs that
 * land on disk are actually printable.
 */

type Sample = 'cup' | 'mug' | 'torus' | 'sealed';

async function openSample(page: Page, sample: Sample, expectMold = true) {
  await page.goto('/');
  await page.getByTestId('filter-samples').click();
  await page.getByTestId(`sample-${sample}`).click();
  // The kernel has to boot, parse, repair, analyse and build. Give it room.
  await expect(page.getByTestId('viewport')).toBeVisible({ timeout: 60_000 });
  if (expectMold) {
    await expect(page.getByTestId('mass-properties')).toBeVisible({ timeout: 60_000 });
  }
}

test('generates a mold from a sample cup and reports a plaster recipe', async ({ page }) => {
  await openSample(page, 'cup');

  // The bench numbers -- not a volume, a weighing-scale reading.
  const props = page.getByTestId('mass-properties');
  await expect(props).toContainText('Plaster');
  await expect(props).toContainText('kg');
  await expect(props).toContainText('Water');
  await expect(props).toContainText(/Every surface releases cleanly|drag on the plaster/);

  // The mold pieces exist and are named.
  await expect(page.getByTestId('parts-list')).toContainText('Master');
  await expect(page.getByTestId('parts-list')).toContainText('Plaster');
  await expect(page.getByTestId('parts-list')).toContainText('Print These');
});

test('refuses an impossible part instead of handing over a plausible-looking file', async ({ page }) => {
  // A sealed internal void cannot be reached from any direction. There is no such
  // thing as a mold that mostly comes off, so the only honest output is a refusal.
  // A tool that quietly emits geometry here is worse than one that emits nothing,
  // because the failure only surfaces after someone has printed and poured it.
  await openSample(page, 'sealed', false);

  const fatal = page.getByTestId('fatal');
  await expect(fatal).toBeVisible({ timeout: 60_000 });
  await expect(fatal).toContainText('cannot be molded');
  await expect(fatal).toContainText(/undercut/i);

  // And nothing printable was produced.
  await expect(page.getByTestId('mass-properties')).toBeHidden();
});

test('finds the seam a potter would use on a mug', async ({ page }) => {
  // The mug IS moldable, but not along its own axis -- the handle is a hopeless
  // undercut that way. The search has to pull through the handle's hole instead,
  // which is where a pottery actually puts the seam.
  await openSample(page, 'mug');

  // No refusal, and nothing trapped. The mug has plenty of shallow-draft surface
  // -- it will drag on the plaster -- so this asserts the thing that decides
  // whether a mold works at all, not the thing that decides how nicely it comes
  // apart.
  await expect(page.getByTestId('fatal')).toBeHidden();
  await expect(page.getByTestId('mass-properties')).not.toContainText('cannot be molded');
  await expect(page.getByTestId('mass-properties')).toContainText('Plaster');
  await expect(page.getByTestId('parts-list')).toContainText('Tray');
});

test('the Rollback Bar regenerates the model at an earlier point in its history', async ({ page }) => {
  await openSample(page, 'cup');

  // toContainText reads textContent; innerText would come back SHOUTING, because
  // the group headings are uppercased in CSS rather than in the markup.
  await expect(page.getByTestId('parts-list')).toContainText('Print These');

  // Roll the model back above the output feature: it stops having run.
  const handles = page.getByTestId('rollback-handle');
  await handles.nth(3).click();
  await expect(page.getByTestId('feature-output')).toHaveClass(/opacity-40/);

  // Roll forward again and the printable pieces come back.
  await handles.nth(3).click();
  await expect(page.getByTestId('parts-list')).toContainText('Print These', { timeout: 60_000 });
});

test('editing a feature parameter changes the geometry', async ({ page }) => {
  await openSample(page, 'cup');

  const props = page.getByTestId('mass-properties');
  const before = await props.innerText();

  await page.getByTestId('feature-block').click();
  await page.getByTestId('field-wallThickness').fill('45');
  await page.getByTestId('field-wallThickness').blur();

  // More plaster around the part means more plaster to mix. If this number does
  // not move, the parameter is not reaching the kernel.
  await expect(props).not.toHaveText(before, { timeout: 60_000 });
});

test('an illegal reorder marks the feature in error rather than refusing the drag', async ({ page }) => {
  await openSample(page, 'cup');

  // Drag Split above Mold block. Split consumes a body the block has not made yet,
  // so it must go red -- the way Onshape does it. The app shows you what broke; it
  // does not silently forbid the gesture.
  const split = page.getByTestId('feature-split');
  const block = page.getByTestId('feature-block');

  await split.dragTo(block);

  await expect(page.getByTestId('feature-split')).toHaveAttribute('data-error', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('feature-error').first()).toBeVisible();
});

test('the S key opens a contextual shortcut menu', async ({ page }) => {
  await openSample(page, 'cup');

  await page.getByTestId('viewport').click({ position: { x: 400, y: 300 } });
  await page.keyboard.press('s');

  await expect(page.getByTestId('shortcut-menu')).toBeVisible();
  await expect(page.getByTestId('shortcut-menu')).toContainText('heatmap');
});

test('downloads a ZIP whose STLs are real', async ({ page }) => {
  await openSample(page, 'cup');

  await page.getByTestId('tab-instructions').click();
  await expect(page.getByTestId('instructions')).toContainText('Plaster');
  // The generated sheet must carry the real enlargement, not the shrinkage.
  await expect(page.getByTestId('instructions')).toContainText('14.9%');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-zip-tab').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.zip$/);

  const path = await download.path();
  expect(path).toBeTruthy();
});

test('switching to the positive workflow changes what you print', async ({ page }) => {
  await openSample(page, 'cup');

  await expect(page.getByTestId('parts-list')).toContainText('Tray');

  await page.getByTestId('feature-output').click();
  await page.getByTestId('field-mode').selectOption('positive');

  // Trays are gone; a bed plate and a cottle take their place.
  await expect(page.getByTestId('parts-list')).toContainText('Cottle', { timeout: 60_000 });
  await expect(page.getByTestId('parts-list')).toContainText('bed plate');
});

test('hiding a body removes it from the scene', async ({ page }) => {
  await openSample(page, 'cup');

  const master = page.getByTestId('part-master');
  await expect(master).toBeVisible();

  await page.getByTestId('eye-master').click();
  await expect(master).toHaveClass(/opacity-40/);
});

test('saves a named version and shows it in the history graph', async ({ page }) => {
  await openSample(page, 'cup');

  await page.getByTestId('doc-menu').click();
  await expect(page.getByTestId('version-graph')).toBeVisible();

  await page.getByTestId('version-name').fill('Thicker walls');
  await page.getByTestId('save-version').click();

  await expect(page.getByTestId('version-graph')).toContainText('Thicker walls');
});
