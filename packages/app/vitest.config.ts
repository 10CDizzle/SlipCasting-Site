import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only unit tests. Without this, vitest globs the Playwright specs in e2e/
    // and fails them -- they are written against a completely different runner.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
});
