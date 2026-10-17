import './vocabulary.css';
import type { Category, TechnicalInfo } from '../../../models/vocabulary';
import { TabList, panelElementId, tabElementId } from '../../../components/TabList/TabList';
import { countSubtab } from '../../progress/stats';
import { SubtabPanel, countEntries } from './SubtabPanel';
import type { EntryProgress } from './LearnedCheckbox';

interface Props {
  category: Category;
  activeSubtabId: string;
  onSelectSubtab(id: string): void;
  getTechnicalInfo(id: string): TechnicalInfo | undefined;
  progress?: EntryProgress | undefined;
  learned?: ReadonlySet<string> | undefined;
  focusEntryId?: string | null | undefined;
}

/** Subtab navigation + the active subtab panel, inside the category's accent scope. */
export function CategoryView({ category, activeSubtabId, onSelectSubtab, getTechnicalInfo, progress, learned, focusEntryId }: Props) {
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
        items={category.subtabs.map((s) => {
          const total = countEntries(s);
          // Legacy counter: "done/total" once something is learned, otherwise just the total.
          const done = learned ? countSubtab(s, learned).learned : 0;
          const text = done > 0 ? `${done}/${total}` : String(total);
          return {
            id: s.id,
            content: (
              <>
                <span aria-hidden="true">{s.icon}</span> {s.label}{' '}
                <span className="sctr" aria-label={done > 0 ? `${done} von ${total} gelernt` : `${total} Wörter`}>{text}</span>
              </>
            ),
          };
        })}
      />
      <div role="tabpanel" id={panelElementId(prefix, subtab.id)} aria-labelledby={tabElementId(prefix, subtab.id)} tabIndex={0}>
        <SubtabPanel key={subtab.id} subtab={subtab} getTechnicalInfo={getTechnicalInfo} progress={progress} learned={learned} focusEntryId={focusEntryId} />
      </div>
    </div>
  );
}
