#!/usr/bin/env node
// Guarded deployment of v2/firestore.rules to the v2 DEVELOPMENT Firebase project.
//
//   npm run rules:deploy:dev -- --project deutsch-vokabular-v2-dev
//       → dry run: target checks + emulator rules tests. NO Firebase CLI cloud command is run.
//   npm run rules:deploy:dev -- --project deutsch-vokabular-v2-dev --confirm deutsch-vokabular-v2-dev
//       → deploys (product owner only, after approval).
//
// Guards (scripts/lib/deploy-guard.mjs, unit-tested):
//  - exact allowlist of target projects; the legacy production project is refused;
//  - --project must match VITE_FIREBASE_PROJECT_ID in v2/.env.local;
//  - emulator rules tests must pass;
//  - before deploying, a read-only probe confirms the (default) database exists, because the
//    Firebase CLI would otherwise CREATE a database (default location nam5/US) during deploy;
//  - deployment needs "--confirm <project-id>" (double confirmation).
// Credentials: the owner runs `npx firebase login` interactively; this script never handles tokens.
// There is deliberately no .firebaserc default project.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpretDatabaseProbe, validateDeployArgs } from './lib/deploy-guard.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function readEnvLocal() {
  const file = resolve(root, '.env.local');
  if (!existsSync(file)) return null;
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
  }
  return env;
}

const envLocal = readEnvLocal();
const check = validateDeployArgs(process.argv.slice(2), envLocal ? (envLocal.VITE_FIREBASE_PROJECT_ID ?? '') : null);
if (!check.ok) fail(check.reason);
const { project, confirmed } = check;
console.log(`• Target project: ${project} (allowlisted${envLocal ? ', matches v2/.env.local' : ''})`);

console.log('• Running the Firestore rules + sync security tests on the emulator (demo project, local only) …');
const test = spawnSync('npm', ['run', 'test:emulator'], { cwd: root, stdio: 'inherit', shell: true });
if (test.status !== 0) fail('emulator tests failed — not deploying');

const cmd = ['firebase', 'deploy', '--only', 'firestore:rules', '--project', project, '--non-interactive'];
if (!confirmed) {
  console.log('\n✔ Dry run OK — no Firebase CLI cloud command was executed.');
  console.log(`  After explicit approval the owner runs:\n    npm run rules:deploy:dev -- --project ${project} --confirm ${project}`);
  console.log(`  which executes (after a read-only database check):\n    npx ${cmd.join(' ')}`);
  process.exit(0);
}

// Read-only probe: refuse if the (default) database does not exist.
const key = envLocal?.VITE_FIREBASE_API_KEY;
if (!key) fail('VITE_FIREBASE_API_KEY missing in v2/.env.local (needed for the read-only database check)');
const res = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/users/deploy-precheck-readonly?key=${encodeURIComponent(key)}`);
const body = await res.json().catch(() => ({}));
const probe = interpretDatabaseProbe(res.status, body?.error?.status);
if (!probe.exists) fail(probe.reason);
console.log('• Firestore (default) database exists.');

console.log(`• Deploying rules to ${project} …`);
const deploy = spawnSync('npx', cmd, { cwd: root, stdio: 'inherit', shell: true });
process.exit(deploy.status ?? 1);
