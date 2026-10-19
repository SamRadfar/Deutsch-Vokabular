import { describe, expect, it } from 'vitest';
import {
  planMigration, previewMigration, readLegacySnapshot, verifyDvok5MapsUnambiguous, type ReadonlyStorage,
} from '../../../src/features/progress/migration';
import { buildLegacyKeyIndex, buildWordTextIndex } from '../../../src/services/content/idRegistry';
import { phase1Fixture } from '../../helpers/phase1';
import { FAKE_API_KEY, customWord, dvok5, dvok6, snapshot } from './legacy-snapshots';
import { bundledIdRegistry as idRegistry, bundledDvok5Maps as dvok5Maps, bundledMigrationContext as defaultMigrationContext } from '../../../src/services/content/bundled';

const ctx = defaultMigrationContext();

const keyIndex = buildLegacyKeyIndex(idRegistry);
const idsOf = (key: string) => [...keyIndex.get(key)!];

describe('dvok6 (word-based progress)', () => {
  it('maps legacy keys to the matching entry ids', () => {
    const plan = planMigration(snapshot({ dvok6: dvok6('arch::die Außenwand', 'dreame::die Testnote') }), ctx);
    expect(plan.learned.map((m) => m.id)).toEqual([...idsOf('arch::die Außenwand'), ...idsOf('dreame::die Testnote')]);
    expect(plan.learned.every((m) => m.sources.join() === 'dvok6' && !m.ambiguous)).toBe(true);
    expect(previewMigration(plan, ctx).safeToMigrate).toBe(true);
  });

  it('handles a colliding key explicitly: both entries marked, mapping reported as ambiguous', () => {
    const plan = planMigration(snapshot({ dvok6: dvok6('bauphysik::der Hebelarm') }), ctx);
    const ids = idsOf('bauphysik::der Hebelarm');
    expect(ids).toHaveLength(2);
    expect(plan.learned.map((m) => m.id)).toEqual(ids);
    expect(plan.learned.every((m) => m.ambiguous)).toBe(true);
    expect(plan.ambiguous).toEqual([{ legacyKey: 'bauphysik::der Hebelarm', source: 'dvok6', candidateIds: ids, resolution: 'apply-to-all-candidates' }]);
    expect(plan.issues.map((i) => i.code)).toContain('AMBIGUOUS_LEGACY_KEY');
  });

  it('archives ticks of removed words as orphans with relocation candidates, never applying them', () => {
    // der U-Wert was in bautechnik until 6763003; the same text exists in another category now.
    const plan = planMigration(snapshot({ dvok6: dvok6('bautechnik::der U-Wert', 'bautechnik::der Wärmeschutz') }), ctx);
    expect(plan.learned).toEqual([]);
    expect(plan.orphans.map((o) => o.legacyKey)).toEqual(['bautechnik::der U-Wert', 'bautechnik::der Wärmeschutz']);
    expect(plan.orphans[0]!.relocationCandidates).toEqual(buildWordTextIndex(idRegistry).get('der U-Wert'));
    expect(plan.orphans[0]!.relocationCandidates.length).toBeGreaterThan(0);
    expect(plan.orphans[1]!.relocationCandidates).toEqual([]);
    const preview = previewMigration(plan, ctx);
    expect(preview.safeToMigrate).toBe(false);
    expect(preview.potentialDataLoss).toEqual([expect.objectContaining({ code: 'ORPHANED_PROGRESS', count: 2 })]);
  });

  it('reports malformed JSON as a data-loss risk and still processes other keys', () => {
    const plan = planMigration(snapshot({ dvok6: '{broken', dvok_theme: 'dark' }), ctx);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: 'DVOK6_INVALID', severity: 'data-loss-risk' }));
    expect(plan.theme).toBe('dark');
  });

  it('mirrors legacy truthiness and warns about non-boolean values', () => {
    const plan = planMigration(snapshot({ dvok6: JSON.stringify({ 'arch::die Außenwand': 1, 'arch::die Innenwand': false }) }), ctx);
    expect(plan.learned.map((m) => m.legacyKeys[0])).toEqual(['arch::die Außenwand']);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: 'DVOK6_VALUE' }));
  });
});

