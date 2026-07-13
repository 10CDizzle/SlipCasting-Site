import { defineConfig, devices } from '@playwright/test';

/**
 * Headless end-to-end. No GUI, no browser window, no human.
 *
 * These run against the REAL built app -- the same static files GitHub Pages
 * serves -- so a green run means the whole thing works in a browser, WASM and all,
 * not merely that it compiled.
 */
export default defineConfig({
  testDir: './e2e',
  // The media capture drives the same flows; it is opt-in so a normal test run
  // does not spend a minute writing PNGs.
  testIgnore: process.env.CAPTURE ? [] : ['**/capture-media.spec.ts', '**/firstboot.spec.ts'],
  fullyParallel: false, // the geometry kernel is single-threaded; racing it just queues
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:4173/SlipCasting-Site/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173/SlipCasting-Site/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
