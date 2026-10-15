import '../review.css';
import { useMemo, useState } from 'react';
import { CATEGORY_KEYS, type Category } from '../../../models/vocabulary';
import { readReviewPreferences, writeReviewPreferences } from '../../../services/preferences';
import {
  buildDeck, DEFAULT_SESSION_SIZE, flattenCards, modeAvailable, selectCards, shuffle,
  type DeckProgress, type ReviewScope,
} from '../deck';
import { summarize } from '../session';
import { useFlashcardSession } from '../useFlashcardSession';
import { useReviewBackend } from '../useReviewBackend';
import { FlashcardSession } from './FlashcardSession';
import { ReviewSetup, type SetupChoice } from './ReviewSetup';
import { SessionSummary } from './SessionSummary';

interface Props {
  categories: readonly Category[];
  /** The review tab is visible (keyboard shortcuts are active only then). */
  active: boolean;
  /** Injectable shuffle source for deterministic tests. */
  random?: () => number;
}

function initialChoice(): SetupChoice {
  const p = readReviewPreferences();
  const scope: ReviewScope = p.scope && (CATEGORY_KEYS as readonly string[]).includes(p.scope) ? (p.scope as ReviewScope) : 'all';
  return { mode: p.mode ?? 'all', scope, size: p.size === undefined ? DEFAULT_SESSION_SIZE : p.size, autoSpeak: p.autoSpeak ?? true };
}

/** The "🔄 مرور" tab: setup → flashcard session → summary. */
export function ReviewPanel({ categories, active, random }: Props) {
  const backend = useReviewBackend();
  const cards = useMemo(() => flattenCards(categories), [categories]);
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.entry.id, c])), [cards]);
  const [choice, setChoice] = useState(initialChoice);
  const session = useFlashcardSession(backend);

  const progress: DeckProgress = { learned: backend.learned, againIds: backend.againIds };
  // A remembered personal mode falls back to "all" while it is unavailable (signed out, loading).
  const shown: SetupChoice = modeAvailable(choice.mode, progress) ? choice : { ...choice, mode: 'all' };

  const start = () => {
    writeReviewPreferences(shown);
    session.start(buildDeck(selectCards(cards, shown.mode, shown.scope, progress), shown.size, random));
  };

  const state = session.state;
  if (!state) {
    return <ReviewSetup cards={cards} categories={categories} backend={backend} choice={shown} onChange={setChoice} onStart={start} />;
  }

  const restart = () => session.start(shuffle(state.cards, random));
  if (state.finished) {
    const summary = summarize(state);
    return (
      <SessionSummary
        summary={summary}
        cardsById={cardsById}
        saving={backend.status === 'ready'}
        newlyLearned={session.newlyLearned()}
        onRepeatAgain={() => session.start(shuffle(summary.againIds, random))}
        onRestart={restart}
        onNewSession={session.close}
      />
    );
  }

  return (
    <FlashcardSession
      state={state}
      cardsById={cardsById}
      active={active}
      autoSpeak={shown.autoSpeak}
      onAnswer={session.answer}
      dispatch={session.dispatch}
      onRestart={restart}
    />
  );
}
