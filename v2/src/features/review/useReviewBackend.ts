import { useMemo, useSyncExternalStore } from 'react';
import { useProgress } from '../progress/ProgressProvider';
import type { WordId } from '../../models/vocabulary';
import { isPersonalId } from '../personal/model';
import { mergeLearned, routeLearned, usePersonal } from '../personal/usePersonal';
import type { ReviewResult } from './model';
import type { LearnedTarget } from './outcome';
import type { ReviewSnapshot } from './reviewLog';

/** Personal data and persistence available to the flashcards, derived from the progress context. */
export interface ReviewBackend {
  /** `unavailable`: signed out or Firebase not configured — practice works, nothing is saved. */
  status: 'unavailable' | 'loading' | 'ready';
  uid: string | null;
  /** Built-in (synced) and personal (local) learned words. */
  learned: ReadonlySet<WordId> | null;
  againIds: ReadonlySet<WordId> | null;
  /** False when the last local review write failed. */
  saved: boolean;
  target: LearnedTarget | null;
  record: ((id: WordId, result: ReviewResult) => void) | null;
}

const noop = () => () => {};
const none = () => null;

export function useReviewBackend(): ReviewBackend {
  const progress = useProgress();
  const ready = progress.status === 'ready' ? progress : null;
  const log = ready?.reviews ?? null;
  const snapshot: ReviewSnapshot | null = useSyncExternalStore(log?.subscribe ?? noop, log?.getSnapshot ?? none, log?.getSnapshot ?? none);
  const { vocab, snapshot: personal } = usePersonal();

  return useMemo<ReviewBackend>(() => {
    if (!ready || !log || !snapshot) {
      return {
        status: progress.status === 'loading' ? 'loading' : 'unavailable',
        uid: progress.status === 'unavailable' ? null : progress.uid,
        learned: null, againIds: null, saved: true, target: null, record: null,
      };
    }
    const learned = mergeLearned(ready.view.learned, personal);
    return {
      status: 'ready',
      uid: ready.uid,
      learned,
      againIds: snapshot.againIds,
      saved: snapshot.saved,
      target: {
        isLearned: (id) => (isPersonalId(id) ? personal?.byId.get(id)?.learned ?? false : ready.view.learned.has(id)),
        setLearned: routeLearned((id, value) => { void ready.engine.setLearned(id, value); }, vocab),
      },
      record: (id, result) => { void log.record(id, result); },
    };
  }, [progress, ready, log, snapshot, personal, vocab]);
}
