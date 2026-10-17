import { describe, expect, it } from 'vitest';
import { getVocabularyRepository } from '../../../src/services/content/vocabularyRepository';
import { flattenCards } from '../../../src/features/review/deck';
import { fold, originalRange, queryTerms } from '../../../src/features/search/normalize';
import { createSearchIndex, mergeRanges, NO_FILTERS, type SearchHit } from '../../../src/features/search/searchIndex';

const cards = flattenCards(getVocabularyRepository().categories);
const index = createSearchIndex(cards);
const find = (q: string, filters = NO_FILTERS, learned: ReadonlySet<string> | null = null) => index.search(q, filters, learned);
const words = (hits: SearchHit[]) => hits.map((h) => h.card.entry.word);
const ids = (hits: SearchHit[]) => hits.map((h) => h.card.entry.id);
const slice = (text: string, r: readonly [number, number]) => text.slice(r[0], r[1]);

const AUSSENWAND = 'dv_522b07848b';
const STUETZE = 'dv_a3e180872f';
const AUFLAGER = 'dv_3a21e8c4f3'; // تکیه‌گاه (with ZWNJ)

describe('folding', () => {
  it('German: case, ß, umlauts (two forms), accents', () => {
    expect(fold('Die AUßENWAND').text).toBe('die aussenwand');
    expect(fold('Stütze').text).toBe('stutze');
    expect(fold('Stütze', true).text).toBe('stuetze');
    expect(fold('Café').text).toBe('cafe');
    expect(fold('STRASSE').text).toBe(fold('Straße').text);
  });

  it('Persian/Arabic variants, diacritics, tatweel, ZWNJ and digits', () => {
    expect(fold('تكيه‌گاه').text).toBe('تکیهگاه'); // Arabic kaf, ZWNJ
    expect(fold('ديوار').text).toBe(fold('دیوار').text); // Arabic yeh
    expect(fold('آب').text).toBe('اب');
    expect(fold('مـــدرسة').text).toBe('مدرسه'); // tatweel, teh marbuta
    expect(fold('کِتاب').text).toBe('کتاب'); // kasra
    expect(fold('۱۲٣').text).toBe('123');
    expect(fold('  a   b ').text).toBe('a b');
  });

  it('maps folded positions back to the original text', () => {
    const original = 'die Außenwand';
    const f = fold(original);
    const at = f.text.indexOf('aussen');
    expect(slice(original, originalRange(f, original, at, 'aussen'.length))).toBe('Außen');
    const fa = 'تکیه‌گاه';
    const g = fold(fa);
    expect(slice(fa, originalRange(g, fa, g.text.indexOf('هگ'), 2))).toBe('ه‌گ');
    expect(queryTerms('  Die   Wand ')).toEqual(['die', 'wand']);
  });
});

