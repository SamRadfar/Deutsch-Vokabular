import { WORD_ID_PATTERN, type WordId } from '../../models/vocabulary';

/**
 * Flashcard review outcomes (device-local, schema version 1).
 *
 * "Know" additionally marks the word as learned through the existing progress sync (Firestore,
 * origin `toggle`). The review log itself (last answer, counters) is stored only on this device,
 * partitioned by uid, because the deployed Firestore schema has no place for it. A cloud schema
 * for it is a separate, approval-gated proposal: docs/REVIEW_DESIGN.md §6.
 */

export type ReviewResult = 'know' | 'again';

/** One answer given on a flashcard. `at` is the device clock (ms). */
export interface ReviewEvent {
  wordId: WordId;
  result: ReviewResult;
  at: number;
}

/** Accumulated review history of one word for one user. */
export interface ReviewRecord {
  wordId: WordId;
  /** Latest answer; `again` puts the word on the "review again" list until it is known. */
  lastResult: ReviewResult;
  lastReviewedAt: number;
  knowCount: number;
  againCount: number;
}

/** Folds one answer into a record. Order is by device time, so a late-arriving older answer never wins. */
export function mergeReview(previous: ReviewRecord | undefined, event: ReviewEvent): ReviewRecord {
  const newer = !previous || event.at >= previous.lastReviewedAt;
  return {
    wordId: event.wordId,
    lastResult: newer ? event.result : previous.lastResult,
    lastReviewedAt: newer ? event.at : previous.lastReviewedAt,
    knowCount: (previous?.knowCount ?? 0) + (event.result === 'know' ? 1 : 0),
    againCount: (previous?.againCount ?? 0) + (event.result === 'again' ? 1 : 0),
  };
}

const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Guards data read back from local storage (another version or a manual edit could have written it). */
export function isValidReviewRecord(r: unknown): r is ReviewRecord {
  if (typeof r !== 'object' || r === null) return false;
  const x = r as Record<string, unknown>;
  return typeof x.wordId === 'string' && WORD_ID_PATTERN.test(x.wordId)
    && (x.lastResult === 'know' || x.lastResult === 'again')
    && typeof x.lastReviewedAt === 'number' && Number.isFinite(x.lastReviewedAt)
    && count(x.knowCount) && count(x.againCount);
}
