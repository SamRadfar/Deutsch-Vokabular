#!/usr/bin/env node
// Extract the read-only vocabulary baseline from the legacy index.html into
// tests/fixtures/baseline/. Existing fixtures are never overwritten unless
// --update is passed explicitly: the baseline is evidence, not a moving target.
//
//   node scripts/extract-baseline.mjs            # write fixtures if missing, else compare
//   node scripts/extract-baseline.mjs --update   # deliberately re-baseline (review the diff!)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readSource, extractData, extractBautechnikInfo, computeStats, listRows, sha256,
} from './lib/legacy-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'index.html');
const outDir = join(root, 'tests', 'fixtures', 'baseline');
const update = process.argv.includes('--update');

const src = readSource(sourcePath);
const data = extractData(src);
const info = extractBautechnikInfo(src);
const stats = computeStats(data, info);
const rows = listRows(data);

function git(...args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; }
}

const files = {
  'vocabulary.json': data,
  'bautechnik-info.json': info,
  'stats.json': stats,
  'progress-keys.json': rows.map(({ domIndex, progressKey, mainKey, tabId, groupIndex, rowIndex }) =>
    ({ domIndex, progressKey, mainKey, tabId, groupIndex, rowIndex })),
};

const meta = {
  description: 'Read-only baseline of the legacy single-file app. Do not edit by hand.',
  source: 'index.html',
  sourceCommit: git('log', '-1', '--format=%H', '--', 'index.html'),
  generator: 'scripts/extract-baseline.mjs',
  sha256: {
    vocabulary: sha256(data),
    bautechnikInfo: sha256(info),
  },
};

const outputs = { ...files, 'meta.json': meta };
const serialise = (v) => JSON.stringify(v, null, 2) + '\n';

mkdirSync(outDir, { recursive: true });
let differences = 0;
for (const [name, value] of Object.entries(outputs)) {
  const path = join(outDir, name);
  const next = serialise(value);
  const existed = existsSync(path);
  if (!existed || update) {
    writeFileSync(path, next);
    console.log(`${existed ? 'updated' : 'wrote'}  ${name}`);
    continue;
  }
  const current = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  if (current === next) console.log(`same   ${name}`);
  else { differences++; console.log(`DIFF   ${name}  (re-run with --update only if the change is intended)`); }
}

console.log(`\n${stats.totals.categories} categories, ${stats.totals.subtabs} subtabs, ${stats.totals.words} words`);
process.exitCode = differences ? 1 : 0;
