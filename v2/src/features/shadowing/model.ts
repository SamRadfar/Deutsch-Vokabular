import type { WordId } from '../../models/vocabulary';
import { isPracticeWordId } from '../personal/model';

/**
 * Shadowing practice data (device-local, schema version 1, partitioned by uid).
 * Not synced: the deployed Firestore schema has no place for it (docs/SHADOWING_DESIGN.md §5).
 */

/** How often a word was fully practised in shadowing (drives the legacy exposure weighting). */
export interface ExposureRecord {
  wordId: WordId;
  count: number;
  lastPracticedAt: number;
}

/** Totals shown in the setup screen. */
export interface ShadowingStats {
  /** Sessions played to the end (not ended early). */
  sessionsCompleted: number;
  /** Items fully played (all repetitions), across all sessions. */
  itemsPracticed: number;
  /** Time spent in sessions (start → finish), ms. */
  practiceMs: number;
  lastSessionAt: number | null;
}

export const EMPTY_STATS: ShadowingStats = { sessionsCompleted: 0, itemsPracticed: 0, practiceMs: 0, lastSessionAt: null };
export const STATS_META_KEY = 'shadowing:stats:v1';

export function bumpExposure(previous: ExposureRecord | undefined, wordId: WordId, at: number): ExposureRecord {
  return { wordId, count: (previous?.count ?? 0) + 1, lastPracticedAt: Math.max(at, previous?.lastPracticedAt ?? 0) };
}

const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export function isValidExposure(r: unknown): r is ExposureRecord {
  if (typeof r !== 'object' || r === null) return false;
  const x = r as Record<string, unknown>;
  return typeof x.wordId === 'string' && isPracticeWordId(x.wordId) && count(x.count)
    && typeof x.lastPracticedAt === 'number' && Number.isFinite(x.lastPracticedAt);
}

export function sanitizeStats(raw: unknown): ShadowingStats {
  if (typeof raw !== 'object' || raw === null) return EMPTY_STATS;
  const x = raw as Record<string, unknown>;
  return {
    sessionsCompleted: count(x.sessionsCompleted) ? (x.sessionsCompleted as number) : 0,
    itemsPracticed: count(x.itemsPracticed) ? (x.itemsPracticed as number) : 0,
    practiceMs: count(x.practiceMs) ? (x.practiceMs as number) : 0,
    lastSessionAt: typeof x.lastSessionAt === 'number' && Number.isFinite(x.lastSessionAt) ? x.lastSessionAt : null,
  };
}
