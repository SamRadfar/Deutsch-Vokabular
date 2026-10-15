#!/usr/bin/env node
// Guarded deployment of v2/firestore.rules to the v2 DEVELOPMENT Firebase project.
//
//   node scripts/deploy-rules.mjs --project <dev-project-id>            # dry run: checks only
//   node scripts/deploy-rules.mjs --project <dev-project-id> --confirm  # deploys (owner only)
//
// Refuses: the legacy production project, demo-/non-"-dev" project ids, and any run whose
// emulator rules tests fail. Requires `firebase login` by the product owner; this script
// never handles credentials. There is deliberately no .firebaserc default project.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN = ['deutsch-wortschatz-c7a11']; // legacy app (index.html firebaseConfig)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const project = args[args.indexOf('--project') + 1];
const confirm = args.includes('--confirm');

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

if (!args.includes('--project') || !project || project.startsWith('--')) fail('missing --project <dev-project-id>');
if (FORBIDDEN.includes(project)) fail(`"${project}" is the legacy production project — v2 rules must never be deployed there`);
if (project.startsWith('demo-')) fail('"demo-" projects exist only in the emulator');
if (!/(^|-)dev(-|$)/.test(project)) fail(`"${project}" is not marked as a development project (expected "-dev" in the id)`);

console.log('• Running the Firestore rules tests on the emulator first …');
const test = spawnSync('npm', ['run', 'test:emulator'], { cwd: root, stdio: 'inherit', shell: true });
if (test.status !== 0) fail('rules tests failed — not deploying');

const cmd = ['firebase', 'deploy', '--only', 'firestore:rules', '--project', project];
if (!confirm) {
  console.log(`\nDry run OK. To deploy, the product owner runs:\n  npx ${cmd.join(' ')}\nor re-runs this script with --confirm.`);
  process.exit(0);
}
console.log(`• Deploying rules to ${project} …`);
const deploy = spawnSync('npx', cmd, { cwd: root, stdio: 'inherit', shell: true });
process.exit(deploy.status ?? 1);
