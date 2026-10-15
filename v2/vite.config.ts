import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// A relative base ('./') makes the build work under any sub-path, including the
// future GitHub Pages location /Deutsch-Vokabular/…, without changing Pages now.
// Override with V2_BASE=/Deutsch-Vokabular/ for an absolute base if ever needed.
const base = process.env.V2_BASE ?? './';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // Content and framework change at different rates than app code: separate chunks
        // keep browser caches valid across app-only or content-only releases.
        codeSplitting: {
          groups: [
            // Only the browsable content; the id registry is loaded with the migration dialog.
            { name: 'vocabulary-content', test: /[\\/]src[\\/]data[\\/]vocabulary[\\/](vocabulary|technical-info)\.v\d+\.json/ },
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'firebase', test: /[\\/]node_modules[\\/](@firebase|firebase)[\\/]/ },
          ],
        },
      },
    },
    // Firebase (≈ 735 kB minified, ≈ 217 kB gzip) is loaded asynchronously and never blocks
    // vocabulary rendering; the content chunk is ≈ 315 kB. Warn only above these sizes.
    chunkSizeWarningLimit: 760,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
