import { useMemo, useSyncExternalStore } from 'react';
import type { WordId } from '../../models/vocabulary';
import { useProgress } from '../progress/ProgressProvider';
import { useReviewBackend } from '../review/useReviewBackend';
import type { ShadowingStats } from './model';
import type { ShadowingLogSnapshot } from './shadowingLog';

/** Personal data for shadowing: learned / review-again sets for deck selection, local exposure and totals. */
export interface ShadowingBackend {
  status: 'unavailable' | 'loading' | 'ready';
  learned: ReadonlySet<WordId> | null;
  againIds: ReadonlySet<WordId> | null;
  exposure: ReadonlyMap<WordId, number> | null;
  stats: ShadowingStats | null;
  saved: boolean;
  recordItem: ((id: WordId) => void) | null;
  recordSession: ((completed: boolean, durationMs: number) => void) | null;
}

const noop = () => () => {};
const none = () => null;

export function useShadowingBackend(): ShadowingBackend {
  const review = useReviewBackend();
  const progress = useProgress();
  const log = progress.status === 'ready' ? progress.shadowing : null;
  const snap: ShadowingLogSnapshot | null = useSyncExternalStore(log?.subscribe ?? noop, log?.getSnapshot ?? none, log?.getSnapshot ?? none);

  return useMemo<ShadowingBackend>(() => {
    if (review.status !== 'ready' || !log || !snap) {
      return {
        status: review.status, learned: null, againIds: null, exposure: null, stats: null, saved: true,
        recordItem: null, recordSession: null,
      };
    }
    return {
      status: 'ready',
      learned: review.learned,
      againIds: review.againIds,
      exposure: snap.exposure,
      stats: snap.stats,
      saved: snap.saved,
      recordItem: (id) => { void log.recordItem(id); },
      recordSession: (completed, ms) => { void log.recordSession(completed, ms); },
    };
  }, [review, log, snap]);
}
