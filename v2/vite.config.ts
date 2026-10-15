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
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