describe('dvok5 (index-based legacy progress)', () => {
  it('historical maps are unambiguous: distinct checkbox counts, one vocabulary each', () => {
    expect(verifyDvok5MapsUnambiguous(dvok5Maps)).toEqual([]);
    expect(dvok5Maps.versions.map((v) => v.checkboxCount)).toEqual([490, 733, 822]);
    // Every commit that ever wrote dvok5 is covered (Phase 1 history scan).
    expect(dvok5Maps.versions.flatMap((v) => v.commits)).toHaveLength(5);
  });

  it('equals the Phase 1 fixture', () => {
    const phase1 = phase1Fixture<{ versions: Array<{ checkboxCount: number; keys: string[]; commits: string[] }> }>('legacy/dvok5-index-maps.json');
    expect(dvok5Maps.versions.map((v) => v.keys)).toEqual(phase1.versions.map((v) => v.keys));
  });

  it('refuses to guess when two vocabularies would share a checkbox count', () => {
    const [a, b] = dvok5Maps.versions;
    const broken = { versions: [a!, { ...b!, checkboxCount: a!.checkboxCount, keys: b!.keys.slice(0, a!.checkboxCount) }] };
    expect(verifyDvok5MapsUnambiguous(broken)).toHaveLength(1);
    const ctx = { ...defaultMigrationContext(), dvok5Maps: broken };
    const plan = planMigration(snapshot({ dvok5: dvok5(a!.checkboxCount, [0]) }), ctx);
    expect(plan.dvok5).toMatchObject({ status: 'unrecognized' });
    expect(plan.learned).toEqual([]);
  });

  for (const count of [490, 733, 822]) {
    it(`identifies the ${count}-checkbox version and maps index → key → id`, () => {
      const map = dvok5Maps.versions.find((v) => v.checkboxCount === count)!;
      const plan = planMigration(snapshot({ dvok5: dvok5(count, [0, 5]) }), ctx);
      expect(plan.dvok5).toEqual({ status: 'imported', checkboxCount: count, checkedCount: 2, matchedCommits: map.commits });
      const expected = [...idsOf(map.keys[0]!), ...idsOf(map.keys[5]!)];
      expect(plan.learned.map((m) => m.id).sort()).toEqual(expected.sort());
      expect(plan.learned.every((m) => m.sources.join() === 'dvok5')).toBe(true);
    });
  }

  it('archives dvok5 ticks of the removed subtab (index 490 in the 822 version) as orphans', () => {
    const plan = planMigration(snapshot({ dvok5: dvok5(822, [490]) }), ctx);
    expect(plan.orphans).toEqual([{ legacyKey: 'bautechnik::der Wärmeschutz', source: 'dvok5', relocationCandidates: [] }]);
  });

  it('does not merge dvok5 automatically when dvok6 already has ticks', () => {
    const plan = planMigration(snapshot({ dvok5: dvok5(822, [1, 2, 3]), dvok6: dvok6('arch::die Außenwand') }), ctx);
    expect(plan.dvok5).toMatchObject({ status: 'deferred-dvok6-has-checks', checkedCount: 3 });
    expect(plan.learned.map((m) => m.id)).toEqual(idsOf('arch::die Außenwand'));
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: 'DVOK5_DEFERRED', severity: 'warning' }));
  });

  it('flags unknown sizes, gaps and malformed blobs; no ticks → no-checks', () => {
    expect(planMigration(snapshot({ dvok5: dvok5(500, [1]) }), ctx).dvok5).toMatchObject({ status: 'unrecognized', entryCount: 500 });
    expect(planMigration(snapshot({ dvok5: JSON.stringify({ 0: true, 2: false }) }), ctx).dvok5).toMatchObject({ status: 'unrecognized', reason: 'indexes are not 0..n-1' });
    expect(planMigration(snapshot({ dvok5: '[' }), ctx).dvok5).toMatchObject({ status: 'invalid' });
    expect(planMigration(snapshot({ dvok5: dvok5(733) }), ctx).dvok5).toEqual({ status: 'no-checks', checkboxCount: 733 });
    const unknown = previewMigration(planMigration(snapshot({ dvok5: dvok5(500, [1]) }), ctx), ctx);
    expect(unknown.potentialDataLoss).toContainEqual(expect.objectContaining({ code: 'DVOK5_UNRECOGNIZED' }));
  });
});

