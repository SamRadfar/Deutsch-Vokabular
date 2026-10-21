// Universal categories: validation, the account store (create / rename / delete), the catalog that
// every workflow uses, destinations committed only at save time, browsing tabs and the legacy
// ("my:<name>") compatibility migration. No network, no Firebase.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  applyDestination, browseCategories, buildCatalog, countWords, destinationError, destinationOf, placementLabel, PERSONAL_GROUP_LABEL, resolvePlacement,
} from '../../../src/features/categories/catalog';
import { CategoryStore } from '../../../src/features/categories/categoryStore';
import { migrateLegacyCollections } from '../../../src/features/categories/migration';
import { DIRECT_SUBTAB, isCategoryId, isCategoryValue, nameKey, newCategoryId, stableCategoryId, validateName } from '../../../src/features/categories/model';
import type { PersonalWord } from '../../../src/features/personal/model';
import { PersonalVocabulary } from '../../../src/features/personal/personalVocabulary';
import { createMemoryStore } from '../../../src/features/progress/localStore';
import type { Category } from '../../../src/models/vocabulary';

const LIB = [
  { key: 'arch', label: '🏛️ Architektur', theme: 'arch', subtabs: [
    { id: 'grund', icon: '', label: 'Grundbegriffe', fa: '', groups: [{ label: 'G', entries: [{ id: 'dv_0000000001', word: 'die Wand', fa: 'دیوار', type: 'n' }] }] },
    { id: 'ent', icon: '', label: 'Entwurf', fa: '', groups: [] },
  ] },
  { key: 'fitness', label: '💪 Fitness', theme: 'fitness', subtabs: [{ id: 'training', icon: '', label: 'Training', fa: '', groups: [] }] },
] as unknown as Category[];
const KEYS = new Set(['arch', 'fitness']);

async function setup(store = createMemoryStore(), uid = 'alice') {
  const cats = new CategoryStore(uid, store);
  await cats.load();
  return cats;
}

let seq = 0;
function word(o: Partial<PersonalWord> = {}): PersonalWord {
  seq += 1;
  return {
    schemaVersion: 1, id: `pw_${String(seq).padStart(20, '0')}`, article: 'die', lemma: `Probe${seq}`, type: 'n', grammar: '', fa: `آزمایش ${seq}`,
    example: '', exampleFa: '', pronunciationFa: '', placement: null, learned: false, createdAt: seq, updatedAt: seq, source: 'manual', legacyId: null, ...o,
  };
}

describe('model', () => {
  it('ids are stable-format random or deterministic; names fold case, whitespace, umlauts and ß', async () => {
    expect(isCategoryId(newCategoryId())).toBe(true);
    expect(newCategoryId()).not.toBe(newCategoryId());
    expect(await stableCategoryId('legacy:mode')).toBe(await stableCategoryId('legacy:mode'));
    expect(isCategoryId(await stableCategoryId('legacy:mode'))).toBe(true);
    expect(nameKey('  Straße   und  MODE ')).toBe(nameKey('strasse und mode'));
    expect(nameKey('Größe')).toBe(nameKey('GROSSE'));
  });

  it('validation: empty, too long, duplicates under the same parent, rename of itself allowed', () => {
    const siblings = [{ id: 'uc_00000000000000000001', name: 'Reisen' }];
    expect(validateName('   ', siblings)).toBe('empty');
    expect(validateName('x'.repeat(61), siblings)).toBe('too-long');
    expect(validateName(' reisen ', siblings)).toBe('duplicate');
    expect(validateName('REISEN', siblings, 'uc_00000000000000000001')).toBeNull();
    expect(validateName('Reisen', [])).toBeNull();
    expect(isCategoryValue({ name: 'A', parentId: null, sort: 0, deleted: false, createdAt: 1, updatedAt: 1 })).toBe(true);
    expect(isCategoryValue({ name: '', parentId: null, sort: 0, deleted: false, createdAt: 1, updatedAt: 1 })).toBe(false);
  });
});

