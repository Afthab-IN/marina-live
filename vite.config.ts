import { defineConfig } from 'vite';

// base './' keeps every URL relative, so the same build works at the root of a
// Vercel domain and under /marina-live/ on GitHub Pages.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
  server: { host: '::' },
});
