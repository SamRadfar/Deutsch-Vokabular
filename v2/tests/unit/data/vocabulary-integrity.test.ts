// Proves that v2 content preserves the legacy vocabulary exactly, by converting it back to
// the legacy shape and comparing it with the Phase 1 baseline fixtures (never edited).

import { describe, expect, it } from 'vitest';
import { getBundledRepository as getVocabularyRepository } from '../../../src/services/content/bundled';
import { toLegacyData, toLegacyTechnicalInfo } from '../../../src/services/content/legacyFormat';
import { validateTechnicalInfoDataset, validateVocabularyDataset } from '../../../src/services/content/validate';
import rawTechnicalInfo from '../../../src/data/vocabulary/technical-info.v1.json';
import rawVocabulary from '../../../src/data/vocabulary/vocabulary.v1.json';
import { phase1Fixture, sha256Json, type Phase1Meta, type Phase1Stats } from '../../helpers/phase1';

const repo = getVocabularyRepository();
const meta = phase1Fixture<Phase1Meta>('baseline/meta.json');
const stats = phase1Fixture<Phase1Stats>('baseline/stats.json');
const allEntries = repo.categories.flatMap((c) => c.subtabs.flatMap((s) => s.groups.flatMap((g) => g.entries)));

describe('exact preservation against the Phase 1 baseline', () => {
  it('round-trips to the legacy DATA with an identical SHA-256 (text, fields, order)', () => {
    expect(sha256Json(toLegacyData(repo.dataset))).toBe(meta.sha256.vocabulary);
  });

  it('deep-equals the baseline vocabulary fixture', () => {
    expect(toLegacyData(repo.dataset)).toEqual(phase1Fixture('baseline/vocabulary.json'));
  });

  it('round-trips the technical information with an identical SHA-256', () => {
    expect(sha256Json(toLegacyTechnicalInfo(validateTechnicalInfoDataset(rawTechnicalInfo, new Set(allEntries.map((e) => e.id))))))
      .toBe(meta.sha256.bautechnikInfo);
  });

  it('records its legacy source', () => {
    expect(repo.dataset.source).toEqual({ legacyCommit: '6763003', legacyDataSha256: meta.sha256.vocabulary });
  });
});

describe('counts', () => {
  it('7 categories in legacy order', () => {
    expect(repo.categories.map((c) => c.key)).toEqual(['arch', 'acad', 'bautechnik', 'bauphysik', 'fitness', 'anatomie', 'dreame']);
  });
  it('33 subtabs, 115 groups, 999 entries — same as Phase 1', () => {
    const subtabs = repo.categories.flatMap((c) => c.subtabs);
    expect(subtabs).toHaveLength(33);
    expect(subtabs.flatMap((s) => s.groups)).toHaveLength(115);
    expect(allEntries).toHaveLength(999);
    expect(repo.totalEntries).toBe(999);
    expect(stats.totals).toMatchObject({ categories: 7, subtabs: 33, groups: 115, words: 999 });
  });
  it('4 empty subtabs are preserved', () => {
    const empty = repo.categories.flatMap((c) => c.subtabs.filter((s) => s.groups.every((g) => g.entries.length === 0)).map((s) => `${c.key}/${s.id}`));
    expect(empty).toEqual(['bauphysik/bo1', 'bauphysik/bo2', 'bauphysik/bo3', 'bauphysik/bo4']);
  });
  it('31 technical-info entries, 17 linked to entries, 14 kept although never displayed', () => {
    const info = validateTechnicalInfoDataset(rawTechnicalInfo, new Set(allEntries.map((e) => e.id)));
    expect(info.entries).toHaveLength(31);
    expect(info.entries.filter((e) => e.entryIds.length > 0)).toHaveLength(17);
    expect(info.entries.filter((e) => e.entryIds.length === 0)).toHaveLength(14);
    for (const e of info.entries.filter((x) => x.entryIds.length)) {
      for (const id of e.entryIds) expect(repo.getEntry(id)?.word).toBe(e.legacyWord);
    }
  });
});

describe('schema validation', () => {
  it('bundled content passes runtime validation', () => {
    expect(() => validateVocabularyDataset(rawVocabulary)).not.toThrow();
  });
  it('rejects a duplicate id', () => {
    const copy = structuredClone(rawVocabulary);
    const groups = copy.categories[0]!.subtabs[0]!.groups[0]!;
    groups.entries[1]!.id = groups.entries[0]!.id;
    expect(() => validateVocabularyDataset(copy)).toThrow(/duplicate/);
  });
  it('rejects an unknown word type and an empty German word', () => {
    const a = structuredClone(rawVocabulary);
    a.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!.type = 'zz';
    expect(() => validateVocabularyDataset(a)).toThrow(/unknown/);
    const b = structuredClone(rawVocabulary);
    b.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!.word = '';
    expect(() => validateVocabularyDataset(b)).toThrow(/empty/);
  });
});
