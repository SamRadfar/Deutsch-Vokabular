// Flashcard session state machine (pure reducer). Every session — first start, "restart" and
// "repeat the unknown cards" — is created by createSession(), so no field can survive from a
// previous session (legacy defect V3: the repeat left the card scene hidden).

import type { WordId } from '../../models/vocabulary';
import type { ReviewResult } from './model';

export interface SessionState {
  /** Card order of this session (word ids). */
  readonly cards: readonly WordId[];
  readonly index: number;
  /** Back side (Persian) visible. */
  readonly flipped: boolean;
  /** Latest answer per card in this session. Changing an answer replaces it. */
  readonly answers: Readonly<Record<WordId, ReviewResult>>;
  readonly finished: boolean;
}

export type SessionAction =
  | { type: 'flip' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'answer'; result: ReviewResult }
  | { type: 'end' };

export function createSession(cards: readonly WordId[]): SessionState {
  return { cards: [...cards], index: 0, flipped: false, answers: {}, finished: cards.length === 0 };
}

export const currentCard = (s: SessionState): WordId | undefined => (s.finished ? undefined : s.cards[s.index]);

/** Next unanswered card after `from`, wrapping around to skipped cards; -1 when all are answered. */
function nextUnanswered(cards: readonly WordId[], answers: SessionState['answers'], from: number): number {
  for (let step = 1; step <= cards.length; step++) {
    const i = (from + step) % cards.length;
    if (!(cards[i]! in answers)) return i;
  }
  return -1;
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  if (state.finished) return state;
  switch (action.type) {
    case 'flip':
      return { ...state, flipped: !state.flipped };
    case 'next':
      return state.index < state.cards.length - 1 ? { ...state, index: state.index + 1, flipped: false } : state;
    case 'previous':
      return state.index > 0 ? { ...state, index: state.index - 1, flipped: false } : state;
    case 'answer': {
      const id = state.cards[state.index];
      if (id === undefined) return state;
      const answers = { ...state.answers, [id]: action.result };
      const next = nextUnanswered(state.cards, answers, state.index);
      return next === -1
        ? { ...state, answers, flipped: false, finished: true }
        : { ...state, answers, index: next, flipped: false };
    }
    case 'end':
      return { ...state, flipped: false, finished: true };
  }
}

export interface SessionSummary {
  total: number;
  known: number;
  again: number;
  /** Cards never answered (skipped, or the session was ended early). */
  unanswered: number;
  /** Share of answered cards that were known, 0–100. */
  percent: number;
  /** Cards answered "don't know", in session order — the deck for "repeat the unknown cards". */
  againIds: WordId[];
}

export function summarize(s: SessionState): SessionSummary {
  let known = 0;
  const againIds: WordId[] = [];
  for (const id of s.cards) {
    if (s.answers[id] === 'know') known++;
    else if (s.answers[id] === 'again') againIds.push(id);
  }
  const answered = known + againIds.length;
  return {
    total: s.cards.length,
    known,
    again: againIds.length,
    unanswered: s.cards.length - answered,
    percent: answered ? Math.round((known / answered) * 100) : 0,
    againIds,
  };
}
