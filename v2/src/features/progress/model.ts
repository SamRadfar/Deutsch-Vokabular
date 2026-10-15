import type { WordId } from '../../models/vocabulary';

/**
 * Personal learning progress (schema version 1).
 *
 * Ownership (see docs/SYNC_DESIGN.md):
 * - Firestore `users/{uid}/progress/{wordId}` is the shared, server-ordered truth.
 * - `ConfirmedProgress` is the device's copy of what the server last confirmed (IndexedDB).
 * - `PendingOp` is a local intention not yet confirmed by the server (IndexedDB queue).
 * - Effective state for the UI = pending (if any) ?? confirmed (if any) ?? not learned.
 */

export const PROGRESS_SCHEMA_VERSION = 1;

/** Why a progress value was written. Recorded for auditability (e.g. legacy imports). */
export type ProgressOrigin = 'toggle' | 'migration';

/** Document stored in Firestore at users/{uid}/progress/{wordId}. */
export interface ProgressDocument {
  schemaVersion: 1;
  wordId: WordId;
  learned: boolean;
  /** Server timestamp of the write (authoritative order). */
  updatedAt: unknown;
  /** Device clock at the time of the action — informational only, never used for ordering. */
  clientUpdatedAt: number;
  /** Unique id of the operation that produced this value (idempotency, own-echo detection). */
  opId: string;
  /** Random per-installation id (not personal data). */
  deviceId: string;
  origin: ProgressOrigin;
}

/** A progress value as confirmed by the server. */
export interface ConfirmedProgress {
  wordId: WordId;
  learned: boolean;
  /** Server time in ms; monotonic guard against stale snapshots. */
  serverUpdatedAt: number;
  opId: string;
  origin: ProgressOrigin;
}

/** A change made on this device that the server has not confirmed yet. One per word (latest wins). */
export interface PendingOp {
  opId: string;
  wordId: WordId;
  learned: boolean;
  origin: ProgressOrigin;
  clientUpdatedAt: number;
  /** queued → acked (server accepted the write; waiting to see it in the snapshot). */
  state: 'queued' | 'acked';
  attempts: number;
  lastError: { code: string; permanent: boolean } | null;
}

/** What the sync engine sends for one word. */
export interface ProgressWrite {
  wordId: WordId;
  learned: boolean;
  opId: string;
  deviceId: string;
  clientUpdatedAt: number;
  origin: ProgressOrigin;
}

export type WordSyncState = 'synced' | 'pending' | 'failed';

export type RemoteConnection = 'connecting' | 'live' | 'error';

export interface SyncStatus {
  /** loading = reading local data / first server snapshot; ready = interactive. */
  phase: 'loading' | 'ready' | 'stopped';
  online: boolean;
  remote: RemoteConnection;
  pendingCount: number;
  failedCount: number;
  /** A write is currently on its way to the server. */
  writing: boolean;
  /** Local persistence unavailable (e.g. IndexedDB blocked) — changes live only in memory. */
  localPersistence: boolean;
  lastError: string | null;
}

/** Validation problems in documents coming from Firestore or local storage. */
export interface ProgressValidationError {
  source: 'remote' | 'local';
  wordId: string | null;
  reason: string;
}
