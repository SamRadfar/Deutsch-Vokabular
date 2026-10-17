import { memo, useState } from 'react';
import type { WordId } from '../../models/vocabulary';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { WordTypeBadge } from '../vocabulary/components/WordTypeBadge';
import { LearnedCheckbox, type EntryProgress } from '../vocabulary/components/LearnedCheckbox';
import { WordSpeech } from '../vocabulary/components/EntryFields';
import type { DeckCard } from '../review/deck';
import { Highlight } from './Highlight';
import type { SearchHit } from './searchIndex';

const PAGE = 50;

interface Props {
  hits: readonly SearchHit[];
  query: string;
  progress: EntryProgress | undefined;
  /** The learned flag per id, so a result card re-renders only when its own state changes. */
  learnedOf(id: WordId): boolean;
  onShow(card: DeckCard): void;
}

/** Search/filter results across all categories; rendered in pages of 50 to stay fast on phones. */
export function SearchResults({ hits, query, progress, learnedOf, onShow }: Props) {
  const [limit, setLimit] = useState(PAGE);
  if (!hits.length) {
    return (
      <EmptyState
        title={query.trim() ? `برای «${query.trim()}» واژه‌ای پیدا نشد` : 'با این فیلترها واژه‌ای پیدا نشد'}
        description="املای دیگری را امتحان کنید (مثلاً بدون حرف تعریف یا با ss به‌جای ß) یا فیلترها را پاک کنید."
      />
    );
  }
  const shown = hits.slice(0, limit);
  return (
    <div className="sresults" lang="fa" dir="rtl">
      <ul className="sresults__list" aria-label="نتیجه‌های جستجو">
        {shown.map((h) => (
          <li key={h.card.entry.id}>
            <ResultCard hit={h} progress={progress} learned={learnedOf(h.card.entry.id)} syncState={progress?.stateOf(h.card.entry.id) ?? 'synced'} onShow={onShow} />
          </li>
        ))}
      </ul>
      {hits.length > limit ? (
        <button type="button" className="fc-secondary sresults__more" onClick={() => setLimit((n) => n + PAGE)}>
          نمایش {Math.min(PAGE, hits.length - limit)} نتیجهٔ بیشتر ({limit} از {hits.length})
        </button>
      ) : null}
    </div>
  );
}

interface CardProps {
  hit: SearchHit;
  progress: EntryProgress | undefined;
  learned: boolean;
  syncState: string;
  onShow(card: DeckCard): void;
}

const ResultCard = memo(function ResultCard({ hit, progress, learned, onShow }: CardProps) {
  const { card, ranges } = hit;
  const e = card.entry;
  return (
    <article className={`sres${learned ? ' is-learned' : ''}`} data-entry-id={e.id} data-category={card.theme} aria-label={e.word}>
      <div className="sres__head">
        {progress ? <LearnedCheckbox entryId={e.id} word={e.word} progress={progress} /> : null}
        <span className="sres__word" lang="de" dir="ltr"><Highlight text={e.word} ranges={ranges.word} /></span>
        <WordTypeBadge type={e.type} />
        <WordSpeech entry={e} />
      </div>
      <p className="sres__fa" lang="fa" dir="rtl"><Highlight text={e.fa} ranges={ranges.fa} /></p>
      <p className="sres__ex" lang="de" dir="ltr"><Highlight text={e.example} ranges={ranges.example} /></p>
      {ranges.exampleFa ? <p className="sres__exfa" lang="fa" dir="rtl"><Highlight text={e.exampleFa} ranges={ranges.exampleFa} /></p> : null}
      <div className="sres__foot">
        <span className="sres__crumb" lang="de" dir="ltr">{card.categoryLabel} › {card.subtabLabel}</span>
        <button type="button" className="sres__show" onClick={() => onShow(card)}>نمایش در فهرست</button>
      </div>
    </article>
  );
  // The progress object changes with every sync snapshot; a card only needs to re-render when its own
  // word's learned/sync state changes (its setLearned always reaches the same engine).
}, (a, b) => a.hit === b.hit && a.learned === b.learned && a.syncState === b.syncState && !!a.progress === !!b.progress);
