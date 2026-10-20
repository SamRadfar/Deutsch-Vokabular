import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// A relative base ('./') makes the build work under any sub-path, including the
// future GitHub Pages location /Deutsch-Vokabular/…, without changing Pages now.
// Override with V2_BASE=/Deutsch-Vokabular/ for an absolute base if ever needed.
const base = process.env.V2_BASE ?? './';

// Tests must never pick up a developer's .env.local (it may point at a real Firebase project).
// Vitest and the Playwright builds (DV2_HERMETIC=1) load NO .env files; they only see explicitly
// set process variables (e.g. the emulator configuration).
const hermetic = !!process.env.VITEST || process.env.DV2_HERMETIC === '1';

// Production release build (scripts/build-production.mjs sets the variables): a public, indexable page
// with the product title. Every other build keeps the "preview, noindex" head.
const production = process.env.VITE_FIREBASE_ENV === 'production';
const productionHtml = {
  name: 'dv2-production-html',
  transformIndexHtml(html: string) {
    if (!production) return html;
    return html
      .replace(/\s*<meta name="robots" content="noindex" \/>/, '')
      .replace(/<title>[^<]*<\/title>/, '<title>Deutsch Vokabular · واژه‌نامهٔ تخصصی آلمانی</title>');
  },
};

// The on-device voice worker gets the ONNX Runtime WebAssembly binary as verified bytes
// (src/features/audio/voiceAssets.ts: downloaded once from a pinned CDN URL, SHA-256 checked).
// The bundled ORT build still references its 14 MB .wasm by URL; that file is never requested, so it
// is dropped from the output instead of being deployed and precached by the service worker.
const dropOrtWasm = {
  name: 'dv2-drop-ort-wasm',
  generateBundle(_options: unknown, bundle: Record<string, { fileName: string }>) {
    for (const [key, file] of Object.entries(bundle)) {
      if (/ort-wasm[^/]*\.wasm$/.test(file.fileName)) delete bundle[key];
    }
  },
};

export default defineConfig({
  base,
  ...(hermetic ? { envDir: false as const } : {}),
  plugins: [react(), productionHtml],
  worker: {
    format: 'es',
    plugins: () => [dropOrtWasm],
  },
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
    // Several component tests render the whole app (tables of up to 156 rows plus providers) in
    // jsdom; on Windows they take 2–4 s each, too close to the 5 s default. Assertions are unchanged.
    testTimeout: 15_000,
  },
});
