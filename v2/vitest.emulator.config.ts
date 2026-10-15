import { defineConfig } from 'vitest/config';

// Tests that need the Firebase Emulator Suite (Firestore + Auth). Run through
// `npm run test:emulator`, which starts the emulators with the demo project
// "demo-deutsch-vokabular" (no real Firebase project is contacted).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/emulator/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