describe('category store', () => {
  it('creates mains and subs (under own mains and built-in mains); duplicates refused; same name under other parents allowed', async () => {
    const cats = await setup();
    const reisen = cats.create('Reisen', null, KEYS);
    if (!reisen.ok) throw new Error('create');
    expect(cats.create('  reisen ', null, KEYS)).toEqual({ ok: false, error: 'duplicate' });
    expect(cats.create('Flughafen', reisen.category.id, KEYS).ok).toBe(true);
    expect(cats.create('FLUGHAFEN', reisen.category.id, KEYS)).toEqual({ ok: false, error: 'duplicate' });
    // The same name under another parent is fine — also under a built-in category.
    expect(cats.create('Flughafen', 'arch', KEYS).ok).toBe(true);
    expect(cats.create('Flughafen', null, KEYS).ok).toBe(true);
    expect(cats.children('arch').map((c) => c.name)).toEqual(['Flughafen']);
    expect(cats.children(reisen.category.id).map((c) => [c.name, c.parentId])).toEqual([['Flughafen', reisen.category.id]]);
    cats.stop();
  });

  it('refuses invalid parents: a subcategory, an unknown built-in key, a missing category', async () => {
    const cats = await setup();
    const main = cats.create('Reisen', null, KEYS);
    if (!main.ok) throw new Error('create');
    const sub = cats.create('Hotel', main.category.id, KEYS);
    if (!sub.ok) throw new Error('create');
    expect(cats.create('Zimmer', sub.category.id, KEYS)).toEqual({ ok: false, error: 'invalid-parent' }); // only two levels
    expect(cats.create('X', 'unknown', KEYS)).toEqual({ ok: false, error: 'invalid-parent' });
    expect(cats.create('X', 'uc_ffffffffffffffffffff', KEYS)).toEqual({ ok: false, error: 'invalid-parent' });
    cats.stop();
  });

  it('rename keeps the id; delete removes the category and its subs, never words; ensure is idempotent', async () => {
    const cats = await setup();
    const a = cats.ensure('Reisen', null, KEYS);
    const b = cats.ensure(' REISEN ', null, KEYS);
    if (!a.ok || !b.ok) throw new Error('ensure');
    expect(b.category.id).toBe(a.category.id);
    expect(cats.children(null)).toHaveLength(1);
    const renamed = cats.rename(a.category.id, 'Urlaub');
    expect(renamed.ok && renamed.category.id).toBe(a.category.id);
    expect(cats.getSnapshot().byId.get(a.category.id)!.name).toBe('Urlaub');
    cats.create('Hotel', a.category.id, KEYS);
    const removed = cats.remove(a.category.id);
    expect(removed.map((c) => c.name).sort()).toEqual(['Hotel', 'Urlaub']);
    expect(cats.getSnapshot().categories).toEqual([]);
    cats.stop();
  });

  it('a deleted category is never revived: recreating with the same id gets a fresh id', async () => {
    const cats = await setup();
    const id = await stableCategoryId('legacy:x');
    const first = cats.ensure('X', null, KEYS, id);
    expect(first.ok && first.category.id).toBe(id);
    cats.remove(id);
    const again = cats.ensure('X', null, KEYS, id);
    expect(again.ok && again.category.id).not.toBe(id);
    expect(again.ok && isCategoryId(again.category.id)).toBe(true);
    cats.stop();
  });

  it('persists on the device and reloads; accounts are isolated', async () => {
    const local = createMemoryStore();
    const one = await setup(local, 'alice');
    one.create('Reisen', null, KEYS);
    await new Promise((r) => setTimeout(r, 20)); // device write (no cloud in this test)
    one.stop();
    const again = await setup(local, 'alice');
    expect(again.getSnapshot().categories.map((c) => c.name)).toEqual(['Reisen']);
    const bob = await setup(local, 'bob');
    expect(bob.getSnapshot().categories).toEqual([]);
    again.stop();
    bob.stop();
  });
});

