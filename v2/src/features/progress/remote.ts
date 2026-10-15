import type { ProgressOrigin, ProgressWrite } from './model';

/** A progress document as delivered by the server (already validated). */
export interface RemoteProgressDoc {
  wordId: string;
  learned: boolean;
  opId: string;
  origin: ProgressOrigin;
  /** Server commit time in ms (sub-ms precision kept), authoritative for ordering. */
  serverUpdatedAt: number;
}

export interface RemoteError {
  code: string;
  /** Permanent errors (e.g. permission-denied) are not retried automatically. */
  permanent: boolean;
}

export interface RemoteSubscriptionHandlers {
  /** Server-confirmed documents only (local latency-compensated echoes are filtered out). */
  onDocs(docs: RemoteProgressDoc[]): void;
  onError(error: RemoteError): void;
}

export interface SubscribeOptions {
  /**
   * Incremental sync: only documents whose server time is strictly greater than this (ms).
   * Omitted = full read of the user's progress collection.
   */
  since?: number;
}

/** Boundary to the cloud store; implemented for Firestore and by in-memory test doubles. */
export interface ProgressRemote {
  subscribe(uid: string, handlers: RemoteSubscriptionHandlers, options?: SubscribeOptions): () => void;
  /** Resolves when the server has accepted the write; rejects with a RemoteError. */
  write(uid: string, write: ProgressWrite): Promise<void>;
}

const PERMANENT = new Set(['permission-denied', 'invalid-argument', 'failed-precondition', 'unauthenticated', 'not-found', 'out-of-range']);

export function toRemoteError(e: unknown): RemoteError {
  const raw = typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : 'unknown';
  const code = raw.replace(/^firestore\//, '');
  return { code, permanent: PERMANENT.has(code) };
}
