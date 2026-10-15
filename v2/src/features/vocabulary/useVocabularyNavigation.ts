import { useCallback, useState } from 'react';
import type { Category, CategoryKey } from '../../models/vocabulary';

/**
 * Navigation state held in React (not read from the DOM): the active category and the
 * remembered subtab per category. Starts on the first category/subtab like the legacy app.
 */
export function useVocabularyNavigation(categories: readonly Category[]) {
  const first = categories[0];
  if (!first) throw new Error('No categories');
  const [activeKey, setActiveKey] = useState<CategoryKey>(first.key);
  const [subtabByCategory, setSubtabByCategory] = useState<Partial<Record<CategoryKey, string>>>({});

  const activeCategory = categories.find((c) => c.key === activeKey) ?? first;
  const activeSubtabId = subtabByCategory[activeCategory.key] ?? activeCategory.subtabs[0]?.id ?? '';

  const selectSubtab = useCallback(
    (id: string) => setSubtabByCategory((prev) => ({ ...prev, [activeKey]: id })),
    [activeKey],
  );

  return { activeCategory, activeSubtabId, selectCategory: setActiveKey, selectSubtab };
}
