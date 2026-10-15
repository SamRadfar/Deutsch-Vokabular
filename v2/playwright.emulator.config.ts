import { defineConfig, devices } from '@playwright/test';

// Browser tests against a build configured for the Firebase Emulator Suite (Auth + Firestore,
// demo project, no real Google account). Run through `npm run test:e2e:emulator`, which starts
// the emulators first. The Auth Emulator's sign-in popup is a stand-in: these tests do NOT
// verify real Google OAuth.
export const EMULATOR_ENV = {
  VITE_FIREBASE_ENV: 'emulator',
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-deutsch-vokabular.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-deutsch-vokabular',
  VITE_FIREBASE_APP_ID: 'demo-app',
  VITE_FIREBASE_USE_EMULATORS: 'true',
  VITE_FIREBASE_EMULATOR_HOST: process.env.E2E_EMULATOR_HOST ?? '127.0.0.1',
};

export default defineConfig({
  testDir: './tests/e2e-emulator',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  // After sign-in the app waits up to 5 s (by design) for the first server snapshot before it
  // shows progress from local data; on a cold emulator that wait can be used fully. Assertions
  // therefore get more than the 5 s Playwright default.
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:4174/',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    // Opt-in cross-browser run: E2E_BROWSERS=all npm run test:e2e:emulator
    // (Edge uses the installed browser; WebKit on Windows/Linux approximates Safari, it is not Safari.)
    ...(process.env.E2E_BROWSERS === 'all'
      ? [
          { name: 'desktop-edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
          { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] } },
          { name: 'mobile-webkit-iphone', use: { ...devices['iPhone 13'] } },
        ]
      : []),
  ],
  webServer: {
    command: 'npx vite build --outDir dist-emulator --emptyOutDir && npx vite preview --outDir dist-emulator --port 4174 --strictPort',
    url: 'http://localhost:4174/',
    reuseExistingServer: false,
    timeout: 180_000,
    env: EMULATOR_ENV,
  },
});
