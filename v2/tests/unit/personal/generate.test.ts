// AI vocabulary generator: building 25–200 entries from batches, duplicate handling, retries,
// partial results, idempotent import into user-created categories, practice scopes.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { GeneratedEntry, GenerateRequest } from '../../../ai-worker/src/contract';
import type { GenerateResult } from '../../../src/features/ai/aiClient';
import { listCollections, wordCollection } from '../../../src/features/personal/collections';
import { createDuplicateIndex } from '../../../src/features/personal/duplicates';
import { runGeneration } from '../../../src/features/personal/generate/generation';
import { buildImport, draftRows } from '../../../src/features/personal/generate/importPlan';
import { PersonalVocabulary } from '../../../src/features/personal/personalVocabulary';
import { createMemoryStore } from '../../../src/features/progress/localStore';
import { personalCards, selectCards } from '../../../src/features/review/deck';
import { selectShadowingCards } from '../../../src/features/shadowing/queue';
import { practiceScopes } from '../../../src/features/personal/usePersonal';
import { createFakeAi } from '../../helpers/fakeAi';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A unique, valid German-looking noun per number (no digits: lemmas must be words). */
const noun = (n: number) => `Kleid${LETTERS[n % 26]!.toLowerCase()}${LETTERS[Math.floor(n / 26) % 26]!.toLowerCase()}ung`;
const entry = (n: number, sub = 'Oberteile'): GeneratedEntry => ({
  article: 'die', lemma: noun(n), type: 'n', grammar: '', fa: `پوشاک ${n}`, example: `Die ${noun(n)} ist sehr praktisch.`,
  exampleFa: 'این لباس خیلی کاربردی است.', subcategory: sub, level: 'B1',
});
const ok = (entries: GeneratedEntry[]): GenerateResult => ({ ok: true, batch: { entries, rejected: 0, mock: false, model: '@cf/test', remainingToday: 100, dailyLimit: 300 } });
const noSleep = async () => {};

/** A generator that never repeats itself and spreads entries over two subcategories. */
function counter() {
  let n = 0;
  return (req: GenerateRequest) => ok(Array.from({ length: req.count }, () => entry(n++, n % 2 ? 'Oberteile' : 'Schuhe')));
}

describe('runGeneration', () => {
  it('reaches 200 entries in batches of ≤ 15, reusing subcategories and sending only this list as "avoid"', async () => {
    const ai = createFakeAi();
    ai.useGenerator(counter());
    const progress: number[] = [];
    const out = await runGeneration(ai, { topic: 'Kleidung', level: 'B1-B2', count: 200 }, { sleep: noSleep, onProgress: (p) => progress.push(p.collected) });
    expect(out.entries).toHaveLength(200);
    expect(new Set(out.entries.map((e) => e.lemma)).size).toBe(200);
    expect(ai.generateCalls.every((r) => r.count <= 15)).toBe(true);
    expect(ai.generateCalls[0]).toEqual({ topic: 'Kleidung', level: 'B1-B2', count: 15 }); // first batch alone, no history
    expect(ai.generateCalls[1]!.subcategories).toEqual(['Oberteile', 'Schuhe']);
    expect(ai.generateCalls[1]!.focus).toBeDefined();
    expect(ai.generateCalls.at(-1)!.avoid!.length).toBeLessThanOrEqual(250);
    expect(progress.at(-1)).toBe(200);
    expect(out.stoppedBy).toBeNull();
  });

  it('drops duplicates across batches (folded spelling, article ignored) and asks again', async () => {
    const ai = createFakeAi();
    ai.willGenerate([entry(1), entry(2), { ...entry(1), article: 'der' }]);
    ai.willGenerate([{ ...entry(2), lemma: noun(2).toUpperCase() }, entry(3)]);
    const out = await runGeneration(ai, { topic: 'Kleidung', level: 'all', count: 3 }, { sleep: noSleep, parallel: 1 });
    expect(out.entries.map((e) => e.lemma)).toEqual([noun(1), noun(2), noun(3)]);
    expect(out.rejected).toBe(2);
  });

  it('retries transient errors, stops on limits and keeps what was collected', async () => {
    const ai = createFakeAi();
    ai.willGenerate(Array.from({ length: 15 }, (_, i) => entry(i)));
    ai.willFailGenerate('upstream-error');
    ai.willGenerate(Array.from({ length: 15 }, (_, i) => entry(100 + i)));
    ai.willFailGenerate('daily-limit');
    const out = await runGeneration(ai, { topic: 'Kleidung', level: 'all', count: 50 }, { sleep: noSleep, parallel: 1 });
    expect(out.entries).toHaveLength(30);
    expect(out.stoppedBy?.code).toBe('daily-limit');
    expect(out.stoppedBy?.message).toMatch(/فردا/);
  });

  it('stops when the model only repeats itself, and can be cancelled', async () => {
    const ai = createFakeAi();
    ai.useGenerator(() => ok([entry(7)]));
    const out = await runGeneration(ai, { topic: 'Kleidung', level: 'all', count: 25 }, { sleep: noSleep, parallel: 1 });
    expect(out.entries).toHaveLength(1);
    const ctrl = new AbortController();
    const ai2 = createFakeAi();
    ai2.useGenerator((req) => { ctrl.abort(); return counter()(req); });
    const cancelled = await runGeneration(ai2, { topic: 'Kleidung', level: 'all', count: 100 }, { sleep: noSleep, signal: ctrl.signal });
    expect(cancelled.entries.length).toBeLessThanOrEqual(15);
  });
});

