// Static checks that the legacy persistence contract (docs/DATA_CONTRACTS.md) is still what
// the migration specification assumes. These tests read source text and fixtures only;
// they never touch a browser, localStorage or Firestore.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { findObjectLiteral, evaluateLiteral, LEGACY_TYPE_KEYS } from '../../scripts/lib/legacy-source.mjs';
import { fixture, legacySource, root } from '../helpers.mjs';

const src = legacySource();

describe('localStorage keys used by the legacy app', () => {
  const literals = {
    dvok6: "'dvok6'",
    dvok5: "'dvok5'",
    dvok5_custom: "'dvok5_custom'",
    dvok5_pron_settings: "'dvok5_pron_settings'",
    dvok5_pron_exposure: "'dvok5_pron_exposure'",
    dvok5_pron_selected_tabs: "'dvok5_pron_selected_tabs'",
    dvok_sync_code: "'dvok_sync_code'",
    dvok_theme: "'dvok_theme'",
    dvok5_apikey: "'dvok5_apikey'",
  };
  for (const [key, literal] of Object.entries(literals)) {
    test(`${key} is referenced`, () => assert.ok(src.includes(literal), `${literal} not found in index.html`));
  }
});

test('LEGACY_TYPE_KEYS in scripts/lib mirrors TYPE_MAP in index.html', () => {
  assert.deepStrictEqual(Object.keys(evaluateLiteral(findObjectLiteral(src, 'TYPE_MAP'))), LEGACY_TYPE_KEYS);
});

describe('progress identity', () => {
  test("rowKey() is mainKey + '::' + trimmed word-cell text", () => {
    assert.ok(src.includes("return mainKey + '::' + (wrd ? wrd.textContent.trim() : '');"));
  });
  test('save() stores only checked built-in rows as { key: true }', () => {
    assert.match(src, /document\.querySelectorAll\('\.vchk:not\(\.cchk\)'\)[\s\S]{0,200}if \(c\.checked\) s\[key\] = true;/);
    assert.ok(src.includes("localStorage.setItem('dvok6', JSON.stringify(s))"));
  });
  test('custom words keep their own checked flag (class cchk)', () => {
    assert.ok(src.includes('cwUpdate(row.dataset.cwid, { checked: e.target.checked })'));
  });
  test('progress-key fixture: 999 rows, sequential DOM indexes, 994 unique keys', () => {
    const rows = fixture('baseline/progress-keys.json');
    assert.equal(rows.length, 999);
    rows.forEach((r, i) => assert.equal(r.domIndex, i));
    assert.equal(new Set(rows.map((r) => r.progressKey)).size, 994);
  });
});

describe('Firestore sync contract', () => {
  test("collection 'syncCodes', document id = 6-digit code", () => {
    assert.ok(src.includes("db.collection('syncCodes').doc(code)"));
    assert.ok(src.includes('String(Math.floor(100000 + Math.random() * 900000))'));
  });
  test('payload is { checked, custom, pron } plus server timestamp', () => {
    assert.ok(src.includes('return { checked, custom, pron };'));
    assert.ok(src.includes('updatedAt: firebase.firestore.FieldValue.serverTimestamp()'));
  });
  test('exposure, selected tabs, theme and API key are not part of the sync payload', () => {
    const collect = src.slice(src.indexOf('function syncCollectLocalData'), src.indexOf('function syncApplyRemoteData'));
    for (const k of ['dvok5_pron_exposure', 'dvok5_pron_selected_tabs', 'dvok_theme', 'dvok5_apikey']) {
      assert.ok(!collect.includes(k), k);
    }
  });
});

describe('legacy dvok5 index maps', () => {
  const maps = fixture('legacy/dvok5-index-maps.json').versions;

  test('one map per distinct historical vocabulary', () => {
    assert.deepStrictEqual(maps.map((v) => v.checkboxCount), [490, 733, 822]);
  });
  test('checkbox counts are distinct, so a dvok5 blob identifies its version by size', () => {
    const counts = maps.map((v) => v.checkboxCount);
    assert.equal(new Set(counts).size, counts.length);
  });
  test('each map lists exactly checkboxCount keys', () => {
    for (const v of maps) assert.equal(v.keys.length, v.checkboxCount, v.dataSha256);
  });

  let history = false;
  try {
    execFileSync('git', ['cat-file', '-e', 'b45ca12^{commit}'], { cwd: root, stdio: 'ignore' });
    history = true;
  } catch { /* shallow clone or no git */ }

  test('maps can be rebuilt from git history', { skip: history ? false : 'git history not available' }, async () => {
    const { buildDvok5Maps } = await import('../../scripts/extract-legacy-index-maps.mjs');
    assert.deepStrictEqual(buildDvok5Maps(), maps);
  });
});
