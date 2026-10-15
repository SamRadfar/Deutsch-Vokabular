// Device-local review history for ONE signed-in uid, observable by React (useSyncExternalStore).
// Pure TypeScript over the injected ProgressLocalStore, like ProgressSyncEngine.

import type { WordId } from '../../models/vocabulary';
import type { ProgressLocalStore } from '../progress/localStore';
import { isValidReviewRecord, mergeReview, type ReviewRecord, type ReviewResult } from './model';

export interface ReviewSnapshot {
  readonly records: ReadonlyMap<WordId, ReviewRecord>;
  /** Words whose latest answer was "don't know" — the "review again" list. */
  readonly againIds: ReadonlySet<WordId>;
  /** False when the last local write failed (the answer is kept in memory for this session). */
  readonly saved: boolean;
}

export class ReviewLog {
  private readonly records = new Map<WordId, ReviewRecord>();
  private readonly listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private snapshot: ReviewSnapshot;
  private saved = true;

  constructor(
    readonly uid: string,
    private readonly store: ProgressLocalStore,
    private readonly now: () => number = Date.now,
  ) {
    this.snapshot = this.build();
  }

  async load(): Promise<void> {
    try {
      for (const r of await this.store.loadReviews(this.uid)) if (isValidReviewRecord(r)) this.records.set(r.wordId, r);
    } catch {
      this.saved = false; // storage unreadable: the review list starts empty, answers stay in memory
    }
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): ReviewSnapshot => this.snapshot;

  /** Optimistic: the snapshot changes synchronously, the write follows (serialised per log). */
  record(wordId: WordId, result: ReviewResult): Promise<void> {
    const event = { wordId, result, at: this.now() };
    this.records.set(wordId, mergeReview(this.records.get(wordId), event));
    this.emit();
    const write = this.chain.then(async () => {
      try {
        // The stored merge is authoritative (another tab may have answered the same word).
        this.records.set(wordId, await this.store.recordReview(this.uid, event));
        this.saved = true;
      } catch {
        this.saved = false;
      }
      this.emit();
    });
    this.chain = write;
    return write;
  }

  private emit() {
    this.snapshot = this.build();
    for (const l of [...this.listeners]) l();
  }

  private build(): ReviewSnapshot {
    const againIds = new Set<WordId>();
    for (const r of this.records.values()) if (r.lastResult === 'again') againIds.add(r.wordId);
    return { records: new Map(this.records), againIds, saved: this.saved };
  }
}
