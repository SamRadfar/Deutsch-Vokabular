import { useCallback, useState } from 'react';
import type { Category, CategoryKey } from '../../models/vocabulary';

/**
 * Navigation state held in React (not read from the DOM): the active category and the
 * remembered subtab per category. Starts on the first category/subtab like the legacy app.
 * An empty library (an account without built-in categories) has no active category.
 */
export function useVocabularyNavigation(categories: readonly Category[]) {
  const first = categories[0];
  const [activeKey, setActiveKey] = useState<CategoryKey | undefined>(first?.key);
  const [subtabByCategory, setSubtabByCategory] = useState<Partial<Record<CategoryKey, string>>>({});

  const activeCategory: Category | undefined = categories.find((c) => c.key === activeKey) ?? first;
  // A remembered subtab that no longer exists (e.g. a deleted own subcategory) falls back to the first.
  const remembered = activeCategory ? subtabByCategory[activeCategory.key] : undefined;
  const activeSubtabId = activeCategory
    ? (remembered && activeCategory.subtabs.some((s) => s.id === remembered) ? remembered : activeCategory.subtabs[0]?.id ?? '')
    : '';

  const selectSubtab = useCallback(
    (id: string) => { if (activeCategory) setSubtabByCategory((prev) => ({ ...prev, [activeCategory.key]: id })); },
    [activeCategory],
  );

  /** Opens a category on a given subtab (e.g. "show in list" from search). */
  const show = useCallback((key: CategoryKey, subtabId: string) => {
    setActiveKey(key);
    setSubtabByCategory((prev) => ({ ...prev, [key]: subtabId }));
  }, []);

  const selectCategory = useCallback((key: CategoryKey) => setActiveKey(key), []);
  return { activeCategory, activeSubtabId, selectCategory, selectSubtab, show };
}
