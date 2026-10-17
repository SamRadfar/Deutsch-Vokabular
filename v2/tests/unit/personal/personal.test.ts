import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { getVocabularyRepository } from '../../../src/services/content/vocabularyRepository';
import { createIndexedDbStore, createMemoryStore, openProgressDb, type ProgressLocalStore } from '../../../src/features/progress/localStore';
import {
  cleanText, displayWord, isPersonalId, isPracticeWordId, isValidPersonalWord, newPersonalId, normalizeInput, toEntry, validateInput,
  type PersonalWord, type PersonalWordInput,
} from '../../../src/features/personal/model';
import { PersonalVocabulary } from '../../../src/features/personal/personalVocabulary';
import { createDuplicateIndex } from '../../../src/features/personal/duplicates';
import { countImport, planLegacyImport, wordsToImport } from '../../../src/features/personal/legacyImport';
import { withPersonalGroups, PERSONAL_GROUP_LABEL } from '../../../src/features/personal/browse';
import { mergeLearned, routeLearned } from '../../../src/features/personal/usePersonal';
import { flattenCards, personalCards, selectCards } from '../../../src/features/review/deck';
import { createSearchIndex, NO_FILTERS } from '../../../src/features/search/searchIndex';

const repo = getVocabularyRepository();
const builtIn = flattenCards(repo.categories);
const input = (o: Partial<PersonalWordInput> = {}): PersonalWordInput => ({
  article: null, lemma: 'Nachhaltigkeit', type: 'n', grammar: '', fa: 'پایداری', example: '', exampleFa: '', pronunciationFa: '', placement: null, ...o,
});
let n = 0;
const ids = () => `pw_${(++n).toString(16).padStart(20, '0')}`;

describe('personal word model', () => {
  it('ids are pw_ + 20 hex and can never look like built-in ids', () => {
    const id = newPersonalId();
    expect(id).toMatch(/^pw_[0-9a-f]{20}$/);
    expect(isPersonalId(id)).toBe(true);
    expect(isPersonalId('dv_522b07848b')).toBe(false);
    expect(isPracticeWordId('dv_522b07848b') && isPracticeWordId(id)).toBe(true);
    expect(isPracticeWordId('pw_123')).toBe(false);
    expect(new Set(Array.from({ length: 500 }, () => newPersonalId())).size).toBe(500);
    for (const c of builtIn) expect(isPersonalId(c.entry.id)).toBe(false);
  });

  it('cleans text and takes the article of a noun from the word field', () => {
    expect(cleanText('  die \u0007 Wand \n ')).toBe('die Wand');
    expect(normalizeInput(input({ lemma: 'die Wand' }))).toMatchObject({ article: 'die', lemma: 'Wand' });
    expect(normalizeInput(input({ lemma: 'Das Haus', article: null }))).toMatchObject({ article: 'das', lemma: 'Haus' });
    expect(normalizeInput(input({ lemma: 'die Wand', article: 'der' }))).toMatchObject({ article: 'der', lemma: 'die Wand' }); // explicit choice wins
    expect(normalizeInput(input({ type: 'au', lemma: 'die Nase voll haben', article: 'die' }))).toMatchObject({ article: null, lemma: 'die Nase voll haben' });
    expect(displayWord({ article: 'die', lemma: 'Wand' })).toBe('die Wand');
  });

  it('validates with Persian messages', () => {
    expect(validateInput(normalizeInput(input()))).toEqual({});
    expect(validateInput(input({ lemma: '' }))).toHaveProperty('lemma', 'واژهٔ آلمانی را وارد کنید.');
    expect(validateInput(input({ lemma: '123' }))).toHaveProperty('lemma');
    expect(validateInput(input({ lemma: 'دیوار' }))).toHaveProperty('lemma');
    expect(validateInput(input({ fa: '' }))).toHaveProperty('fa', 'معنی فارسی را وارد کنید.');
    expect(validateInput(input({ fa: '' }), { allowEmptyFa: true })).toEqual({});
    expect(validateInput(input({ example: 'x'.repeat(401) }))).toHaveProperty('example', 'حداکثر 400 نویسه.');
    expect(validateInput(input({ type: 'zz' as never }))).toHaveProperty('type');
  });

  it('keeps HTML as plain text (rendering escapes it)', () => {
    const w = normalizeInput(input({ lemma: '<img src=x onerror=alert(1)>', fa: '<b>x</b>' }));
    expect(w.lemma).toBe('<img src=x onerror=alert(1)>');
    expect(toEntry({ ...w, schemaVersion: 1, id: ids(), learned: false, createdAt: 1, updatedAt: 1, source: 'manual', legacyId: null }).word).toContain('<img');
  });
});

