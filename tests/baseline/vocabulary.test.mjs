// Read-only regression checks for the built-in vocabulary of the legacy app.
// Expected values were extracted from index.html at commit 6763003 (see
// tests/fixtures/baseline/meta.json). They are evidence of the current state,
// including its data-quality issues (docs/DATA_QUALITY.md) — do not "fix" them here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractData, extractBautechnikInfo, computeStats, listRows, sha256 } from '../../scripts/lib/legacy-source.mjs';
import { fixture, legacySource } from '../helpers.mjs';

const src = legacySource();
const live = extractData(src);
const liveInfo = extractBautechnikInfo(src);
const liveStats = computeStats(live, liveInfo);

const baseline = fixture('baseline/vocabulary.json');
const baselineInfo = fixture('baseline/bautechnik-info.json');
const baselineStats = fixture('baseline/stats.json');
const meta = fixture('baseline/meta.json');

describe('baseline fixtures are intact', () => {
  test('vocabulary fixture matches its recorded fingerprint', () => {
    assert.equal(sha256(baseline), meta.sha256.vocabulary);
  });
  test('technical-info fixture matches its recorded fingerprint', () => {
    assert.equal(sha256(baselineInfo), meta.sha256.bautechnikInfo);
  });
});

describe('vocabulary content is unchanged', () => {
  test('exact text, fields and ordering (fingerprint over ordered JSON)', () => {
    assert.equal(sha256(live), meta.sha256.vocabulary);
  });
  test('deep equality with the baseline snapshot', () => {
    assert.deepStrictEqual(live, baseline);
  });
  test('row-by-row order matches the baseline progress-key list', () => {
    const expected = fixture('baseline/progress-keys.json').map((r) => r.progressKey);
    assert.deepStrictEqual(listRows(live).map((r) => r.progressKey), expected);
  });
  test('technical-info drawer data is unchanged', () => {
    assert.deepStrictEqual(liveInfo, baselineInfo);
  });
});

describe('totals', () => {
  test('7 categories in the original order', () => {
    assert.deepStrictEqual(Object.keys(live),
      ['arch', 'acad', 'bautechnik', 'bauphysik', 'fitness', 'anatomie', 'dreame']);
  });
  test('33 subtabs (4 of them empty), 115 groups, 999 words', () => {
    assert.equal(liveStats.totals.subtabs, 33);
    assert.deepStrictEqual(liveStats.totals.emptySubtabs,
      ['bauphysik/bo1', 'bauphysik/bo2', 'bauphysik/bo3', 'bauphysik/bo4']);
    assert.equal(liveStats.totals.groups, 115);
    assert.equal(liveStats.totals.words, 999);
  });
  test('words per subtab', () => {
    const perTab = Object.fromEntries(liveStats.categories.map((c) =>
      [c.mainKey, Object.fromEntries(c.tabs.map((t) => [t.id, t.words]))]));
    assert.deepStrictEqual(perTab, {
      arch: { bau: 156, zng: 29, tga: 21, fas: 17, plng: 26 },
      acad: { studio: 24, jury: 14, theorie: 25, modell: 20, software: 18, uni: 35 },
      bautechnik: { tragwerk: 35, baustoff: 38, baukonstruktion: 36, ausbau: 32, tga2: 32, bauausfuehrung: 30 },
      bauphysik: { bo1: 0, bo2: 0, bo3: 0, bo4: 0, bo5: 117 },
      fitness: { training: 66, ernaehrung: 41 },
      anatomie: { oberkoerper: 21, unterkoerper: 21, skelett: 40 },
      dreame: { saugroboter: 29, staubsauger: 16, nass: 11, mahroboter: 10, haartrockner: 11, allgemein: 28 },
    });
  });
  test('word-type distribution', () => {
    assert.deepStrictEqual(liveStats.typeCounts, { n: 817, au: 19, v: 111, a: 42, x: 10 });
  });
  test('stats fixture agrees with live computation', () => {
    assert.deepStrictEqual(liveStats, baselineStats);
  });
});

