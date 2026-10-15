import { defineConfig, devices } from '@playwright/test';

// Browser tests against a build configured for the Firebase Emulator Suite (Auth + Firestore,
// demo project, no real Google account). Run through `npm run test:e2e:emulator`, which starts
// the emulators first. The Auth Emulator's sign-in popup is a stand-in: these tests do NOT
// verify real Google OAuth.
export const EMULATOR_ENV = {
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-deutsch-vokabular.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-deutsch-vokabular',
  VITE_FIREBASE_APP_ID: 'demo-app',
  VITE_FIREBASE_USE_EMULATORS: 'true',
};

export default defineConfig({
  testDir: './tests/e2e-emulator',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  globalSetup: './tests/e2e-emulator/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4174/',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npx vite build --outDir dist-emulator --emptyOutDir && npx vite preview --outDir dist-emulator --port 4174 --strictPort',
    url: 'http://localhost:4174/',
    reuseExistingServer: false,
    timeout: 180_000,
    env: EMULATOR_ENV,
  },
});
