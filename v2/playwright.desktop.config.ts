import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Real-desktop checks (headed Chrome and Edge on Windows): tests/desktop. Not part of CI.
// Run with `npm run test:desktop` (starts the Firebase emulators; no real Firebase project).
export default defineConfig({
  ...base,
  testDir: './tests/desktop',
  fullyParallel: false,
  workers: 1,
  // Behave like a normal browser: Playwright's defaults switch OFF background timer throttling and
  // backgrounding of hidden windows — exactly what a minimized window is subject to.
  projects: (['chrome', 'msedge'] as const).map((channel) => ({
    name: channel,
    use: {
      channel,
      headless: false,
      viewport: { width: 1280, height: 800 },
      launchOptions: {
        ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
      },
    },
  })),
});
