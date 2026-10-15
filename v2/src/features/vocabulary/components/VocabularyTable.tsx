import { Fragment } from 'react';
import type { TechnicalInfo, VocabularyEntry, VocabularyGroup } from '../../../models/vocabulary';
import { WordTypeBadge } from './WordTypeBadge';
import { TechnicalInfoPanel, TechnicalInfoToggle } from './TechnicalInfoPanel';
import {
  ExampleTranslation, GermanExample, GermanWord, PersianMeaning, PersianPronunciation, WordSpeech,
} from './EntryFields';

export interface EntryListProps {
  groups: readonly VocabularyGroup[];
  getTechnicalInfo(id: string): TechnicalInfo | undefined;
  openInfoId: string | null;
  onToggleInfo(id: string): void;
  caption: string;
}

const COLUMNS = 7;

/** Desktop layout: one <tbody> per group, headed by a group row (legacy .grp). */
export function VocabularyTable({ groups, getTechnicalInfo, openInfoId, onToggleInfo, caption }: EntryListProps) {
  return (
    <div className="tscr">
      <table className="vtable">
        <caption className="visually-hidden">{caption}</caption>
        <colgroup>
          <col className="c-word" /><col className="c-type" /><col className="c-fa" /><col className="c-ex" />
          <col className="c-tr" /><col className="c-pr" /><col className="c-spk" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Wort</th>
            <th scope="col">Wortart</th>
            <th scope="col" className="rh" lang="fa" dir="rtl">فارسی</th>
            <th scope="col">Beispiel auf Deutsch</th>
            <th scope="col" className="rh" lang="fa" dir="rtl">ترجمه مثال</th>
            <th scope="col" className="rh" lang="fa" dir="rtl">تلفظ فارسی</th>
            <th scope="col" className="c-spk-h"><span aria-hidden="true">🔊</span><span className="visually-hidden">Aussprache</span></th>
          </tr>
        </thead>
        {groups.map((group, gi) => (
          <tbody key={`${gi}-${group.label}`}>
            <tr className="grp">
              <th scope="colgroup" colSpan={COLUMNS}>{group.label}</th>
            </tr>
            {group.entries.map((entry) => (
              <VocabularyRow
                key={entry.id}
                entry={entry}
                info={getTechnicalInfo(entry.id)}
                infoOpen={openInfoId === entry.id}
                onToggleInfo={() => onToggleInfo(entry.id)}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

interface RowProps {
  entry: VocabularyEntry;
  info: TechnicalInfo | undefined;
  infoOpen: boolean;
  onToggleInfo(): void;
}

export function VocabularyRow({ entry, info, infoOpen, onToggleInfo }: RowProps) {
  return (
    <Fragment>
      <tr className="vrow" data-entry-id={entry.id}>
        <th scope="row" className="td-word"><GermanWord entry={entry} /></th>
        <td className="td-type">
          <WordTypeBadge type={entry.type} />
          {info ? <TechnicalInfoToggle entryId={entry.id} open={infoOpen} onToggle={onToggleInfo} /> : null}
        </td>
        <td className="td-fa"><PersianMeaning entry={entry} /></td>
        <td className="td-ex"><GermanExample entry={entry} /></td>
        <td className="td-tr"><ExampleTranslation entry={entry} /></td>
        <td className="td-pr"><PersianPronunciation entry={entry} /></td>
        <td className="td-spk"><WordSpeech entry={entry} /></td>
      </tr>
      {info && infoOpen ? (
        <tr className="info-row">
          <td colSpan={COLUMNS}><TechnicalInfoPanel entryId={entry.id} info={info} /></td>
        </tr>
      ) : null}
    </Fragment>
  );
}
