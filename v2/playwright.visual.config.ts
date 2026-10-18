import { defineConfig, devices } from '@playwright/test';
import { EMULATOR_ENV } from './playwright.emulator.config';

// Screenshots for the visual review (desktop 1440/1920, phones 390/430). Same hermetic emulator
// build as the emulator tests; run through `npm run screenshots` (starts the emulators first).
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:4174/', trace: 'off' },
  projects: [
    { name: '1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: '1920', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    { name: 'mobile-390', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'mobile-430', use: { ...devices['iPhone 14 Pro Max'], defaultBrowserType: 'chromium', viewport: { width: 430, height: 932 } } },
  ],
  webServer: {
    command: 'npx vite build --outDir dist-emulator --emptyOutDir && npx vite preview --outDir dist-emulator --port 4174 --strictPort',
    url: 'http://localhost:4174/',
    reuseExistingServer: false,
    timeout: 180_000,
    env: EMULATOR_ENV,
  },
});
