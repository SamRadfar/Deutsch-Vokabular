import { useEffect, useRef } from 'react';
import type { WordId } from '../../../models/vocabulary';
import type { DeckCard } from '../deck';
import type { SessionSummary as Summary } from '../session';

interface Props {
  summary: Summary;
  cardsById: ReadonlyMap<WordId, DeckCard>;
  /** Results are saved for a signed-in user; otherwise they only lived in this session. */
  saving: boolean;
  newlyLearned: number;
  onRepeatAgain(): void;
  onRestart(): void;
  onNewSession(): void;
}

function verdict({ percent, known, total, unanswered }: Summary) {
  if (total === unanswered) return { emoji: '👋', title: 'جلسه بدون پاسخ تمام شد' };
  if (percent === 100 && known === total) return { emoji: '🏆', title: 'بی‌نقص!' };
  if (percent >= 70) return { emoji: '🎉', title: 'آفرین!' };
  if (percent >= 40) return { emoji: '💪', title: 'خوب پیش می‌روی' };
  return { emoji: '📚', title: 'بیشتر تمرین کن' };
}

export function SessionSummary({ summary, cardsById, saving, newlyLearned, onRepeatAgain, onRestart, onNewSession }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const v = verdict(summary);

  return (
    <section className="fc-summary" aria-labelledby="fc-summary-title" lang="fa" dir="rtl">
      <p className="fc-summary__emoji" aria-hidden="true">{v.emoji}</p>
      <h2 id="fc-summary-title" ref={heading} tabIndex={-1}>{v.title}</h2>
      <dl className="fc-stats">
        <div className="fc-stat fc-stat--know"><dt>بلدم</dt><dd data-testid="summary-know">{summary.known}</dd></div>
        <div className="fc-stat fc-stat--again"><dt>بلد نیستم</dt><dd data-testid="summary-again">{summary.again}</dd></div>
        <div className="fc-stat"><dt>بی‌پاسخ</dt><dd data-testid="summary-unanswered">{summary.unanswered}</dd></div>
        <div className="fc-stat"><dt>درصد درست</dt><dd><span dir="ltr">{summary.percent}%</span></dd></div>
      </dl>

      {saving ? (
        <p className="fc-note" role="status">
          {newlyLearned > 0 ? `${newlyLearned} واژه به یادگرفته‌ها اضافه شد. ` : ''}
          {summary.again > 0 ? `${summary.again} واژه در فهرست «مرور دوباره» ذخیره شد.` : ''}
          {newlyLearned === 0 && summary.again === 0 ? 'نتیجه‌ها ذخیره شد.' : ''}
        </p>
      ) : (
        <p className="fc-note fc-note--warn" role="status">نتیجه‌های این جلسه ذخیره نشد؛ برای ذخیرهٔ پیشرفت وارد حساب شوید.</p>
      )}

      {summary.againIds.length > 0 ? (
        <details className="fc-missed" open={summary.againIds.length <= 10}>
          <summary>واژه‌هایی که بلد نبودی ({summary.againIds.length})</summary>
          <ul>
            {summary.againIds.map((id) => {
              const c = cardsById.get(id);
              return c ? (
                <li key={id}><span lang="de" dir="ltr">{c.entry.word}</span> <span className="fc-missed__fa">{c.entry.fa}</span></li>
              ) : null;
            })}
          </ul>
        </details>
      ) : null}

      <div className="fc-summary__actions">
        {summary.againIds.length > 0 ? (
          <button type="button" className="fc-primary" onClick={onRepeatAgain}>
            مرور دوبارهٔ کارت‌های نادانسته ({summary.againIds.length})
          </button>
        ) : null}
        <button type="button" className={summary.againIds.length > 0 ? 'fc-secondary' : 'fc-primary'} onClick={onRestart}>
          شروع دوبارهٔ همین جلسه ({summary.total} کارت)
        </button>
        <button type="button" className="fc-secondary" onClick={onNewSession}>تنظیم جلسهٔ جدید</button>
      </div>
    </section>
  );
}
