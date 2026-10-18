import { memo } from 'react';
import { WordTypeBadge } from '../../vocabulary/components/WordTypeBadge';
import { GermanExample, WordSpeech } from '../../vocabulary/components/EntryFields';
import type { DuplicateMatch } from '../duplicates';
import type { WordSyncState } from '../../progress/model';
import { displayWord, toEntry, type PersonalWord } from '../model';

interface Props {
  word: PersonalWord;
  duplicates: readonly DuplicateMatch[];
  placementLabel: string | null;
  focused: boolean;
  /** Cloud state of this word (always "synced" in local-only mode, where no badge is shown). */
  syncState: WordSyncState;
  onToggleLearned(id: string, learned: boolean): void;
  onEdit(word: PersonalWord): void;
  onDelete(word: PersonalWord): void;
}

/** One personal word. All text is rendered as React text (never as HTML). */
export const PersonalWordCard = memo(function PersonalWordCard({ word, duplicates, placementLabel, focused, syncState, onToggleLearned, onEdit, onDelete }: Props) {
  const entry = toEntry(word);
  const title = displayWord(word);
  return (
    <article className={`pwc${word.learned ? ' is-learned' : ''}${focused ? ' is-focused' : ''}`} data-personal-id={word.id} aria-label={title} tabIndex={focused ? -1 : undefined}>
      <div className="pwc__head">
        <label className="pwc__learned">
          <input type="checkbox" className="vchk" checked={word.learned} onChange={(e) => onToggleLearned(word.id, e.currentTarget.checked)} aria-label={`یادگرفتم: ${title}`} />
        </label>
        <span className="pwc__word" lang="de" dir="ltr">{title}</span>
        <WordTypeBadge type={word.type} />
        <WordSpeech entry={entry} />
      </div>
      {word.grammar ? <p className="pwc__grammar" lang="de" dir="ltr">{word.grammar}</p> : null}
      {word.fa ? <p className="pwc__fa" lang="fa" dir="rtl">{word.fa}</p> : <p className="pwc__missing" lang="fa" dir="rtl">معنی فارسی هنوز وارد نشده است</p>}
      {word.example ? <p className="pwc__ex"><GermanExample entry={entry} /></p> : null}
      {word.exampleFa ? <p className="pwc__exfa" lang="fa" dir="rtl">{word.exampleFa}</p> : null}
      {word.pronunciationFa ? <p className="pwc__pr" lang="fa" dir="rtl">{word.pronunciationFa}</p> : null}
      <div className="pwc__badges">
        {!word.fa ? <span className="pwc__badge pwc__badge--warn">ناقص</span> : null}
        {syncState === 'pending' ? <span className="pwc__badge" data-sync="pending">در انتظار همگام‌سازی</span> : null}
        {syncState === 'failed' ? <span className="pwc__badge pwc__badge--error" data-sync="failed">در ابر ذخیره نشد</span> : null}
        {duplicates.length ? (
          <span className="pwc__badge pwc__badge--warn" title={duplicates.map((d) => `${d.word} (${d.where})`).join('، ')}>
            تکراری: {duplicates.map((d) => d.where).slice(0, 2).join('، ')}
          </span>
        ) : null}
        {word.source === 'legacy-import' ? <span className="pwc__badge">از نسخهٔ قدیمی</span> : null}
        {placementLabel ? <span className="pwc__badge" lang="de" dir="ltr">{placementLabel}</span> : null}
      </div>
      <div className="pwc__actions">
        <button type="button" className="pwc__btn" onClick={() => onEdit(word)} aria-label={`ویرایش ${title}`}>ویرایش</button>
        <button type="button" className="pwc__btn pwc__btn--danger" onClick={() => onDelete(word)} aria-label={`حذف ${title}`}>حذف</button>
      </div>
    </article>
  );
});
