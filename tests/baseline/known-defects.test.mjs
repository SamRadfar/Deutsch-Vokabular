// Known defects of the legacy app, recorded as `todo` tests: they report their status on
// every run without failing the suite. When a defect is fixed (Phase 2+), turn the test
// into a regular test so the fix cannot regress. Details: docs/DATA_QUALITY.md and
// the Phase 0 analysis report.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractData, listRows, findObjectLiteral, evaluateLiteral } from '../../scripts/lib/legacy-source.mjs';
import { legacySource, repoFile, root } from '../helpers.mjs';

const src = legacySource();

test('every file pre-cached by sw.js exists (icon.png is missing → SW install fails)', { todo: 'V1' }, () => {
  const list = repoFile('sw.js').match(/const FILES = \[([\s\S]*?)\]/)[1];
  const files = [...list.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
  const missing = files.filter((f) => !existsSync(join(root, f)));
  assert.deepStrictEqual(missing, []);
});

test('every manifest icon exists', { todo: 'V1' }, () => {
  const manifest = JSON.parse(repoFile('manifest.json'));
  const missing = [...new Set(manifest.icons.map((i) => i.src))].filter((f) => !existsSync(join(root, f)));
  assert.deepStrictEqual(missing, []);
});

test('every inline event handler calls a defined function', { todo: 'V2, V11' }, () => {
  const names = new Set([...src.matchAll(/on(?:click|change|input)="(?:event\.stopPropagation\(\);)?([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]));
  const undefinedHandlers = [...names].filter((n) => !new RegExp(`function\\s+${n}\\s*\\(`).test(src));
  assert.deepStrictEqual(undefinedHandlers, []);
});

test('static element ids are unique', { todo: 'V11' }, () => {
  const ids = [...src.matchAll(/\bid="([^"$]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))], []);
});

test('every word type used in DATA has a badge in TYPE_MAP', { todo: 'V8' }, () => {
  const used = new Set(listRows(extractData(src)).map((r) => r.type));
  const typeMap = evaluateLiteral(findObjectLiteral(src, 'TYPE_MAP'));
  assert.deepStrictEqual([...used].filter((t) => !(t in typeMap)), []);
});

test('progress keys are unique (no duplicate word inside a category)', { todo: 'V7' }, () => {
  const keys = listRows(extractData(src)).map((r) => r.progressKey);
  assert.equal(new Set(keys).size, keys.length);
});