describe('vocabulary search', () => {
  it('an empty query lists all 999 entries in content order', () => {
    const all = find('');
    expect(all).toHaveLength(999);
    expect(all.map((h) => h.card.order)).toEqual([...all.keys()]);
  });

  it('German word: case-insensitive, ß ↔ ss, umlaut ↔ base letter ↔ transliteration', () => {
    for (const q of ['Außenwand', 'aussenwand', 'AUSSENWAND', 'außenwand', 'die außenwand']) {
      expect(ids(find(q))[0], q).toBe(AUSSENWAND);
    }
    for (const q of ['Stütze', 'stutze', 'stuetze', 'STÜTZE']) expect(ids(find(q)), q).toContain(STUETZE);
  });

  it('ranks exact words first, then word prefixes, then contained words, then meanings and examples', () => {
    const hits = find('wand');
    expect(hits.length).toBeGreaterThanOrEqual(18);
    const firstNonWord = hits.findIndex((h) => !h.ranges.word);
    expect(hits.slice(0, firstNonWord).every((h) => h.ranges.word)).toBe(true);
    expect(words(find('außenwand'))[0]).toBe('die Außenwand');
  });

  it('Persian meaning: exact and partial, with Arabic letter variants and without ZWNJ', () => {
    expect(ids(find('دیوار خارجی'))[0]).toBe(AUSSENWAND);
    expect(ids(find('ديوار خارجي'))).toContain(AUSSENWAND); // Arabic yeh
    expect(ids(find('تكيه گاه'))).toContain(AUFLAGER); // Arabic kaf, space instead of ZWNJ
    expect(ids(find('تکیهگاه'))).toContain(AUFLAGER); // typed without ZWNJ
  });

  it('example sentences (German and Persian translation)', () => {
    const hit = find('gut gedämmt').find((h) => h.card.entry.id === AUSSENWAND)!;
    expect(hit.ranges.example).toBeDefined();
    expect(hit.ranges.example!.map((r) => slice(hit.card.entry.example, r))).toEqual(['gut', 'gedämmt']);
    expect(find('gedaemmt').map((h) => h.card.entry.id)).toContain(AUSSENWAND);
  });

  it('all terms must match (in any field); no match → empty', () => {
    const both = find('außenwand دیوار');
    expect(ids(both)[0]).toBe(AUSSENWAND);
    // Others match too, because "Außenwand" appears in their example and "دیوار" in their meaning.
    expect(both.every((h) => Object.keys(h.ranges).length >= 1 && (h.ranges.word || h.ranges.example) && (h.ranges.fa || h.ranges.exampleFa))).toBe(true);
    expect(find('xyzqwv')).toEqual([]);
    expect(find('außenwand fitness')).toEqual([]);
  });

  it('highlights point at the original text, including ß and umlauts', () => {
    const hit = find('aussenwand')[0]!;
    expect(hit.ranges.word!.map((r) => slice(hit.card.entry.word, r))).toEqual(['Außenwand']);
    const st = find('stuetze').find((h) => h.card.entry.id === STUETZE)!;
    expect(st.ranges.word!.map((r) => slice(st.card.entry.word, r))).toEqual(['Stütze']);
  });

  it('filters: category, subcategory, learned/unlearned — combined with the query', () => {
    const arch = find('', { ...NO_FILTERS, category: 'arch' });
    expect(arch.every((h) => h.card.categoryKey === 'arch')).toBe(true);
    const sub = find('', { category: 'arch', subtab: 'bau', status: 'all' });
    expect(sub.length).toBeGreaterThan(0);
    expect(sub.every((h) => h.card.subtabId === 'bau')).toBe(true);
    const learned = new Set([AUSSENWAND, STUETZE]);
    expect(ids(find('', { ...NO_FILTERS, status: 'learned' }, learned)).sort()).toEqual([...learned].sort());
    expect(find('', { ...NO_FILTERS, status: 'unlearned' }, learned)).toHaveLength(997);
    expect(ids(find('wand', { category: 'arch', subtab: 'all', status: 'learned' }, learned))).toEqual([AUSSENWAND]);
    expect(find('wand', { category: 'fitness', subtab: 'all', status: 'all' })).toEqual([]);
  });

  it('words toggled in the current view stay visible under a status filter (keep set)', () => {
    const learned = new Set([AUSSENWAND]);
    expect(ids(index.search('außenwand', { ...NO_FILTERS, status: 'unlearned' }, learned))).not.toContain(AUSSENWAND);
    expect(ids(index.search('außenwand', { ...NO_FILTERS, status: 'unlearned' }, learned, new Set([AUSSENWAND])))[0]).toBe(AUSSENWAND);
  });

  it('merges overlapping ranges', () => {
    expect(mergeRanges([[5, 8], [0, 2], [1, 3], [7, 9]])).toEqual([[0, 3], [5, 9]]);
  });

  it('is fast enough for every keystroke on the full dataset', () => {
    const t0 = performance.now();
    for (const q of ['a', 'au', 'auß', 'außen', 'دی', 'دیوار', 'gut gedämmt']) find(q);
    expect(performance.now() - t0).toBeLessThan(200); // 7 searches over 999 entries
  });
});
