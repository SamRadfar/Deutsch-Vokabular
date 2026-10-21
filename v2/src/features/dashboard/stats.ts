// Dashboard figures, computed only from data the app really has: the bundled content, the learned
// set (synced through Firestore), and the device-local review and shadowing logs. Nothing is
// estimated or invented (no streaks, no "minutes per day").

import type { Category, CategoryKey, WordId } from '../../models/vocabulary';
import { categoryName } from '../../models/vocabulary';
import type { ReviewRecord } from '../review/model';
import type { CatalogMain } from '../categories/catalog';
import type { PersonalWord } from '../personal/model';
import { countCategories, countSubtab, percent } from '../progress/stats';

export interface CategoryProgress {
  key: CategoryKey;
  label: string;
  theme: string;
  total: number;
  learned: number;
  percent: number;
}

export interface LearningOverview {
  total: number;
  learned: number;
  remaining: number;
  percent: number;
  categories: CategoryProgress[];
}

/** `learned` may contain ids that are not built-in content any more; only content ids are counted. */
export function learningOverview(categories: readonly Category[], learned: ReadonlySet<WordId>): LearningOverview {
  const all = countCategories(categories, learned);
  return {
    total: all.total,
    learned: all.learned,
    remaining: all.total - all.learned,
    percent: percent(all),
    categories: categories.map((c) => {
      let total = 0;
      let done = 0;
      for (const s of c.subtabs) { const n = countSubtab(s, learned); total += n.total; done += n.learned; }
      return { key: c.key, label: categoryName(c.label), theme: c.theme, total, learned: done, percent: percent({ total, learned: done }) };
    }),
  };
}

/**
 * The account's own main categories (personal words placed in them; learned = the personal word's
 * own flag). Empty categories are listed too, so the user sees everything they created.
 */
export function ownCategoryProgress(catalog: readonly CatalogMain[], words: readonly PersonalWord[]): CategoryProgress[] {
  return catalog.filter((m) => !m.builtIn).map((m) => {
    const placed = words.filter((w) => w.placement?.category === m.id);
    const learned = placed.filter((w) => w.learned).length;
    return { key: m.id as CategoryKey, label: m.name, theme: m.theme, total: placed.length, learned, percent: percent({ total: placed.length, learned }) };
  });
}

export interface ReviewActivity {
  /** Words answered at least once in flashcards (on this device). */
  reviewedWords: number;
  knowAnswers: number;
  againAnswers: number;
  /** Current "review again" list. */
  againList: number;
  lastReviewedAt: number | null;
}

export function reviewActivity(records: ReadonlyMap<WordId, ReviewRecord>, knownIds: ReadonlySet<WordId>): ReviewActivity {
  let reviewedWords = 0;
  let knowAnswers = 0;
  let againAnswers = 0;
  let againList = 0;
  let last: number | null = null;
  for (const r of records.values()) {
    if (!knownIds.has(r.wordId)) continue;
    reviewedWords++;
    knowAnswers += r.knowCount;
    againAnswers += r.againCount;
    if (r.lastResult === 'again') againList++;
    if (last === null || r.lastReviewedAt > last) last = r.lastReviewedAt;
  }
  return { reviewedWords, knowAnswers, againAnswers, againList, lastReviewedAt: last };
}
