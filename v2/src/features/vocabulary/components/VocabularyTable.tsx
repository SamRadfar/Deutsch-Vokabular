import { Check, Volume2 } from 'lucide-react';
import { Fragment } from 'react';
import type { TechnicalInfo, VocabularyEntry, VocabularyGroup } from '../../../models/vocabulary';
import { WordTypeBadge } from './WordTypeBadge';
import { TechnicalInfoPanel, TechnicalInfoToggle } from './TechnicalInfoPanel';
import { LearnedCheckbox, type EntryProgress } from './LearnedCheckbox';
import {
  ExampleTranslation, GermanExample, GermanWord, PersianMeaning, PersianPronunciation, WordSpeech,
} from './EntryFields';

export interface EntryListProps {
  groups: readonly VocabularyGroup[];
  getTechnicalInfo(id: string): TechnicalInfo | undefined;
  openInfoId: string | null;
  onToggleInfo(id: string): void;
  caption: string;
  /** Present only when the user is signed in and progress is loaded; otherwise no ✓ column. */
  progress?: EntryProgress | undefined;
  /** Entry opened from search ("show in list"): highlighted and focusable. */
  focusEntryId?: string | null | undefined;
}

/** Desktop layout: one <tbody> per group, headed by a group row (legacy .grp). */
export function VocabularyTable({ groups, getTechnicalInfo, openInfoId, onToggleInfo, caption, progress, focusEntryId }: EntryListProps) {
  const columns = progress ? 8 : 7;
  return (
    <div className="tscr">
      <table className="vtable">
        <caption className="visually-hidden">{caption}</caption>
        <colgroup>
          {progress ? <col className="c-chk" /> : null}
          <col className="c-word" /><col className="c-type" /><col className="c-fa" /><col className="c-ex" />
          <col className="c-tr" /><col className="c-pr" /><col className="c-spk" />
        </colgroup>
        <thead>
          <tr>
            {progress ? <th scope="col" className="c-chk-h"><Check /><span className="visually-hidden">یادگرفتم</span></th> : null}
            <th scope="col">Wort</th>
            <th scope="col">Wortart</th>
            <th scope="col" className="rh" lang="fa" dir="rtl">فارسی</th>
            <th scope="col">Beispiel auf Deutsch</th>
            <th scope="col" className="rh" lang="fa" dir="rtl">ترجمه مثال</th>
            <th scope="col" className="rh" lang="fa" dir="rtl">تلفظ فارسی</th>
            <th scope="col" className="c-spk-h"><Volume2 /><span className="visually-hidden">Aussprache</span></th>
          </tr>
        </thead>
        {groups.map((group, gi) => (
          <tbody key={`${gi}-${group.label}`}>
            <tr className="grp">
              <th scope="colgroup" colSpan={columns}>{group.label}</th>
            </tr>
            {group.entries.map((entry) => (
              <VocabularyRow
                key={entry.id}
                entry={entry}
                info={getTechnicalInfo(entry.id)}
                infoOpen={openInfoId === entry.id}
                onToggleInfo={() => onToggleInfo(entry.id)}
                progress={progress}
                columns={columns}
                focused={focusEntryId === entry.id}
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
  progress: EntryProgress | undefined;
  columns: number;
  focused?: boolean;
}

export function VocabularyRow({ entry, info, infoOpen, onToggleInfo, progress, columns, focused = false }: RowProps) {
  const learned = progress?.isLearned(entry.id) ?? false;
  return (
    <Fragment>
      <tr className={`vrow${learned ? ' is-learned' : ''}${focused ? ' is-focused' : ''}`} data-entry-id={entry.id} tabIndex={focused ? -1 : undefined}>
        {progress ? <td className="td-chk"><LearnedCheckbox entryId={entry.id} word={entry.word} progress={progress} /></td> : null}
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
          <td colSpan={columns}><TechnicalInfoPanel entryId={entry.id} info={info} /></td>
        </tr>
      ) : null}
    </Fragment>
  );
}
