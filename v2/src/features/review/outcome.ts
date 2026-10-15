// What an answer changes in the user's data. One function for buttons, keys and swipes.
//
// Policy (docs/REVIEW_DESIGN.md §3):
//  - Every answer is added to the device-local review log (→ "review again" list).
//  - "Know" marks an unlearned word as learned through the normal progress sync (one Firestore
//    write, origin `toggle`, exactly like ticking the checkbox).
//  - "Don't know" never removes a learned mark that existed before this session — review results
//    must not overwrite existing progress. The only exception is correcting this session's own
//    mark: answering "know" and then changing the same card to "don't know" undoes that mark.

import type { WordId } from '../../models/vocabulary';
import type { ReviewResult } from './model';

export interface LearnedTarget {
  isLearned(id: WordId): boolean;
  setLearned(id: WordId, learned: boolean): void;
}

export interface OutcomeContext {
  /** Null when progress is not available (signed out / loading): nothing is saved. */
  learned: LearnedTarget | null;
  record: ((id: WordId, result: ReviewResult) => void) | null;
  /** Words this session marked as learned (owned by the session, mutated here). */
  markedBySession: Set<WordId>;
}

/** Applies one answer; `previous` is this session's earlier answer for the card, if any. */
export function applyOutcome(ctx: OutcomeContext, wordId: WordId, result: ReviewResult, previous: ReviewResult | undefined): void {
  if (previous === result) return; // same answer again: nothing new to record
  ctx.record?.(wordId, result);
  const target = ctx.learned;
  if (!target) return;
  if (result === 'know') {
    if (!target.isLearned(wordId)) {
      target.setLearned(wordId, true);
      ctx.markedBySession.add(wordId);
    }
  } else if (ctx.markedBySession.has(wordId)) {
    target.setLearned(wordId, false);
    ctx.markedBySession.delete(wordId);
  }
}
