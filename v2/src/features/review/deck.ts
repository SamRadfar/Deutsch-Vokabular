// Which words a flashcard session contains. Pure functions over the content model, the learned set
// and the review-again list — never over the DOM (the legacy app scraped rendered table rows).

import type { Category, CategoryKey, VocabularyEntry, WordId } from '../../models/vocabulary';
import { categoryName } from '../../models/vocabulary';
import { resolvePlacement, type CatalogMain } from '../categories/catalog';
import { toEntry, type PersonalWord } from '../personal/model';

export type ReviewMode = 'all' | 'unlearned' | 'learned' | 'again';

/** Pseudo category of the user's personal words in decks, search and filters. */
export const PERSONAL_KEY = 'mine';
/** Built-in category, one of the account's own main categories ("uc_…"), or all personal words ("mine"). */
export type PracticeCategoryKey = CategoryKey | typeof PERSONAL_KEY;
export const PERSONAL_LABEL = 'واژه‌های من';
export const REVIEW_MODES: readonly ReviewMode[] = ['all', 'unlearned', 'learned', 'again'];

/** `all` or one category key (including the personal words). */
export type ReviewScope = 'all' | PracticeCategoryKey;

export interface DeckCard {
  entry: VocabularyEntry;
  categoryKey: PracticeCategoryKey;
  categoryLabel: string;
  /** A personal word (its categoryKey is its category, or "mine" without one). */
  personal?: boolean;
  /** Accent theme of the category (CSS `data-category`). */
  theme: string;
  subtabId: string;
  subtabLabel: string;
  /** Position in content order (stable sort key). */
  order: number;
}

/** Personal data a deck may depend on; `null` when it is not available (signed out, loading). */
export interface DeckProgress {
  learned: ReadonlySet<WordId> | null;
  againIds: ReadonlySet<WordId> | null;
}

/** Every built-in entry once, in content order. */
export function flattenCards(categories: readonly Category[]): DeckCard[] {
  const cards: DeckCard[] = [];
  const seen = new Set<WordId>();
  for (const c of categories)
    for (const s of c.subtabs)
      for (const g of s.groups)
        for (const entry of g.entries) {
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          cards.push({ entry, categoryKey: c.key, categoryLabel: categoryName(c.label), theme: c.theme, subtabId: s.id, subtabLabel: s.label, order: cards.length });
        }
  return cards;
}

/** Whether a mode can be used with the personal data at hand. */
export function modeAvailable(mode: ReviewMode, progress: DeckProgress): boolean {
  if (mode === 'all') return true;
  if (mode === 'again') return progress.againIds !== null;
  return progress.learned !== null;
}

export function selectCards(cards: readonly DeckCard[], mode: ReviewMode, scope: ReviewScope, progress: DeckProgress): DeckCard[] {
  if (!modeAvailable(mode, progress)) return [];
  const inScope = scope === 'all' ? cards : cards.filter((c) => inPracticeScope(c, scope));
  switch (mode) {
    case 'all': return [...inScope];
    case 'unlearned': return inScope.filter((c) => !progress.learned!.has(c.entry.id));
    case 'learned': return inScope.filter((c) => progress.learned!.has(c.entry.id));
    case 'again': return inScope.filter((c) => progress.againIds!.has(c.entry.id));
  }
}

/** Fisher–Yates shuffle into a new array. `random` is injectable for deterministic tests. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Session sizes offered in the setup; `null` = every selected word. The legacy app used 30. */
export const SESSION_SIZES: readonly (number | null)[] = [10, 20, 30, 50, null];
export const DEFAULT_SESSION_SIZE = 30;

/** A shuffled deck of at most `size` word ids. */
export function buildDeck(selected: readonly DeckCard[], size: number | null, random?: () => number): WordId[] {
  const ids = shuffle(selected.map((c) => c.entry.id), random);
  return size === null ? ids : ids.slice(0, size);
}

/** A card belongs to a scope by its category, or (personal words) by its user-created category. */
export function inPracticeScope(card: DeckCard, key: PracticeCategoryKey): boolean {
  return key === PERSONAL_KEY ? card.personal === true || card.categoryKey === PERSONAL_KEY : card.categoryKey === key;
}

/**
 * Practice cards for personal words (after the built-in cards in `order`). A word placed in a
 * category (built-in or the account's own) belongs to that category in search, filters and
 * practice; without one it belongs to "my words". Every personal card is also part of "mine".
 */
export function personalCards(words: readonly PersonalWord[], firstOrder: number, catalog: readonly CatalogMain[] = []): DeckCard[] {
  return words.map((w, i) => {
    const r = resolvePlacement(w.placement, catalog);
    return {
      entry: toEntry(w),
      personal: true,
      categoryKey: (r ? r.main.id : PERSONAL_KEY) as PracticeCategoryKey,
      categoryLabel: r ? r.main.name : PERSONAL_LABEL,
      theme: r ? r.main.theme : 'review',
      subtabId: r ? r.sub?.id ?? '_' : PERSONAL_KEY,
      subtabLabel: r ? r.sub?.name ?? 'Meine Wörter' : 'واژه‌های من',
      order: firstOrder + i,
    };
  });
}