describe('import plan', () => {
  const noDupes = createDuplicateIndex([], []);

  it('imports into a NEW own category with AI subcategories; idempotent; never overwrites', async () => {
    const vocab = new PersonalVocabulary('alice', createMemoryStore());
    await vocab.load();
    const rows = draftRows(Array.from({ length: 120 }, (_, i) => entry(i, i % 3 ? 'Oberteile' : 'Schuhe')), noDupes);
    const plan = buildImport(rows, { kind: 'collection', name: 'Kleidung und Mode' }, 1_000);
    expect(plan.invalid).toEqual([]);
    await vocab.addMany(plan.words);
    await vocab.addMany(buildImport(rows, { kind: 'collection', name: 'Kleidung und Mode' }, 2_000).words); // double click / retry
    const words = vocab.getSnapshot().words;
    expect(words).toHaveLength(120);
    expect(words.every((w) => w.source === 'manual' && w.placement?.category === 'my:Kleidung und Mode')).toBe(true);
    expect(listCollections(words)).toEqual([{ key: 'my:Kleidung und Mode', name: 'Kleidung und Mode', count: 120, subcategories: [{ name: 'Oberteile', count: 80 }, { name: 'Schuhe', count: 40 }] }]);
    // An edited word is never overwritten by a re-import of the same preview.
    const first = words.find((w) => w.id === rows[0]!.id)!;
    vocab.update(first.id, { ...first, fa: 'ویرایش‌شده' });
    await vocab.addMany(plan.words);
    expect(vocab.getSnapshot().byId.get(first.id)!.fa).toBe('ویرایش‌شده');
    vocab.stop();
  });

  it('only selected rows; duplicates of existing words start unselected; invalid edits are reported', () => {
    const existing = createDuplicateIndex([], [{ schemaVersion: 1, id: 'pw_00000000000000000001', article: 'die', lemma: noun(1), type: 'n', grammar: '', fa: 'x', example: '', exampleFa: '', pronunciationFa: '', placement: null, learned: false, createdAt: 1, updatedAt: 1, source: 'manual', legacyId: null }]);
    const rows = draftRows([entry(1), entry(2), entry(3)], existing);
    expect(rows.map((r) => r.selected)).toEqual([false, true, true]);
    rows[2] = { ...rows[2]!, entry: { ...rows[2]!.entry, fa: '' } };
    const plan = buildImport(rows, { kind: 'none' }, 1);
    expect(plan.words.map((w) => w.lemma)).toEqual([noun(2)]);
    expect(plan.invalid).toEqual([rows[2]!.id]);
    expect(plan.words[0]!.placement).toBeNull();
  });

  it('can target a built-in category; empty subcategories get a default name', () => {
    const rows = draftRows([{ ...entry(4), subcategory: '' }], noDupes);
    expect(buildImport(rows, { kind: 'builtin', category: 'fitness', subtab: 'training' }, 1).words[0]!.placement).toEqual({ category: 'fitness', subtab: 'training' });
    expect(buildImport(rows, { kind: 'collection', name: 'Mode' }, 1).words[0]!.placement).toEqual({ category: 'my:Mode', subtab: 'Allgemein' });
  });

  it('imported words are practice cards: "my words" and their own category scope', () => {
    const rows = draftRows([entry(5), entry(6)], noDupes);
    const words = buildImport(rows, { kind: 'collection', name: 'Mode' }, 1).words;
    const cards = personalCards(words, 100_000);
    expect(cards[0]).toMatchObject({ categoryKey: 'mine', collection: 'Mode', categoryLabel: 'Mode', subtabLabel: 'Oberteile' });
    const progress = { learned: new Set() as ReadonlySet<never>, againIds: null };
    expect(selectCards(cards, 'all', 'my:Mode', progress)).toHaveLength(2);
    expect(selectCards(cards, 'all', 'mine', progress)).toHaveLength(2);
    expect(selectCards(cards, 'all', 'my:Andere', progress)).toHaveLength(0);
    expect(selectShadowingCards(cards, 'all', new Set(['my:Mode' as const]), progress)).toHaveLength(2);
    expect(practiceScopes([], words).map((s) => s.key)).toEqual(['mine', 'my:Mode']);
    expect(wordCollection(words[0]!)).toEqual({ name: 'Mode', subcategory: 'Oberteile' });
  });
});

describe('article plausibility (warning only)', () => {
  it('flags articles that contradict reliable noun endings, and nothing uncertain', async () => {
    const { articleLooksWrong, suggestedArticle } = await import('../../../src/features/personal/generate/articleHint');
    expect(articleLooksWrong('der', 'Fundament')).toBe(true); // seen in the live test
    expect(suggestedArticle('Fundament')).toBe('das');
    expect(articleLooksWrong('das', 'Fundament')).toBe(false);
    expect(articleLooksWrong('der', 'Renovierung')).toBe(true);
    expect(articleLooksWrong('die', 'Tragfähigkeit')).toBe(false);
    expect(articleLooksWrong('das', 'Mädchen')).toBe(false);
    expect(articleLooksWrong('der', 'Zement')).toBe(false); // short / exception-prone endings stay silent
    expect(articleLooksWrong('der', 'Moment')).toBe(false);
    expect(articleLooksWrong('der', 'Termin')).toBe(false);
    expect(articleLooksWrong('die', 'Hose')).toBe(false);
    expect(articleLooksWrong(null, 'renovieren')).toBe(false);
  });
});
