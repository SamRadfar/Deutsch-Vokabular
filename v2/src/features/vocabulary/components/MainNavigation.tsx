import type { Category } from '../../../models/vocabulary';
import { TabList } from '../../../components/TabList/TabList';

export const MAIN_TABS_PREFIX = 'main';
/** Id of the flashcard review tab, next to the category tabs (legacy "🔄 مرور"). */
export const REVIEW_TAB_ID = 'review';

interface Props {
  categories: readonly Category[];
  /** A category key or REVIEW_TAB_ID. */
  activeId: string;
  onSelect(id: string): void;
}

export function MainNavigation({ categories, activeId, onSelect }: Props) {
  return (
    <nav aria-label="Kategorien">
      <TabList
        label="Kategorien"
        idPrefix={MAIN_TABS_PREFIX}
        className="mtabs"
        tabClassName="mbtn"
        selectedId={activeId}
        onSelect={onSelect}
        items={[
          ...categories.map((c) => ({ id: c.key, content: c.label, dataCategory: c.theme })),
          { id: REVIEW_TAB_ID, content: <span lang="fa">🔄 مرور</span>, dataCategory: 'review' },
        ]}
      />
    </nav>
  );
}