describe('catalog and destinations', () => {
  it('built-in mains keep their subs and get the user subs; user mains follow; nothing of the library is changed', async () => {
    const cats = await setup();
    const before = JSON.stringify(LIB);
    cats.create('Eigene', 'arch', KEYS);
    cats.create('Reisen', null, KEYS);
    const catalog = buildCatalog(LIB, cats.getSnapshot().categories);
    expect(catalog.map((m) => [m.name, m.builtIn])).toEqual([['Architektur', true], ['Fitness', true], ['Reisen', false]]);
    expect(catalog[0]!.subs.map((s) => [s.name, s.builtIn])).toEqual([['Grundbegriffe', true], ['Entwurf', true], ['Eigene', false]]);
    expect(JSON.stringify(LIB)).toBe(before);
    cats.stop();
  });

  it('destinations are validated without writing; applied only on commit; retries do not duplicate', async () => {
    const cats = await setup();
    const catalog = () => buildCatalog(LIB, cats.getSnapshot().categories);
    expect(destinationError({ kind: 'newMain', name: '', subName: '' }, catalog())).toMatch(/نام/);
    expect(destinationError({ kind: 'newMain', name: 'Architektur', subName: '' }, catalog())).toMatch(/وجود دارد/);
    expect(destinationError({ kind: 'existing', mainId: 'nope', subId: null }, catalog())).not.toBeNull();
    expect(destinationError({ kind: 'newSub', mainId: 'arch', name: 'grundbegriffe' }, catalog())).toMatch(/وجود دارد/);
    expect(destinationError({ kind: 'newMain', name: 'Reisen', subName: 'Hotel' }, catalog())).toBeNull();
    expect(cats.getSnapshot().categories).toEqual([]); // validation never writes

    const d = { kind: 'newMain', name: 'Reisen', subName: 'Hotel' } as const;
    const first = applyDestination(d, cats, KEYS);
    const second = applyDestination(d, cats, KEYS);
    expect(first).toEqual(second);
    expect(cats.getSnapshot().categories).toHaveLength(2);
    if (!first.ok || !first.placement) throw new Error('apply');
    expect(placementLabel(first.placement, catalog())).toBe('Reisen › Hotel');
    expect(destinationOf(first.placement, catalog())).toEqual({ kind: 'existing', mainId: first.mainId, subId: first.placement.subtab });

    // A subcategory inside a built-in category; "directly in the main"; no category.
    const inArch = applyDestination({ kind: 'newSub', mainId: 'arch', name: 'Holzbau' }, cats, KEYS);
    expect(inArch.ok && inArch.placement!.category).toBe('arch');
    expect(applyDestination({ kind: 'existing', mainId: first.mainId!, subId: null }, cats, KEYS)).toEqual({ ok: true, placement: { category: first.mainId, subtab: DIRECT_SUBTAB }, mainId: first.mainId });
    expect(applyDestination({ kind: 'none' }, cats, KEYS)).toEqual({ ok: true, placement: null, mainId: null });
    // A placement whose category no longer exists resolves to nothing (shown as «دستهٔ نامشخص»).
    expect(resolvePlacement({ category: 'uc_ffffffffffffffffffff', subtab: DIRECT_SUBTAB }, catalog())).toBeNull();
    cats.stop();
  });

  it('browsing: user mains become tabs, user subs become subtabs, words appear where they were placed', async () => {
    const cats = await setup();
    const reisen = cats.create('Reisen', null, KEYS);
    const hotel = reisen.ok ? cats.create('Hotel', reisen.category.id, KEYS) : null;
    const holz = cats.create('Holzbau', 'arch', KEYS);
    if (!reisen.ok || !hotel?.ok || !holz.ok) throw new Error('create');
    const words = [
      word({ article: 'das', lemma: 'Zimmer', placement: { category: reisen.category.id, subtab: hotel.category.id } }),
      word({ article: 'der', lemma: 'Koffer', placement: { category: reisen.category.id, subtab: DIRECT_SUBTAB } }),
      word({ article: 'der', lemma: 'Balken', placement: { category: 'arch', subtab: holz.category.id } }),
      word({ lemma: 'Fuge', placement: { category: 'arch', subtab: 'grund' } }),
      word({ lemma: 'Platzlos' }),
    ];
    const browse = browseCategories(LIB, cats.getSnapshot().categories, words);
    expect(browse.map((c) => c.key)).toEqual(['arch', 'fitness', reisen.category.id]);
    const arch = browse[0]!;
    expect(arch.subtabs.map((s) => s.label)).toEqual(['Grundbegriffe', 'Entwurf', 'Holzbau']);
    expect(arch.subtabs[0]!.groups.at(-1)).toMatchObject({ label: PERSONAL_GROUP_LABEL, entries: [expect.objectContaining({ word: 'die Fuge' })] });
    expect(arch.subtabs[2]!.groups[0]!.entries.map((e) => e.word)).toEqual(['der Balken']);
    expect(browse[1]).toBe(LIB[1]); // untouched categories are the same object
    const own = browse[2]!;
    expect(own).toMatchObject({ label: 'Reisen', theme: 'mine' });
    expect(own.subtabs.map((s) => [s.id, s.label])).toEqual([[hotel.category.id, 'Hotel'], [DIRECT_SUBTAB, 'Meine Wörter']]);
    expect(own.subtabs[1]!.groups[0]!.entries.map((e) => e.word)).toEqual(['der Koffer']);
    // An empty own main still has one (empty) tab.
    cats.create('Leer', null, KEYS);
    const leer = browseCategories(LIB, cats.getSnapshot().categories, []).at(-1)!;
    expect(leer.subtabs.map((s) => s.id)).toEqual([DIRECT_SUBTAB]);
    const counts = countWords(words);
    expect([counts.get(reisen.category.id), counts.get(`${reisen.category.id}|${hotel.category.id}`), counts.get('arch')]).toEqual([2, 1, 2]);
    cats.stop();
  });
});