describe('custom words, settings and other keys', () => {
  it('keeps custom words verbatim (including HTML-like text) and buckets missing placements', () => {
    const words = [
      customWord({ id: 'cw1', word: '<img src=x onerror=alert(1)>', checked: true }),
      customWord({ id: 'cw2', main: 'bautechnik', tab: 'bauphysik', status: 'pending' }),
      { broken: true },
    ];
    const plan = planMigration(snapshot({ dvok5_custom: JSON.stringify(words) }), ctx);
    expect(plan.customWords.map((w) => w.legacy.word)).toEqual(['<img src=x onerror=alert(1)>', 'die Nachhaltigkeit']);
    expect(plan.customWords.map((w) => w.placement)).toEqual([{ category: 'arch', subtab: 'bau' }, null]);
    expect(plan.invalidCustomWordCount).toBe(1);
    expect(previewMigration(plan, ctx).customWords).toEqual({ total: 2, unsorted: 1, invalid: 1, checked: 1, pending: 1 });
  });

  it('validates pronunciation settings and falls back per field', () => {
    const plan = planMigration(snapshot({ dvok5_pron_settings: JSON.stringify({ repeat: 'once', pause: 99, rate: 0.55, shadow: 'yes' }) }), ctx);
    expect(plan.pronunciation).toEqual({ repeat: 'once', pauseSeconds: 4, rate: 0.55, shadowing: false });
    expect(plan.issues.filter((i) => i.code === 'PRON_VALUE')).toHaveLength(2);
  });

  it('keeps exposure by word text and selected categories filtered to known keys', () => {
    const plan = planMigration(snapshot({
      dvok5_pron_exposure: JSON.stringify({ 'die Außenwand': 3, 'ein eigenes Wort': 1, bad: -2 }),
      dvok5_pron_selected_tabs: JSON.stringify(['arch', 'gone']),
      dvok_sync_code: '123456',
    }), ctx);
    expect(plan.exposureByText).toEqual({ 'die Außenwand': 3, 'ein eigenes Wort': 1 });
    expect(previewMigration(plan, ctx).exposure).toEqual({ words: 2, matchingBuiltInEntries: 1, withoutBuiltInEntry: 1 });
    expect(plan.selectedCategories).toEqual({ kept: ['arch'], dropped: ['gone'] });
    expect(plan.syncCode).toEqual({ present: true, valid: true });
  });

  it('empty storage produces an empty, safe plan', () => {
    const preview = previewMigration(planMigration(snapshot(), ctx), ctx);
    expect(preview).toMatchObject({ learnedEntries: 0, orphanedKeys: 0, dvok5: 'absent', safeToMigrate: true });
  });

  it('is deterministic', () => {
    const s = snapshot({ dvok6: dvok6('acad::rendern', 'arch::die Außenwand'), dvok5: dvok5(490, [3]) });
    expect(planMigration(s, ctx)).toEqual(planMigration(s, ctx));
  });
});

describe('API key and read-only storage access', () => {
  function fakeStorage(items: Record<string, string>): ReadonlyStorage & { reads: string[] } {
    const keys = Object.keys(items);
    const reads: string[] = [];
    const target = {
      reads,
      get length() { return keys.length; },
      key: (i: number) => keys[i] ?? null,
      getItem: (k: string) => {
        if (k === 'dvok5_apikey') throw new Error('the API key value must never be read');
        reads.push(k);
        return items[k] ?? null;
      },
      setItem: () => { throw new Error('write attempted'); },
      removeItem: () => { throw new Error('write attempted'); },
      clear: () => { throw new Error('write attempted'); },
    };
    return target;
  }

  it('detects the API key by name only and never copies its value', () => {
    const storage = fakeStorage({ dvok6: dvok6('arch::die Außenwand'), dvok5_apikey: FAKE_API_KEY });
    const snap = readLegacySnapshot(storage);
    expect(snap.dvok5_apikey_present).toBe(true);
    expect(storage.reads).not.toContain('dvok5_apikey');
    const plan = planMigration(snap, ctx);
    expect(plan.apiKey).toEqual({ present: true, migrated: false });
    expect(JSON.stringify(plan)).not.toContain(FAKE_API_KEY);
    expect(JSON.stringify(previewMigration(plan, ctx))).not.toContain(FAKE_API_KEY);
  });

  it('reads only the documented legacy keys and never writes', () => {
    const storage = fakeStorage({ dvok_theme: 'light', unrelated: 'x' });
    readLegacySnapshot(storage);
    expect(storage.reads.sort()).toEqual([
      'dvok5', 'dvok5_custom', 'dvok5_pron_exposure', 'dvok5_pron_selected_tabs', 'dvok5_pron_settings', 'dvok6', 'dvok_sync_code', 'dvok_theme',
    ]);
  });
});

