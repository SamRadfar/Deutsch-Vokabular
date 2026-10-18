import { Check, X } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { DeckCard } from '../deck';
import type { ReviewResult } from '../model';
import { WordTypeBadge } from '../../vocabulary/components/WordTypeBadge';
import {
  ExampleTranslation, GermanExample, GermanWord, PersianMeaning, PersianPronunciation, WordSpeech,
} from '../../vocabulary/components/EntryFields';
import { SWIPE_THRESHOLD, useSwipe } from '../useSwipe';

interface Props {
  card: DeckCard;
  flipped: boolean;
  onFlip(): void;
  onAnswer(result: ReviewResult): void;
  /** This session's earlier answer for the card (shown after navigating back). */
  previousAnswer: ReviewResult | undefined;
}

/**
 * One flashcard: German on the front, Persian on the back. Tapping the card flips it; swiping
 * right means "know", left "don't know" (legacy gestures). This component stays mounted for the
 * whole session (only the inner card is keyed), so the click that ends a swipe is swallowed even
 * though the swipe already replaced the card underneath it. Keyboard and screen-reader users have
 * the explicit buttons of FlashcardSession; the hidden face is inert so it is never read or focused.
 */
export function Flashcard({ card, flipped, onFlip, onAnswer, previousAnswer }: Props) {
  const { entry } = card;
  const swipe = useSwipe((dir) => onAnswer(dir === 'right' ? 'know' : 'again'));
  const progress = Math.min(Math.abs(swipe.offset) / SWIPE_THRESHOLD, 1);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return; // pronunciation buttons inside the card
    onFlip();
  };

  return (
    <div className="fc-scene">
      <span className="fc-swipe-hint fc-swipe-hint--again" aria-hidden="true" style={{ opacity: swipe.offset < 0 ? progress : 0 }}><X /></span>
      <span className="fc-swipe-hint fc-swipe-hint--know" aria-hidden="true" style={{ opacity: swipe.offset > 0 ? progress : 0 }}><Check /></span>
      <div
        className={`fc-drag${swipe.offset ? ' is-dragging' : ''}`}
        style={swipe.offset ? { transform: `translateX(${swipe.offset}px) rotate(${swipe.offset * 0.05}deg)` } : undefined}
        {...swipe.handlers}
      >
        {/* Keyed by word: a new card starts face up without animating the previous card back. */}
        <div key={entry.id} className={`fc-card${flipped ? ' is-flipped' : ''}`} onClick={onClick} data-testid="flashcard" data-entry-id={entry.id} data-side={flipped ? 'back' : 'front'}>
          <div className="fc-face fc-face--front" aria-hidden={flipped} inert={flipped}>
            <p className="fc-meta" lang="de" dir="ltr">{card.categoryLabel} · {card.subtabLabel}</p>
            <p className="fc-word"><GermanWord entry={entry} /></p>
            <div className="fc-row">
              <WordTypeBadge type={entry.type} />
              <WordSpeech entry={entry} />
            </div>
            {entry.example ? <p className="fc-example"><GermanExample entry={entry} /></p> : null}
            <p className="fc-tap" lang="fa" dir="rtl" aria-hidden="true">برای دیدن معنی، روی کارت بزنید</p>
          </div>
          <div className="fc-face fc-face--back" aria-hidden={!flipped} inert={!flipped}>
            <p className="fc-word fc-word--small"><GermanWord entry={entry} /></p>
            <p className="fc-fa"><PersianMeaning entry={entry} /></p>
            {entry.pronunciationFa ? <p className="fc-pr"><PersianPronunciation entry={entry} /> <WordSpeech entry={entry} /></p> : null}
            {entry.exampleFa ? <p className="fc-exfa"><ExampleTranslation entry={entry} /></p> : null}
          </div>
        </div>
      </div>
      {previousAnswer ? (
        <p className={`fc-previous fc-previous--${previousAnswer}`} lang="fa" dir="rtl">
          پاسخ شما در این جلسه: {previousAnswer === 'know' ? 'بلدم' : 'بلد نیستم'}
        </p>
      ) : null}
    </div>
  );
}
