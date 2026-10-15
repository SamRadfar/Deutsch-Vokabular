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
            { name: 'vocabulary-content', test: /[\\/]src[\\/]data[\\/]vocabulary[\\/]/ },
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
    // The content chunk is ~315 kB minified (≈ 90 kB gzip) by nature; warn only above that.
    chunkSizeWarningLimit: 450,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