describe('PersonalVocabulary (local persistence)', () => {
  it('add, edit, learned, delete and undo — and everything survives a reload (IndexedDB)', async () => {
    const factory = new IDBFactory();
    const vocab = new PersonalVocabulary('alice', createIndexedDbStore(openProgressDb(factory)), () => 1000, ids);
    await vocab.load();
    const a = vocab.add(input({ lemma: 'die Wand', type: 'n', fa: 'دیوار' }));
    expect(a.ok).toBe(true);
    const id = a.ok ? a.word.id : '';
    expect(vocab.getSnapshot().words.map(displayWord)).toEqual(['die Wand']);
    expect(vocab.update(id, input({ lemma: 'Wand', article: 'die', fa: 'دیوار (داخلی)' })).ok).toBe(true);
    vocab.setLearned(id, true);
    const b = vocab.add(input({ lemma: 'nachhaltig', type: 'a', fa: 'پایدار' }));
    const removed = vocab.remove(b.ok ? b.word.id : '')!;
    expect(vocab.getSnapshot().words).toHaveLength(1);
    vocab.restore(removed);
    expect(vocab.getSnapshot().words).toHaveLength(2);
    await vocab.flushed();

    const reloaded = new PersonalVocabulary('alice', createIndexedDbStore(openProgressDb(factory)));
    await reloaded.load();
    const w = reloaded.getSnapshot().byId.get(id)!;
    expect(w).toMatchObject({ article: 'die', lemma: 'Wand', fa: 'دیوار (داخلی)', learned: true, source: 'manual', createdAt: 1000 });
    expect(reloaded.getSnapshot().words).toHaveLength(2);
    expect(reloaded.getSnapshot().saved).toBe(true);
  });

  it('rejects invalid input without saving anything', async () => {
    const store = createMemoryStore();
    const vocab = new PersonalVocabulary('alice', store);
    await vocab.load();
    expect(vocab.add(input({ lemma: '', fa: '' }))).toMatchObject({ ok: false, errors: { lemma: expect.any(String), fa: expect.any(String) } });
    await vocab.flushed();
    expect(await store.loadPersonalWords('alice')).toEqual([]);
  });

  it('is isolated per account (same device, same database)', async () => {
    const store = createIndexedDbStore(openProgressDb(new IDBFactory()));
    const alice = new PersonalVocabulary('alice', store);
    await alice.load();
    alice.add(input());
    await alice.flushed();
    for (const uid of ['bob', 'alice2', 'alic']) {
      const other = new PersonalVocabulary(uid, store);
      await other.load();
      expect(other.getSnapshot().words, uid).toEqual([]);
    }
  });

  it('a failing local write keeps the word for this page and reports it; unreadable records are left alone', async () => {
    const mem = createMemoryStore();
    const failing: ProgressLocalStore = {
      ...mem,
      loadPersonalWords: async () => [{ id: 'garbage' } as never],
      putPersonalWord: async () => { throw new Error('quota'); },
    };
    const vocab = new PersonalVocabulary('alice', failing);
    await vocab.load();
    expect(vocab.getSnapshot().unreadable).toBe(1);
    vocab.add(input());
    await vocab.flushed();
    expect(vocab.getSnapshot()).toMatchObject({ saved: false });
    expect(vocab.getSnapshot().words).toHaveLength(1);
  });

  it('addMany is one transaction and never duplicates an existing id', async () => {
    const store = createMemoryStore();
    const vocab = new PersonalVocabulary('alice', store, () => 5, ids);
    await vocab.load();
    const r = vocab.add(input());
    const existing = r.ok ? r.word : null!;
    const fresh: PersonalWord = { ...existing, id: ids(), lemma: 'Neu' };
    const spy = vi.spyOn(store, 'putPersonalWords');
    await vocab.addMany([existing, fresh]);
    expect(spy).toHaveBeenCalledWith('alice', [fresh]);
    expect(vocab.getSnapshot().words).toHaveLength(2);
  });
});

