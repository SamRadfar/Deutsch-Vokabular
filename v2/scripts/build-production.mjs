#!/usr/bin/env node
// Production release build for Firebase Hosting (https://deutsch-vokabular.web.app).
//
//   npm run build:production      → v2/dist-production/
//
// Hermetic: only deploy/production.env (public web-app identifiers) is used — never .env.local or any
// other .env file (DV2_HERMETIC=1 disables Vite's env loading). Steps:
//   1. validate the production configuration (project allowlist, no emulators, no secrets, no
//      localhost/mock AI endpoint);
//   2. vite build with base "/", release version and build id;
//   3. remove source maps from the deployable output;
//   4. generate the service worker (precache of this release) and version.json;
//   5. scan every output file for secrets and non-production endpoints.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, scanBundle, validateProductionEnv } from './lib/production.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist-production');
const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };

const env = parseEnv(readFileSync(resolve(root, 'deploy/production.env'), 'utf8'));
const problems = validateProductionEnv(env);
if (problems.length) fail(`production configuration invalid:\n  - ${problems.join('\n  - ')}`);

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
const sha = git(['rev-parse', '--short=10', 'HEAD']) || 'unknown';
const dirty = git(['status', '--porcelain']) !== '';
const build = `${sha}${dirty ? '-dirty' : ''}`;
console.log(`• Building Deutsch Vokabular ${pkg.version} (${build}) for ${env.VITE_FIREBASE_PROJECT_ID}`);

const res = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-production', '--emptyOutDir'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ...env, DV2_HERMETIC: '1', V2_BASE: '/', VITE_APP_VERSION: pkg.version, VITE_APP_BUILD: build },
});
if (res.status !== 0) fail('vite build failed');

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
for (const f of walk(out)) if (f.endsWith('.map')) rmSync(f);

const files = walk(out).map((f) => `/${relative(out, f).replaceAll('\\', '/')}`).sort();
const precache = files.filter((f) => f !== '/index.html' && f !== '/version.json').concat('/index.html');
const swVersion = `${pkg.version}-${build}`;
const sw = readFileSync(resolve(root, 'scripts/sw.template.js'), 'utf8')
  .replace('__DV2_VERSION__', swVersion)
  .replace('__DV2_PRECACHE__', JSON.stringify(precache));
writeFileSync(join(out, 'sw.js'), sw);
writeFileSync(join(out, 'version.json'), `${JSON.stringify({ version: pkg.version, build, project: env.VITE_FIREBASE_PROJECT_ID, builtAt: new Date().toISOString() }, null, 2)}\n`);

const texts = walk(out).filter((f) => /\.(js|css|html|json|webmanifest|txt)$/.test(f))
  .map((f) => ({ file: relative(out, f).replaceAll('\\', '/'), text: readFileSync(f, 'utf8') }));
const findings = scanBundle(texts);
if (findings.length) fail(`forbidden content in the build:\n  - ${findings.join('\n  - ')}`);
const html = readFileSync(join(out, 'index.html'), 'utf8');
if (html.includes('noindex') || !html.includes('href="/assets/')) fail('index.html is not the production page (noindex present or base path is not "/")');

console.log(`✔ dist-production ready: ${precache.length} precached files, service worker ${swVersion}, no secrets or non-production endpoints found.`);
if (dirty) console.log('  (working tree has uncommitted changes — commit before a release deploy)');
