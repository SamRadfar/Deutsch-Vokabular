import type { Category, CategoryKey } from '../../../models/vocabulary';
import { TabList } from '../../../components/TabList/TabList';

export const MAIN_TABS_PREFIX = 'main';

interface Props {
  categories: readonly Category[];
  activeKey: CategoryKey;
  onSelect(key: CategoryKey): void;
}

export function MainNavigation({ categories, activeKey, onSelect }: Props) {
  return (
    <nav aria-label="Kategorien">
      <TabList
        label="Kategorien"
        idPrefix={MAIN_TABS_PREFIX}
        className="mtabs"
        tabClassName="mbtn"
        selectedId={activeKey}
        onSelect={(id) => onSelect(id as CategoryKey)}
        items={categories.map((c) => ({ id: c.key, content: c.label, dataCategory: c.theme }))}
      />
    </nav>
  );
}
