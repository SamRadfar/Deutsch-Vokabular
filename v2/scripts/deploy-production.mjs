#!/usr/bin/env node
// Guarded deployment to the PRODUCTION Firebase project (deutsch-vokabular) — product owner only.
//
//   npm run deploy:production -- --project deutsch-vokabular                 → dry run (checks + build, no cloud command)
//   npm run deploy:production -- --project deutsch-vokabular --confirm deutsch-vokabular [--only rules|hosting]
//
// Guards (scripts/lib/production.mjs, unit-tested):
//  - the target must be the approved production project; the legacy and dev projects are refused;
//  - rules: the emulator rules/sync security tests must pass, and a read-only probe must confirm the
//    (default) database exists (the CLI would otherwise create one in the default location);
//  - hosting: hermetic production build (deploy/production.env only), bundle scanned for secrets and
//    non-production endpoints, and a clean git working tree (the release must be reproducible);
//  - "--confirm <project-id>" double confirmation.
// Credentials: the owner's interactive `npx firebase login`; this script never handles tokens.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpretDatabaseProbe } from './lib/deploy-guard.mjs';
import { parseEnv, validateProductionDeployArgs } from './lib/production.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true }).status === 0;

const args = process.argv.slice(2);
const check = validateProductionDeployArgs(args);
if (!check.ok) fail(check.reason);
const { project, confirmed } = check;
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? args[onlyAt + 1] : 'all';
if (!['all', 'rules', 'hosting'].includes(only)) fail('--only must be rules or hosting');
const env = parseEnv(readFileSync(resolve(root, 'deploy/production.env'), 'utf8'));
if (env.VITE_FIREBASE_PROJECT_ID !== project) fail('deploy/production.env does not belong to the target project');
console.log(`• Target: ${project} (production) — ${only === 'all' ? 'rules + hosting' : only}${confirmed ? '' : ' — DRY RUN'}`);

if (only !== 'hosting') {
  console.log('• Firestore rules + sync security tests on the emulator (demo project, local only) …');
  if (!run('npm', ['run', 'test:emulator'])) fail('emulator tests failed — not deploying');
}
if (only !== 'rules') {
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (confirmed && dirty) fail('uncommitted changes — commit (and tag) the release before deploying hosting');
  if (!run('npm', ['run', 'build:production'])) fail('production build failed');
}

const message = `v${JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version}`;
const targets = only === 'all' ? 'firestore:rules,hosting' : only === 'rules' ? 'firestore:rules' : 'hosting';
const cmd = ['firebase', 'deploy', '--only', targets, '--project', project, '--non-interactive', '-m', `"${message}"`];
if (!confirmed) {
  console.log(`\n✔ Dry run OK — nothing was deployed.\n  To deploy: npm run deploy:production -- --project ${project} --confirm ${project}${only === 'all' ? '' : ` --only ${only}`}`);
  process.exit(0);
}

if (only !== 'hosting') {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/users/deploy-precheck-readonly?key=${encodeURIComponent(env.VITE_FIREBASE_API_KEY)}`);
  const body = await res.json().catch(() => ({}));
  const probe = interpretDatabaseProbe(res.status, body?.error?.status);
  if (!probe.exists) fail(probe.reason);
  console.log('• Firestore (default) database exists.');
}
console.log(`• Deploying ${targets} to ${project} …`);
process.exit(run('npx', cmd) ? 0 : 1);
