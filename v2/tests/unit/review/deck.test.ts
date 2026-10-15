import { describe, expect, it } from 'vitest';
import { getVocabularyRepository } from '../../../src/services/content/vocabularyRepository';
import { buildDeck, flattenCards, modeAvailable, selectCards, shuffle } from '../../../src/features/review/deck';

const repo = getVocabularyRepository();
const cards = flattenCards(repo.categories);
const archIds = cards.filter((c) => c.categoryKey === 'arch').map((c) => c.entry.id);
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

describe('flashcard decks', () => {
  it('uses every one of the 999 built-in entries exactly once, with its stable id and category', () => {
    expect(cards).toHaveLength(999);
    expect(new Set(cards.map((c) => c.entry.id)).size).toBe(999);
    const first = repo.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!;
    expect(cards[0]).toMatchObject({ entry: first, categoryKey: 'arch', subtabLabel: repo.categories[0]!.subtabs[0]!.label });
    // The content objects are reused, not copied or changed.
    expect(cards[0]!.entry).toBe(repo.getEntry(first.id));
  });

  it('modes: all, unlearned, learned, review-again — optionally limited to one category', () => {
    const learned = new Set([archIds[0]!, archIds[1]!, cards.at(-1)!.entry.id]);
    const againIds = new Set([archIds[2]!]);
    const p = { learned, againIds };
    expect(selectCards(cards, 'all', 'all', p)).toHaveLength(999);
    expect(selectCards(cards, 'learned', 'all', p)).toHaveLength(3);
    expect(selectCards(cards, 'unlearned', 'all', p)).toHaveLength(996);
    expect(selectCards(cards, 'again', 'all', p).map((c) => c.entry.id)).toEqual([archIds[2]]);
    expect(selectCards(cards, 'all', 'arch', p)).toHaveLength(archIds.length);
    expect(selectCards(cards, 'learned', 'arch', p).map((c) => c.entry.id)).toEqual([archIds[0], archIds[1]]);
    expect(selectCards(cards, 'unlearned', 'arch', p)).toHaveLength(archIds.length - 2);
    expect(selectCards(cards, 'again', 'fitness', p)).toEqual([]);
  });

  it('personal modes need progress data (signed out: only "all")', () => {
    const none = { learned: null, againIds: null };
    expect(modeAvailable('all', none)).toBe(true);
    expect(['unlearned', 'learned', 'again'].map((m) => modeAvailable(m as never, none))).toEqual([false, false, false]);
    expect(selectCards(cards, 'unlearned', 'all', none)).toEqual([]);
  });

  it('shuffle is a permutation and deterministic for a given random source', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const a = shuffle(items, seeded(7));
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toEqual(items);
    expect(shuffle(items, seeded(7))).toEqual(a);
    expect(items[0]).toBe(0); // input untouched
  });

  it('a deck has at most `size` unique words; null = all selected words', () => {
    const selected = selectCards(cards, 'all', 'arch', { learned: null, againIds: null });
    const deck = buildDeck(selected, 30, seeded(3));
    expect(deck).toHaveLength(30);
    expect(new Set(deck).size).toBe(30);
    expect(deck.every((id) => archIds.includes(id))).toBe(true);
    expect(buildDeck(selected, null, seeded(3))).toHaveLength(archIds.length);
    expect(buildDeck(selected.slice(0, 4), 30)).toHaveLength(4);
  });
});
