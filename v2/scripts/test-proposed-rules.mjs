#!/usr/bin/env node
// Runs the EXISTING Firestore rules tests against the PROPOSED rules file (Phase 5A), so the
// proposal is shown to keep every guarantee of the deployed rules. Emulator only — started by
// `npm run test:emulator:proposed` (demo project, no real Firebase project is contacted).
// Nothing is deployed: firebase.json and the deploy script only ever use firestore.rules.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.emulator.config.ts', 'tests/emulator/firestore.rules.test.ts'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, RULES_FILE: resolve(root, 'firestore.proposed.rules') },
});
process.exit(result.status ?? 1);
