import { useEffect, useRef } from 'react';
import type { WordId } from '../../../models/vocabulary';
import { usePronunciation } from '../../pronunciation/PronunciationProvider';
import { speechTextForWord } from '../../pronunciation/speechService';
import type { DeckCard } from '../deck';
import type { ReviewResult } from '../model';
import type { SessionAction, SessionState } from '../session';
import { Flashcard } from './Flashcard';

interface Props {
  state: SessionState;
  cardsById: ReadonlyMap<WordId, DeckCard>;
  /** The review tab is visible: only then do keyboard shortcuts apply. */
  active: boolean;
  autoSpeak: boolean;
  onAnswer(result: ReviewResult): void;
  dispatch(action: SessionAction): void;
  onRestart(): void;
}

/** Keys work on any keyboard layout (KeyboardEvent.code), e.g. also with a Persian layout. */
const KEYS: Record<string, 'flip' | 'next' | 'previous' | 'know' | 'again' | 'speak' | 'end'> = {
  Space: 'flip', Enter: 'flip', NumpadEnter: 'flip',
  ArrowRight: 'next', ArrowLeft: 'previous',
  Digit1: 'again', Numpad1: 'again',
  Digit2: 'know', Numpad2: 'know',
  KeyS: 'speak', Escape: 'end',
};

export function FlashcardSession({ state, cardsById, active, autoSpeak, onAnswer, dispatch, onRestart }: Props) {
  const id = state.cards[state.index]!;
  const card = cardsById.get(id);
  const { toggle, speakingKey } = usePronunciation();
  const root = useRef<HTMLElement>(null);
  const answered = Object.keys(state.answers).length;
  let known = 0;
  for (const r of Object.values(state.answers)) if (r === 'know') known++;

  /** `toggle`: like the 🔊 button (a second press stops). Otherwise only starts if not already speaking. */
  const speakWord = (toggleMode: boolean) => {
    if (!card) return;
    const key = `${card.entry.id}:word`;
    if (toggleMode || speakingKey !== key) toggle(key, speechTextForWord(card.entry.word));
  };
  const speakRef = useRef(speakWord);
  speakRef.current = speakWord;

  // Legacy behaviour: turning a card speaks the German word (can be switched off in the setup).
  const flippedKey = state.flipped ? id : null;
  useEffect(() => {
    if (flippedKey && autoSpeak) speakRef.current(false);
  }, [flippedKey, autoSpeak]);

  // A new session starts at the top of the card with keyboard focus on the flip control.
  useEffect(() => {
    root.current?.scrollIntoView?.({ block: 'start' });
    root.current?.querySelector<HTMLButtonElement>('.fc-flip')?.focus({ preventScroll: true });
  }, []);

  const handlers = useRef({ onAnswer, dispatch });
  handlers.current = { onAnswer, dispatch };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const action = KEYS[e.code];
      if (!action || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat && action !== 'next' && action !== 'previous') return; // holding a key answers once
      const target = e.target instanceof Element ? e.target : null;
      // Never steal keys from form fields, menus or dialogs (account menu, migration dialog).
      if (target?.closest('input, select, textarea, [contenteditable="true"], [role="menu"], [role="dialog"]')) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      // Space/Enter on a focused button keep their native meaning (activate that button).
      if (action === 'flip' && target?.closest('button, a[href]')) return;
      e.preventDefault();
      const h = handlers.current;
      if (action === 'know' || action === 'again') h.onAnswer(action);
      else if (action === 'speak') speakRef.current(true);
      else h.dispatch({ type: action });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!card) return null;
  const total = state.cards.length;
  const announcement = state.flipped
    ? `معنی: ${card.entry.fa}`
    : `کارت ${state.index + 1} از ${total}: ${card.entry.word}`;

  return (
    <section ref={root} className="fc-session" data-category={card.theme} aria-label="جلسهٔ مرور" lang="fa" dir="rtl">
      <div className="fc-toolbar">
        <button type="button" className="fc-tool" onClick={() => dispatch({ type: 'end' })}>پایان جلسه</button>
        <p className="fc-count" data-testid="fc-count"><span dir="ltr">{state.index + 1} / {total}</span></p>
        <button type="button" className="fc-tool" onClick={onRestart}>شروع دوباره</button>
      </div>
      <div className="fc-progress" role="progressbar" aria-label="پاسخ‌داده‌شده" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}
        aria-valuetext={`${answered} از ${total} کارت پاسخ داده شد`}>
        <span style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
      </div>
      <p className="fc-tally" aria-hidden="true">
        <span className="fc-tally__know">✓ {known}</span>
        <span className="fc-tally__again">✗ {answered - known}</span>
      </p>

      <Flashcard card={card} flipped={state.flipped} onFlip={() => dispatch({ type: 'flip' })} onAnswer={onAnswer} previousAnswer={state.answers[id]} />

      <button type="button" className="fc-flip" onClick={() => dispatch({ type: 'flip' })} aria-pressed={state.flipped}>
        {state.flipped ? 'نمایش واژهٔ آلمانی' : 'نمایش معنی'}
      </button>

      {/* LTR row: "don't know" on the left and "know" on the right, matching the swipe directions. */}
      <div className="fc-answers" dir="ltr">
        <button type="button" className="fc-answer fc-answer--again" onClick={() => onAnswer('again')}>
          <span aria-hidden="true">✗</span> <span lang="fa">بلد نیستم</span>
          <small lang="fa">مرور دوباره</small>
        </button>
        <button type="button" className="fc-answer fc-answer--know" onClick={() => onAnswer('know')}>
          <span aria-hidden="true">✓</span> <span lang="fa">بلدم</span>
          <small lang="fa">یادگرفتم</small>
        </button>
      </div>

      <div className="fc-nav" dir="ltr">
        <button type="button" className="fc-tool" onClick={() => dispatch({ type: 'previous' })} disabled={state.index === 0}>
          <span aria-hidden="true">←</span><span lang="fa">قبلی</span>
        </button>
        <button type="button" className="fc-tool" onClick={() => dispatch({ type: 'next' })} disabled={state.index >= total - 1}>
          <span lang="fa">بعدی</span><span aria-hidden="true">→</span>
        </button>
      </div>

      <p className="fc-keys">
        میان‌برها: <kbd>Space</kbd> برگرداندن · <kbd>←</kbd> <kbd>→</kbd> قبلی/بعدی · <kbd>1</kbd> بلد نیستم · <kbd>2</kbd> بلدم · <kbd>S</kbd> تلفظ · <kbd>Esc</kbd> پایان
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
    </section>
  );
}
