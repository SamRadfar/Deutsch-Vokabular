// Device-local shadowing history for ONE signed-in uid (exposure per word + session totals),
// observable by React. Same pattern as review/reviewLog.ts.

import type { WordId } from '../../models/vocabulary';
import type { ProgressLocalStore } from '../progress/localStore';
import { bumpExposure, EMPTY_STATS, isValidExposure, sanitizeStats, STATS_META_KEY, type ShadowingStats } from './model';

export interface ShadowingLogSnapshot {
  readonly exposure: ReadonlyMap<WordId, number>;
  readonly stats: ShadowingStats;
  /** False when the last local write failed (kept in memory for this page). */
  readonly saved: boolean;
}

export class ShadowingLog {
  private readonly exposure = new Map<WordId, number>();
  private stats: ShadowingStats = EMPTY_STATS;
  private readonly listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private saved = true;
  private snapshot: ShadowingLogSnapshot;

  constructor(readonly uid: string, private readonly store: ProgressLocalStore, private readonly now: () => number = Date.now) {
    this.snapshot = this.build();
  }

  async load(): Promise<void> {
    try {
      for (const r of await this.store.loadExposure(this.uid)) if (isValidExposure(r)) this.exposure.set(r.wordId, r.count);
      this.stats = sanitizeStats(await this.store.getMeta(this.uid, STATS_META_KEY));
    } catch {
      this.saved = false;
    }
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): ShadowingLogSnapshot => this.snapshot;

  /** One item was played with all its repetitions. */
  recordItem(wordId: WordId): Promise<void> {
    const at = this.now();
    this.exposure.set(wordId, bumpExposure({ wordId, count: this.exposure.get(wordId) ?? 0, lastPracticedAt: 0 }, wordId, at).count);
    this.stats = { ...this.stats, itemsPracticed: this.stats.itemsPracticed + 1 };
    this.emit();
    return this.write(async () => {
      const r = await this.store.recordExposure(this.uid, wordId, at);
      this.exposure.set(wordId, r.count);
      await this.persistStats((s) => ({ ...s, itemsPracticed: s.itemsPracticed + 1 }));
    });
  }

  /** A session ended; `completed` = played to the end. */
  recordSession(completed: boolean, durationMs: number): Promise<void> {
    const at = this.now();
    const apply = (s: ShadowingStats): ShadowingStats => ({
      ...s,
      sessionsCompleted: s.sessionsCompleted + (completed ? 1 : 0),
      practiceMs: s.practiceMs + Math.max(0, Math.round(durationMs)),
      lastSessionAt: at,
    });
    this.stats = apply(this.stats);
    this.emit();
    return this.write(() => this.persistStats(apply));
  }

  /** Read-modify-write on the stored totals (another tab may have added to them). */
  private async persistStats(change: (s: ShadowingStats) => ShadowingStats) {
    const stored = sanitizeStats(await this.store.getMeta(this.uid, STATS_META_KEY));
    await this.store.setMeta(this.uid, STATS_META_KEY, change(stored));
  }

  private write(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(async () => {
      try {
        await task();
        this.saved = true;
      } catch {
        this.saved = false;
      }
      this.emit();
    });
    this.chain = next;
    return next;
  }

  private emit() {
    this.snapshot = this.build();
    for (const l of [...this.listeners]) l();
  }

  private build(): ShadowingLogSnapshot {
    return { exposure: new Map(this.exposure), stats: this.stats, saved: this.saved };
  }
}
