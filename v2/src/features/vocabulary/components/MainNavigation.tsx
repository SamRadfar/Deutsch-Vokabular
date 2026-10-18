import type { Category } from '../../../models/vocabulary';
import { TabList } from '../../../components/TabList/TabList';
import { categoryName } from '../../../models/vocabulary';
import { categoryIcon } from '../categoryIcons';

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
        items={categories.map((c) => {
          const Icon = categoryIcon(c.key);
          return { id: c.key, content: <>{Icon ? <Icon className="mbtn__icon" /> : null}{categoryName(c.label)}</>, dataCategory: c.theme };
        })}
      />
    </nav>
  );
}
