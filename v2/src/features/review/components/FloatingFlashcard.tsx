import { ArrowLeft, ArrowRight, Check, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, type MouseEvent } from 'react';
import { WordTypeBadge } from '../../vocabulary/components/WordTypeBadge';
import { WordSpeech } from '../../vocabulary/components/EntryFields';
import type { DeckCard } from '../deck';
import type { ReviewResult } from '../model';
import type { SessionAction, SessionState, SessionSummary } from '../session';

interface Props {
  state: SessionState;
  card: DeckCard;
  /** The SAME handlers as the review page (one session, one backend, no second progress system). */
  onAnswer(result: ReviewResult): void;
  dispatch(action: SessionAction): void;
}

/**
 * The flashcard of the floating review window (Document Picture-in-Picture, ≈ 340 × 420). It never
 * advances by itself: the user flips, rates («بلدم» / «دوباره») or moves with «قبلی» / «بعدی» —
 * navigation never rates a card. Keys work only while this window has focus (its own document).
 */
export function FloatingFlashcard({ state, card, onAnswer, dispatch }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onAnswer, dispatch });
  handlers.current = { onAnswer, dispatch };
  const { entry } = card;
  const total = state.cards.length;
  const answered = Object.keys(state.answers).length;
  let known = 0;
  for (const r of Object.values(state.answers)) if (r === 'know') known++;
  const previous = state.answers[entry.id];

  // Keyboard inside the floating window only (the main page has its own shortcuts; other
  // applications never see these listeners).
  useEffect(() => {
    const doc = root.current?.ownerDocument;
    if (!doc || doc === document) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const h = handlers.current;
      const onButton = e.target instanceof Element && e.target.closest('button');
      if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') && !onButton) { e.preventDefault(); if (!e.repeat) h.dispatch({ type: 'flip' }); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); h.dispatch({ type: 'next' }); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); h.dispatch({ type: 'previous' }); }
      else if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.repeat) { e.preventDefault(); h.onAnswer('again'); }
      else if ((e.code === 'Digit2' || e.code === 'Numpad2') && !e.repeat) { e.preventDefault(); h.onAnswer('know'); }
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, []);

  const onCard = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return; // pronunciation button inside the card
    dispatch({ type: 'flip' });
  };

  return (
    <div ref={root} className="rf" data-category={card.theme} data-testid="rf-card" data-entry-id={entry.id} data-side={state.flipped ? 'back' : 'front'}
      lang="fa" dir="rtl" role="region" aria-label="کارت شناور مرور">
      <div className="rf__top">
        <span className="sh-float__pos" dir="ltr" data-testid="rf-pos">{state.index + 1} / {total}</span>
        <span className="rf__meta" lang="de" dir="ltr" title={`${card.categoryLabel} · ${card.subtabLabel}`}>{card.categoryLabel} · {card.subtabLabel}</span>
      </div>
      <div className="sh-float__progress" role="progressbar" aria-label="پاسخ‌داده‌شده" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
        <span style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
      </div>
      <p className="rf__tally" data-testid="rf-tally">
        <span className="fc-tally__know"><Check aria-hidden="true" /> {known}</span>
        <span className="fc-tally__again"><X aria-hidden="true" /> {answered - known}</span>
      </p>

      <div className={`rf__card${state.flipped ? ' is-flipped' : ''}`} onClick={onCard} data-testid="rf-face">
        {state.flipped ? (
          <div className="rf__back">
            <p className="rf__word rf__word--small" lang="de" dir="ltr">{entry.word}</p>
            <p className="rf__fa" data-testid="rf-fa">{entry.fa}</p>
            <p className="rf__gram"><WordTypeBadge type={entry.type} />{entry.pronunciationFa ? <span className="v-pr" lang="fa" dir="rtl">{entry.pronunciationFa}</span> : null}</p>
            {entry.example ? <p className="rf__ex" lang="de" dir="ltr">{entry.example}</p> : null}
            {entry.exampleFa ? <p className="rf__exfa" data-testid="rf-exfa">{entry.exampleFa}</p> : null}
          </div>
        ) : (
          <div className="rf__front">
            <p className="rf__word" lang="de" dir="ltr" data-testid="rf-word">{entry.word}</p>
            <p className="rf__gram"><WordTypeBadge type={entry.type} /><WordSpeech entry={entry} /></p>
            <p className="rf__tap" aria-hidden="true">برای دیدن معنی، روی کارت بزنید</p>
          </div>
        )}
      </div>
      {previous ? <p className={`rf__prev fc-previous--${previous}`}>پاسخ شما: {previous === 'know' ? 'بلدم' : 'دوباره'}</p> : null}

      <button type="button" className="rf__flip" data-testid="rf-flip" onClick={() => dispatch({ type: 'flip' })} aria-pressed={state.flipped}>
        {state.flipped ? 'نمایش واژهٔ آلمانی' : 'نمایش معنی'}
      </button>
      <div className="rf__answers" dir="ltr">
        <button type="button" className="fc-answer fc-answer--again" data-testid="rf-again" onClick={() => onAnswer('again')}>
          <span className="fc-answer__main"><X aria-hidden="true" /> <span lang="fa">دوباره</span></span>
        </button>
        <button type="button" className="fc-answer fc-answer--know" data-testid="rf-know" onClick={() => onAnswer('know')}>
          <span className="fc-answer__main"><Check aria-hidden="true" /> <span lang="fa">بلدم</span></span>
        </button>
      </div>
      <div className="rf__nav" dir="ltr">
        <button type="button" onClick={() => dispatch({ type: 'previous' })} disabled={state.index === 0} aria-label="کارت قبلی" data-testid="rf-prev"><ArrowLeft aria-hidden="true" /><span lang="fa">قبلی</span></button>
        <button type="button" onClick={() => dispatch({ type: 'next' })} disabled={state.index >= total - 1} aria-label="کارت بعدی" data-testid="rf-next"><span lang="fa">بعدی</span><ArrowRight aria-hidden="true" /></button>
      </div>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">{state.flipped ? `معنی: ${entry.fa}` : `کارت ${state.index + 1} از ${total}: ${entry.word}`}</p>
    </div>
  );
}

/** The floating window after the last card: the session result, without leaving the window. */
export function FloatingReviewDone({ summary, onRepeatAgain, onClose }: { summary: SessionSummary; onRepeatAgain(): void; onClose(): void }) {
  return (
    <div className="rf rf--done" data-testid="rf-done" lang="fa" dir="rtl" role="region" aria-label="پایان جلسهٔ مرور">
      <p className="rf__done-title">جلسهٔ مرور تمام شد</p>
      <p className="rf__tally">
        <span className="fc-tally__know"><Check aria-hidden="true" /> {summary.known} بلدم</span>
        <span className="fc-tally__again"><X aria-hidden="true" /> {summary.again} دوباره</span>
      </p>
      {summary.again ? (
        <button type="button" className="rf__flip" onClick={onRepeatAgain}><RotateCcw aria-hidden="true" /> مرور دوبارهٔ {summary.again} کارت</button>
      ) : null}
      <button type="button" className="rf__close" onClick={onClose}>بستن پنجرهٔ شناور</button>
    </div>
  );
}
