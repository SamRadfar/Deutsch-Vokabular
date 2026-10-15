import './vocabulary.css';
import type { Category, TechnicalInfo } from '../../../models/vocabulary';
import { TabList, panelElementId, tabElementId } from '../../../components/TabList/TabList';
import { SubtabPanel, countEntries } from './SubtabPanel';

interface Props {
  category: Category;
  activeSubtabId: string;
  onSelectSubtab(id: string): void;
  getTechnicalInfo(id: string): TechnicalInfo | undefined;
}

/** Subtab navigation + the active subtab panel, inside the category's accent scope. */
export function CategoryView({ category, activeSubtabId, onSelectSubtab, getTechnicalInfo }: Props) {
  const subtab = category.subtabs.find((s) => s.id === activeSubtabId) ?? category.subtabs[0];
  if (!subtab) return null;
  const prefix = `sub-${category.key}`;
  return (
    <div className="stw" data-category={category.theme}>
      <TabList
        label={`${category.label}: Unterbereiche`}
        idPrefix={prefix}
        className="stnav"
        tabClassName="sbtn"
        selectedId={subtab.id}
        onSelect={onSelectSubtab}
        items={category.subtabs.map((s) => ({
          id: s.id,
          content: (
            <>
              <span aria-hidden="true">{s.icon}</span> {s.label}{' '}
              <span className="sctr" aria-label={`${countEntries(s)} Wörter`}>{countEntries(s)}</span>
            </>
          ),
        }))}
      />
      <div role="tabpanel" id={panelElementId(prefix, subtab.id)} aria-labelledby={tabElementId(prefix, subtab.id)} tabIndex={0}>
        <SubtabPanel key={subtab.id} subtab={subtab} getTechnicalInfo={getTechnicalInfo} />
      </div>
    </div>
  );
}
