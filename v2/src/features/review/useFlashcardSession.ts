import { useCallback, useRef, useState } from 'react';
import type { WordId } from '../../models/vocabulary';
import type { ReviewResult } from './model';
import { applyOutcome } from './outcome';
import { createSession, currentCard, sessionReducer, type SessionAction, type SessionState } from './session';
import type { ReviewBackend } from './useReviewBackend';

/**
 * Binds the pure session reducer to persistence. Buttons, keyboard shortcuts and swipes all call
 * these functions, so there is exactly one code path per action. The latest state is kept in a ref:
 * fast repeated input (key repeat, double taps) is applied to the state it actually changes.
 */
export function useFlashcardSession(backend: ReviewBackend) {
  const [state, setState] = useState<SessionState | null>(null);
  const stateRef = useRef<SessionState | null>(null);
  const backendRef = useRef(backend);
  backendRef.current = backend;
  /** Words this session marked as learned (see outcome.ts). */
  const marked = useRef(new Set<WordId>());

  const commit = (next: SessionState | null) => {
    stateRef.current = next;
    setState(next);
  };

  const dispatch = useCallback((action: SessionAction) => {
    const s = stateRef.current;
    if (s) commit(sessionReducer(s, action));
  }, []);

  /** Starts a fresh session (also used for "restart" and "repeat the unknown cards"). */
  const start = useCallback((cards: readonly WordId[]) => {
    marked.current = new Set();
    commit(createSession(cards));
  }, []);

  const answer = useCallback((result: ReviewResult) => {
    const s = stateRef.current;
    const id = s ? currentCard(s) : undefined;
    if (!s || id === undefined) return;
    const b = backendRef.current;
    applyOutcome({ learned: b.target, record: b.record, markedBySession: marked.current }, id, result, s.answers[id]);
    commit(sessionReducer(s, { type: 'answer', result }));
  }, []);

  const close = useCallback(() => commit(null), []);

  return { state, start, answer, dispatch, close, newlyLearned: () => marked.current.size };
}