describe('duplicates', () => {
  it('finds built-in and personal duplicates with folding (case, ß/ss, umlauts, article ignored)', () => {
    const mine: PersonalWord = { ...normalizeInput(input({ lemma: 'Übung', type: 'n', article: 'die' })), schemaVersion: 1, id: ids(), learned: false, createdAt: 1, updatedAt: 1, source: 'manual', legacyId: null };
    const index = createDuplicateIndex(builtIn, [mine]);
    expect(index.find('aussenwand').map((d) => [d.kind, d.word])).toEqual([['builtIn', 'die Außenwand']]);
    expect(index.find('der AUSSENWAND')[0]!.where).toContain('Architecture');
    expect(index.find('uebung').map((d) => d.kind)).toContain('personal'); // ü ↔ ue
    expect(index.find('ubung').map((d) => d.id)).toContain(mine.id); // ü ↔ u
    // Editing a word never reports the word itself (the built-in "die Übung" still is a duplicate).
    expect(index.find('Übung', mine.id).map((d) => d.kind)).toEqual(['builtIn']);
    expect(index.find('Quatschwort')).toEqual([]);
  });
});

describe('legacy custom words import (dvok5_custom)', () => {
  const legacy = (o: Record<string, unknown>) => ({
    id: 'cw1712345678901', main: 'arch', tab: 'bau', word: 'die Probewortigkeit', sentence: '', type: 'n', fa: 'واژهٔ آزمایشی',
    ex: 'Die Probewortigkeit zählt.', exFa: 'آزمایش مهم است.', pr: 'پروبه‌ورتیش‌کایت', status: 'ready', checked: true, ...o,
  });
  const ctx = (existing: PersonalWord[] = []) => ({ categories: repo.categories, builtIn, existing, now: 1_800_000_000_000, newId: ids });

  it('maps fields, keeps placement, learned flag and creation time; x means "Ausdruck"', () => {
    const raw = JSON.stringify([legacy({}), legacy({ id: 'cw1712345678902', word: 'auf jeden Fall', type: 'x', main: 'gone', tab: 'nope', checked: false })]);
    const plan = planLegacyImport(raw, ctx());
    expect(plan.items.map((i) => i.status)).toEqual(['new', 'new']);
    expect(plan.items[0]!.word).toMatchObject({ article: 'die', lemma: 'Probewortigkeit', type: 'n', learned: true, placement: { category: 'arch', subtab: 'bau' }, createdAt: 1712345678901, source: 'legacy-import', legacyId: 'cw1712345678901' });
    expect(plan.items[1]!.word).toMatchObject({ type: 'au', article: null, placement: null, learned: false });
    expect(plan.items[1]!.unsorted).toBe(true);
    expect(raw).toContain('die Probewortigkeit'); // input untouched
  });

  it('is idempotent: words imported before are skipped', async () => {
    const raw = JSON.stringify([legacy({})]);
    const vocab = new PersonalVocabulary('alice', createMemoryStore());
    await vocab.load();
    await vocab.addMany(wordsToImport(planLegacyImport(raw, ctx()), { includeBuiltInDuplicates: false }));
    const again = planLegacyImport(raw, ctx([...vocab.getSnapshot().words]));
    expect(again.items.map((i) => i.status)).toEqual(['already-imported']);
    expect(wordsToImport(again, { includeBuiltInDuplicates: true })).toEqual([]);
  });

  it('never duplicates silently: personal duplicates are skipped, built-in duplicates need an explicit choice', () => {
    const mine = { ...normalizeInput(input({ lemma: 'Probewortigkeit', article: 'die' })), schemaVersion: 1 as const, id: ids(), learned: false, createdAt: 1, updatedAt: 1, source: 'manual' as const, legacyId: null };
    const raw = JSON.stringify([legacy({}), legacy({ id: 'cw1712345678903', word: 'die Außenwand' }), legacy({ id: 'cw1712345678904', word: 'neu', type: 'a' }), legacy({ id: 'cw1712345678905', word: 'neu', type: 'a' })]);
    const plan = planLegacyImport(raw, ctx([mine]));
    expect(plan.items.map((i) => i.status)).toEqual(['duplicate-personal', 'duplicate-builtin', 'new', 'duplicate-personal']);
    expect(wordsToImport(plan, { includeBuiltInDuplicates: false }).map((w) => w.lemma)).toEqual(['neu']);
    expect(wordsToImport(plan, { includeBuiltInDuplicates: true }).map((w) => w.lemma)).toEqual(['Außenwand', 'neu']);
  });

  it('AI-pending words without a meaning are imported as incomplete; broken data is reported, not guessed', () => {
    const raw = JSON.stringify([
      legacy({ id: 'cw1712345678906', word: 'Zukunft', status: 'pending', fa: '', ex: '', sentence: 'Die Zukunft ist offen.' }),
      legacy({ id: 'cw1712345678907', word: '' }),
      legacy({ id: 'cw1712345678906' }), // duplicate legacy id: dropped by the parser (warning), not imported twice
      { nonsense: true },
    ]);
    const plan = planLegacyImport(raw, ctx());
    expect(plan.items[0]).toMatchObject({ status: 'incomplete', word: { fa: '', example: 'Die Zukunft ist offen.' } });
    // The empty word, the repeated id and the non-word are all reported (by the parser or the plan) — none is imported.
    expect(countImport(plan).invalid + plan.malformed).toBe(3);
    expect(wordsToImport(plan, { includeBuiltInDuplicates: true })).toHaveLength(1);
    expect(planLegacyImport('{not json', ctx()).unreadable).toBeTruthy();
    expect(planLegacyImport(null, ctx()).items).toEqual([]);
  });
});