describe('structure is valid', () => {
  test('every category has label, theme and a non-empty tabs array', () => {
    for (const [key, section] of Object.entries(live)) {
      assert.equal(typeof section.label, 'string', key);
      assert.ok(section.label.trim(), key);
      assert.equal(section.theme, key, `${key}: theme mirrors the category key`);
      assert.ok(Array.isArray(section.tabs) && section.tabs.length > 0, key);
      assert.deepStrictEqual(Object.keys(section).sort(), ['label', 'tabs', 'theme'], key);
    }
  });
  test('every subtab has id, icon, label, fa and groups', () => {
    for (const [key, section] of Object.entries(live)) {
      for (const tab of section.tabs) {
        assert.deepStrictEqual(Object.keys(tab).sort(), ['fa', 'groups', 'icon', 'id', 'label'], `${key}/${tab.id}`);
        for (const f of ['id', 'icon', 'label', 'fa']) assert.equal(typeof tab[f], 'string', `${key}/${tab.id}.${f}`);
        assert.match(tab.id, /^[a-z0-9]+$/, `${key}/${tab.id}`);
        assert.ok(Array.isArray(tab.groups) && tab.groups.length > 0, `${key}/${tab.id}`);
      }
    }
  });
  test('subtab ids are unique (also across categories)', () => {
    const ids = Object.values(live).flatMap((s) => s.tabs.map((t) => t.id));
    assert.equal(new Set(ids).size, ids.length);
  });
  test('every group has a label and a rows array', () => {
    for (const section of Object.values(live)) {
      for (const tab of section.tabs) {
        for (const g of tab.groups) {
          assert.deepStrictEqual(Object.keys(g).sort(), ['label', 'rows']);
          assert.ok(g.label.trim());
          assert.ok(Array.isArray(g.rows));
        }
      }
    }
  });
  test('every row has exactly 6 non-empty, trimmed string fields', () => {
    for (const r of listRows(live)) {
      const row = live[r.mainKey].tabs[r.tabIndex].groups[r.groupIndex].rows[r.rowIndex];
      assert.equal(row.length, 6, r.progressKey);
      for (const field of row) {
        assert.equal(typeof field, 'string', r.progressKey);
        assert.ok(field.length > 0, `${r.progressKey}: empty field`);
        assert.equal(field, field.trim(), `${r.progressKey}: untrimmed field`);
      }
    }
  });
  test('word types are limited to the known set', () => {
    const types = new Set(listRows(live).map((r) => r.type));
    assert.deepStrictEqual([...types].sort(), ['a', 'au', 'n', 'v', 'x']);
  });
});

describe('identifiers', () => {
  test('words contain no HTML-sensitive characters, so progress keys equal mainKey::word', () => {
    // Legacy rowKey() reads textContent of an innerHTML-rendered cell.
    for (const r of listRows(live)) assert.doesNotMatch(r.word, /[<>&]/, r.progressKey);
  });
  test('known progress-key collisions (duplicate words inside one category) are exactly these', () => {
    // locations: <tabId>#<groupIndex>.<rowIndex>
    assert.deepStrictEqual(liveStats.progressKeyCollisions, [
      { key: 'acad::belegen', locations: ['theorie#2.3', 'uni#2.0'] },
      { key: 'acad::modellieren', locations: ['modell#2.0', 'software#2.0'] },
      { key: 'acad::rendern', locations: ['modell#2.3', 'software#2.3'] },
      { key: 'bautechnik::die Dreifachverglasung', locations: ['baustoff#3.2', 'baukonstruktion#3.7'] },
      { key: 'bauphysik::der Hebelarm', locations: ['bo5#0.14', 'bo5#0.53'] },
    ]);
    assert.equal(liveStats.totals.uniqueProgressKeys, 994);
  });
  test('37 words appear in more than one category', () => {
    assert.equal(liveStats.crossCategoryWords.length, 37);
  });
});

describe('technical info (BAUTECHNIK_INFO)', () => {
  test('31 entries, 17 reachable from the Bautechnik tables', () => {
    assert.equal(liveStats.bautechnikInfo.entries, 31);
    assert.equal(liveStats.bautechnikInfo.displayed, 17);
    assert.equal(liveStats.bautechnikInfo.neverDisplayed.length, 14);
  });
  test('every entry has a formula (object or null) and key/value rows', () => {
    for (const [word, entry] of Object.entries(liveInfo)) {
      assert.ok(entry.formula === null || (typeof entry.formula.lbl === 'string' && typeof entry.formula.val === 'string'), word);
      assert.ok(Array.isArray(entry.kv) && entry.kv.length > 0, word);
      for (const kv of entry.kv) assert.deepStrictEqual(Object.keys(kv).sort(), ['cls', 'key', 'val'], word);
    }
  });
});
