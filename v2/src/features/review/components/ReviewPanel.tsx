import { useCategories } from '../../categories/useCategories';
import { subScopes, validSub } from '../../categories/practiceSubs';
import '../review.css';
import '../../floating/floating.css';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingWindow, type FloatingWindowOptions } from '../../floating/useFloatingWindow';
import { CATEGORY_KEYS, type Category } from '../../../models/vocabulary';
import { practiceScopes, usePersonal, usePracticeCards } from '../../personal/usePersonal';
import { readReviewPreferences, writeReviewPreferences } from '../../../services/preferences';
import {
  buildDeck, DEFAULT_SESSION_SIZE, modeAvailable, PERSONAL_KEY, selectCards, shuffle,
  type DeckProgress, type ReviewScope,
} from '../deck';
import { summarize } from '../session';
import { useFlashcardSession } from '../useFlashcardSession';
import { useReviewBackend } from '../useReviewBackend';
import { FlashcardSession } from './FlashcardSession';
import { FloatingFlashcard, FloatingReviewDone } from './FloatingFlashcard';
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
  const known = p.scope && (([...CATEGORY_KEYS, PERSONAL_KEY] as readonly string[]).includes(p.scope) || /^uc_[0-9a-f]{20}$/.test(p.scope));
  const scope: ReviewScope = known ? (p.scope as ReviewScope) : 'all';
  return { mode: p.mode ?? 'all', scope, size: p.size === undefined ? DEFAULT_SESSION_SIZE : p.size, autoSpeak: p.autoSpeak ?? true, subtab: p.subtab ?? null };
}

const FLOATING: FloatingWindowOptions = { owner: 'review', title: 'Deutsch Vokabular · مرور', rootClass: 'sh-float-root' };

/** The "🔄 مرور" tab: setup → flashcard session → summary. */
export function ReviewPanel({ categories, active, random }: Props) {
  const backend = useReviewBackend();
  const cards = usePracticeCards(categories); // built-in + personal words
  const { snapshot: personal } = usePersonal();
  const { catalog } = useCategories(categories);
  const scopes = useMemo(() => practiceScopes(categories, personal?.words.length ?? 0, catalog), [categories, personal, catalog]);
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.entry.id, c])), [cards]);
  const [choice, setChoice] = useState(initialChoice);
  const session = useFlashcardSession(backend);
  // Floating flashcard (Document Picture-in-Picture): the same session, rendered into the window.
  // This panel is keyed by account, so sign-out / account switch unmounts it and closes the window.
  const floating = useFloatingWindow(FLOATING);
  const floatingKind = floating.state.kind;
  const closeFloating = floating.close;
  // Back to the setup (no session) closes the window; a finished session shows its result there.
  useEffect(() => { if (!session.state && floatingKind !== 'closed') closeFloating(); }, [session.state, floatingKind, closeFloating]);

  const progress: DeckProgress = { learned: backend.learned, againIds: backend.againIds };
  // A remembered personal mode falls back to "all" while it is unavailable (signed out, loading).
  const withMode: SetupChoice = modeAvailable(choice.mode, progress) ? choice : { ...choice, mode: 'all' };
  // Subcategories of the chosen category (built-in + own); a vanished one means "all".
  const subs = useMemo(() => subScopes(catalog, withMode.scope === 'all' ? null : withMode.scope, cards), [catalog, withMode.scope, cards]);
  const shown: SetupChoice = { ...withMode, subtab: validSub(subs, withMode.subtab) };

  const start = () => {
    writeReviewPreferences(shown);
    session.start(buildDeck(selectCards(cards, shown.mode, shown.scope, progress, shown.subtab), shown.size, random));
  };

  const state = session.state;
  if (!state) {
    return <ReviewSetup cards={cards} scopes={scopes} subs={subs} backend={backend} choice={shown} onChange={setChoice} onStart={start} />;
  }

  const restart = () => session.start(shuffle(state.cards, random));
  const inFloating = (node: React.ReactNode) => (floating.state.kind === 'pip' ? createPortal(node, floating.state.container) : null);
  if (state.finished) {
    const summary = summarize(state);
    const repeatAgain = () => session.start(shuffle(summary.againIds, random));
    return (
      <>
      {inFloating(<FloatingReviewDone summary={summary} onRepeatAgain={repeatAgain} onClose={floating.close} />)}
      <SessionSummary
        summary={summary}
        cardsById={cardsById}
        saving={backend.status === 'ready'}
        newlyLearned={session.newlyLearned()}
        onRepeatAgain={repeatAgain}
        onRestart={restart}
        onNewSession={session.close}
      />
      </>
    );
  }

  const current = cardsById.get(state.cards[state.index]!);
  return (
    <>
    {current ? inFloating(<FloatingFlashcard state={state} card={current} onAnswer={session.answer} dispatch={session.dispatch} />) : null}
    <FlashcardSession
      state={state}
      cardsById={cardsById}
      active={active}
      autoSpeak={shown.autoSpeak}
      onAnswer={session.answer}
      dispatch={session.dispatch}
      onRestart={restart}
      floating={{ open: floating.open, close: floating.close, state: floating.state.kind, supported: floating.supported }}
    />
    </>
  );
}
