import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app from /<repo>/, the self-host image serves it from
// the domain root. VITE_BASE lets one build script cover both.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/SlipCasting-Site/',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173, watch: { usePolling: true } },
  preview: { host: '0.0.0.0', port: 4173 },
  worker: { format: 'es' },
  optimizeDeps: {
    // Manifold and OpenCascade ship WASM; pre-bundling them mangles the loader.
    exclude: ['manifold-3d', 'occt-import-js'],
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
