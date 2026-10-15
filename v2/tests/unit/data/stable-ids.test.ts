import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { getVocabularyRepository } from '../../../src/services/content/vocabularyRepository';
import { buildLegacyKeyIndex, buildWordTextIndex, idRegistry } from '../../../src/services/content/idRegistry';
import { WORD_ID_PATTERN } from '../../../src/models/vocabulary';
import { phase1Fixture, type Phase1Meta, type Phase1ProgressKey } from '../../helpers/phase1';

const repo = getVocabularyRepository();
const contentIds = repo.categories.flatMap((c) => c.subtabs.flatMap((s) => s.groups.flatMap((g) => g.entries.map((e) => e.id))));
const baselineKeys = phase1Fixture<Phase1ProgressKey[]>('baseline/progress-keys.json');

// Independent re-implementation of the documented minting rule (not imported from the generator).
const mint = (index: number, key: string) =>
  'dv_' + createHash('sha256').update(`deutsch-vokabular/word/v1|${index}|${key}`, 'utf8').digest('hex').slice(0, 10);

describe('stable word ids', () => {
  it('every entry has a unique id of the form dv_<10 hex>', () => {
    expect(contentIds).toHaveLength(999);
    expect(new Set(contentIds).size).toBe(999);
    for (const id of contentIds) expect(id).toMatch(WORD_ID_PATTERN);
  });

  it('the registry was minted once from the Phase 1 baseline and records its origin', () => {
    expect(idRegistry.mintedFrom).toEqual({ legacyCommit: '6763003', legacyDataSha256: phase1Fixture<Phase1Meta>('baseline/meta.json').sha256.vocabulary });
    expect(idRegistry.entries).toHaveLength(999);
    idRegistry.entries.forEach((e, i) => {
      expect(e.baselineIndex).toBe(i);
      expect(e.legacyKey).toBe(baselineKeys[i]!.progressKey);
      expect(e.id).toBe(mint(e.baselineIndex, e.legacyKey));
    });
  });

  it('content ids are exactly the registry ids (ids are stored, not derived at runtime)', () => {
    expect(contentIds).toEqual(idRegistry.entries.map((e) => e.id));
    for (const e of idRegistry.entries) expect(repo.getEntry(e.id)?.word).toBe(e.legacyWord);
  });

  it('ids do not depend on spelling: the registry pins legacy word and location only as history', () => {
    // Renaming a word in content would keep its id; the registry stays the record of origin.
    const sample = idRegistry.entries[0]!;
    expect(sample).toEqual({
      id: 'dv_522b07848b',
      legacyKey: 'arch::die Außenwand',
      legacyWord: 'die Außenwand',
      baselineIndex: 0,
      baselineLocation: { category: 'arch', subtab: 'bau', group: 0, row: 0 },
    });
  });
});

describe('legacy key mapping', () => {
  const index = buildLegacyKeyIndex();

  it('covers all 994 legacy progress keys and all 999 ids', () => {
    expect(index.size).toBe(994);
    expect([...index.values()].flat().sort()).toEqual([...contentIds].sort());
    for (const k of baselineKeys) expect(index.get(k.progressKey)).toBeDefined();
  });

  it('maps each of the 5 colliding legacy keys to exactly two distinct entries', () => {
    const multi = [...index].filter(([, ids]) => ids.length > 1);
    expect(multi.map(([k]) => k)).toEqual([
      'acad::belegen', 'acad::modellieren', 'acad::rendern',
      'bautechnik::die Dreifachverglasung', 'bauphysik::der Hebelarm',
    ].sort((a, b) => baselineKeys.findIndex((x) => x.progressKey === a) - baselineKeys.findIndex((x) => x.progressKey === b)));
    for (const [, ids] of multi) {
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    }
  });

  it('keeps duplicate entries as separate records with identical text where the source was identical', () => {
    const [a, b] = index.get('bauphysik::der Hebelarm')!;
    expect(a).not.toBe(b);
    expect(repo.getEntry(a!)?.word).toBe('der Hebelarm');
    expect(repo.getEntry(b!)?.word).toBe('der Hebelarm');
  });

  it('word-text index spans categories (37 words appear in more than one category)', () => {
    const text = buildWordTextIndex();
    const crossCategory = [...text].filter(([, ids]) =>
      new Set(ids.map((id) => idRegistry.entries.find((e) => e.id === id)!.baselineLocation.category)).size > 1);
    expect(crossCategory).toHaveLength(37);
  });
});
