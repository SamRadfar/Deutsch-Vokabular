import type { Category } from '../../models/vocabulary';
import { toEntry, type PersonalWord } from './model';

/** Legacy group label of personal words inside a category table. */
export const PERSONAL_GROUP_LABEL = 'Meine Wörter · واژه‌های من';

/**
 * A category with the user's personal words that were placed in it appended as one extra group
 * per subtab (legacy behaviour). The built-in content object is never modified: a new object is
 * returned only when something is added.
 */
export function withPersonalGroups(category: Category, words: readonly PersonalWord[]): Category {
  const placed = words.filter((w) => w.placement?.category === category.key);
  if (!placed.length) return category;
  return {
    ...category,
    subtabs: category.subtabs.map((s) => {
      const mine = placed.filter((w) => w.placement!.subtab === s.id).sort((a, b) => a.createdAt - b.createdAt);
      return mine.length ? { ...s, groups: [...s.groups, { label: PERSONAL_GROUP_LABEL, entries: mine.map(toEntry) }] } : s;
    }),
  };
}
