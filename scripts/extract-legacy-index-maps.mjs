#!/usr/bin/env node
// Rebuild the index → progress-key maps for every historical version of index.html
// that persisted progress under the legacy `dvok5` key.
//
// dvok5 stored `{ "<i>": boolean }` for the i-th `.vchk` checkbox in DOM order, so the
// meaning of an index depends on the DATA of the version that wrote it. Because those
// versions wrote one entry per checkbox, the number of entries identifies the version.
//
// Requires full git history. Writes tests/fixtures/legacy/dvok5-index-maps.json
// (never overwrites without --update).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseEol, extractData, listRows, sha256 } from './lib/legacy-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'tests', 'fixtures', 'legacy', 'dvok5-index-maps.json');

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] });

export function buildDvok5Maps() {
  const commits = git('rev-list', '--reverse', 'HEAD', '--', 'index.html').trim().split('\n');
  const versions = [];
  for (const commit of commits) {
    let src;
    try { src = normaliseEol(git('show', `${commit}:index.html`)); } catch { continue; } // deleted in that commit
    if (!src.includes("setItem('dvok5'")) continue;
    const data = extractData(src);
    const keys = listRows(data).map((r) => r.progressKey);
    versions.push({
      commit,
      date: git('log', '-1', '--format=%cI', commit).trim(),
      checkboxCount: keys.length,
      dataSha256: sha256(data),
      keys,
    });
  }
  // Collapse versions with identical vocabulary: their index maps are interchangeable.
  const byData = new Map();
  for (const v of versions) {
    if (!byData.has(v.dataSha256)) byData.set(v.dataSha256, { ...v, commits: [] });
    byData.get(v.dataSha256).commits.push(v.commit);
  }
  return [...byData.values()].map(({ commit, ...rest }) => rest);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const maps = buildDvok5Maps();
  const doc = {
    description: 'Index maps for legacy dvok5 progress. Each entry: keys[i] is the dvok6-style progress key of checkbox i.',
    generator: 'scripts/extract-legacy-index-maps.mjs',
    versions: maps,
  };
  if (existsSync(outPath) && !process.argv.includes('--update')) {
    console.log('exists, not overwritten (use --update):', outPath);
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
    console.log('wrote', outPath);
  }
  for (const v of maps) console.log(`${v.checkboxCount} checkboxes  data=${v.dataSha256.slice(0, 12)}  commits=${v.commits.map((c) => c.slice(0, 7)).join(',')}`);
}