describe('legacy "my:" categories (first generator version) — compatibility migration', () => {
  it('becomes real categories with deterministic ids; words keep everything else; idempotent; same ids on every device', async () => {
    const legacy = [
      word({ lemma: 'die Jacke', learned: true, placement: { category: 'my:Kleidung', subtab: 'Oberteile' } }),
      word({ lemma: 'der Schuh', placement: { category: 'my:Kleidung', subtab: 'Schuhe' } }),
      word({ lemma: 'die Wand', placement: { category: 'arch', subtab: 'grund' } }),
      word({ lemma: 'frei' }),
    ];
    async function device() {
      const local = createMemoryStore();
      const vocab = new PersonalVocabulary('alice', local);
      await vocab.load();
      await vocab.addMany(legacy);
      const cats = await setup(local);
      return { vocab, cats };
    }
    const a = await device();
    const before = new Map(a.vocab.getSnapshot().words.map((w) => [w.id, w]));
    expect(await migrateLegacyCollections(a.vocab, a.cats)).toBe(2);
    expect(await migrateLegacyCollections(a.vocab, a.cats)).toBe(0); // idempotent
    const main = a.cats.children(null);
    expect(main.map((c) => c.name)).toEqual(['Kleidung']);
    expect(a.cats.children(main[0]!.id).map((c) => c.name).sort()).toEqual(['Oberteile', 'Schuhe']);
    const after = a.vocab.getSnapshot().words;
    expect(after).toHaveLength(4);
    for (const w of after) {
      const old = before.get(w.id)!;
      expect({ ...w, placement: null, updatedAt: 0 }).toEqual({ ...old, placement: null, updatedAt: 0 }); // nothing else changed
    }
    const jacke = after.find((w) => w.lemma === 'die Jacke')!;
    expect(jacke.learned).toBe(true);
    expect(jacke.placement!.category).toBe(main[0]!.id);
    expect(after.find((w) => w.lemma === 'die Wand')!.placement).toEqual({ category: 'arch', subtab: 'grund' });
    expect(after.find((w) => w.lemma === 'frei')!.placement).toBeNull();

    const b = await device();
    await migrateLegacyCollections(b.vocab, b.cats);
    // Same ids AND same createdAt on every device (the rules require createdAt to stay unchanged).
    const docs = (s: CategoryStore) => s.getSnapshot().categories.map((c) => [c.id, c.createdAt]).sort();
    expect(docs(b.cats)).toEqual(docs(a.cats));
    for (const d of [a, b]) { d.vocab.stop(); d.cats.stop(); }
  });
});
