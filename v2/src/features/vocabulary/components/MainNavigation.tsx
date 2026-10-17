import type { Category } from '../../../models/vocabulary';
import { TabList } from '../../../components/TabList/TabList';

export const MAIN_TABS_PREFIX = 'main';

interface Props {
  categories: readonly Category[];
  /** The active category key. */
  activeId: string;
  onSelect(id: string): void;
}

/** Secondary navigation of the "words" section: the vocabulary categories (WAI-ARIA tabs). */
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
        items={categories.map((c) => ({ id: c.key, content: c.label, dataCategory: c.theme }))}
      />
    </nav>
  );
}
