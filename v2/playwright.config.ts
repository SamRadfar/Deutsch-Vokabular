import { defineConfig, devices } from '@playwright/test';
import { EMULATOR_ENV } from './playwright.emulator.config';

// Browser tests against the production build (vite preview), configured for the Firebase Emulator
// Suite: the vocabulary exists only inside an account, so every test signs in an emulator account
// that owns the built-in library (tests/e2e/fixtures.ts). Run with `npm run test:e2e` (starts the
// emulators). No real Firebase project or Google account is involved.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: false,
    timeout: 180_000,
    env: EMULATOR_ENV,
  },
});