describe('integration with the learning tools', () => {
  const mk = (o: Partial<PersonalWordInput>, learned = false): PersonalWord => ({
    ...normalizeInput(input(o)), schemaVersion: 1, id: ids(), learned, createdAt: 1, updatedAt: 1, source: 'manual', legacyId: null,
  });

  it('personal cards join the decks under "my words" without touching the built-in ones', () => {
    const words = [mk({ lemma: 'die Nachhaltigkeit' }, true), mk({ lemma: 'Zukunft', fa: 'آینده' })];
    const cards = [...builtIn, ...personalCards(words, 100_000)];
    expect(cards).toHaveLength(1001);
    const learned = mergeLearned(new Set([builtIn[0]!.entry.id]), { words, byId: new Map(words.map((w) => [w.id, w])), saved: true, unreadable: 0 });
    expect(selectCards(cards, 'all', 'mine', { learned, againIds: null }).map((c) => c.entry.word)).toEqual(['die Nachhaltigkeit', 'Zukunft']);
    expect(selectCards(cards, 'learned', 'all', { learned, againIds: null })).toHaveLength(2);
    expect(selectCards(cards, 'unlearned', 'mine', { learned, againIds: null }).map((c) => c.entry.word)).toEqual(['Zukunft']);
  });

  it('search finds personal words by German, Persian and example text', () => {
    const w = mk({ lemma: 'Nachhaltigkeit', example: 'Nachhaltigkeit zählt.', fa: 'پایداری' });
    const index = createSearchIndex([...builtIn, ...personalCards([w], 100_000)]);
    for (const q of ['nachhaltigkeit', 'پايداري', 'zaehlt']) expect(index.search(q, NO_FILTERS, null).map((h) => h.card.entry.id), q).toContain(w.id);
    expect(index.search('', { ...NO_FILTERS, category: 'mine' }, null).map((h) => h.card.entry.id)).toEqual([w.id]);
  });

  it('learned flags of personal words never go to the synced progress (deployed rules accept dv_ ids only)', () => {
    const engine = vi.fn();
    const vocab = { setLearned: vi.fn() };
    const set = routeLearned(engine, vocab);
    set('pw_00000000000000000001', true);
    set('dv_522b07848b', true);
    expect(vocab.setLearned).toHaveBeenCalledExactlyOnceWith('pw_00000000000000000001', true);
    expect(engine).toHaveBeenCalledExactlyOnceWith('dv_522b07848b', true);
  });

  it('placed words appear as a "Meine Wörter" group in their subtab; the content object is not modified', () => {
    const arch = repo.getCategory('arch')!;
    const before = JSON.stringify(arch);
    const w = mk({ lemma: 'die Nachhaltigkeit', placement: { category: 'arch', subtab: arch.subtabs[1]!.id } });
    const merged = withPersonalGroups(arch, [w, mk({ lemma: 'Ohne Platz' })]);
    expect(merged).not.toBe(arch);
    expect(merged.subtabs[1]!.groups.at(-1)).toMatchObject({ label: PERSONAL_GROUP_LABEL, entries: [expect.objectContaining({ id: w.id, word: 'die Nachhaltigkeit' })] });
    expect(merged.subtabs[0]).toBe(arch.subtabs[0]);
    expect(JSON.stringify(arch)).toBe(before);
    expect(withPersonalGroups(repo.getCategory('fitness')!, [w])).toBe(repo.getCategory('fitness'));
  });

  it('stored records are validated on load', () => {
    const w = mk({});
    expect(isValidPersonalWord(w)).toBe(true);
    expect(isValidPersonalWord({ ...w, id: 'dv_522b07848b' })).toBe(false);
    expect(isValidPersonalWord({ ...w, lemma: '' })).toBe(false);
    expect(isValidPersonalWord({ ...w, type: 'zz' })).toBe(false);
  });
});
