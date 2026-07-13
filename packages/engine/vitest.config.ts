import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Manifold's WASM module is instantiated once per worker; booleans on the
    // heavier fixtures are seconds, not milliseconds.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'threads',
  },
});
