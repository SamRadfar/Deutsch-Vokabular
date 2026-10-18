// Local-first progress synchronisation for ONE signed-in uid: a thin layer over the generic
// DocSyncEngine (features/sync/docSyncEngine.ts), which personal vocabulary uses as well.
// The adapters below keep the Phase 3 storage and Firestore formats exactly as they were
// (IndexedDB progress-confirmed / progress-pending records, users/{uid}/progress docs).
//
// Conflict model and limitations: see docSyncEngine.ts and docs/SYNC_DESIGN.md.

import { WORD_ID_PATTERN, type WordId } from '../../models/vocabulary';
import { DocSyncEngine, type DocLocalStore, type DocRemote, type DocSyncSnapshot } from '../sync/docSyncEngine';
import type { ConfirmedProgress, PendingOp, ProgressOrigin, SyncStatus, WordSyncState } from './model';
import type { ProgressLocalStore } from './localStore';
import type { ProgressRemote } from './remote';

export interface ProgressView {
  /** Effective learned set (pending overlay over confirmed). Includes unknown ids. */
  readonly learned: ReadonlySet<WordId>;
  stateOf(wordId: WordId): WordSyncState;
  readonly status: SyncStatus;
  /** Learned ids that are not part of the current built-in content (kept, never deleted). */
  readonly unknownLearnedIds: readonly string[];
}

export interface SyncEngineOptions {
  uid: string;
  local: ProgressLocalStore;
  remote: ProgressRemote;
  deviceId: string;
  knownIds: ReadonlySet<string>;
  online?: boolean;
  now?: () => number;
  newOpId?: () => string;
  retryBaseMs?: number;
  retryMaxMs?: number;
  firstSnapshotTimeoutMs?: number;
  fullResyncIntervalMs?: number;
}

/** What a progress document stores besides its id. */
export interface ProgressValue {
  learned: boolean;
  origin: ProgressOrigin;
}

const isProgressValue = (v: unknown): v is ProgressValue =>
  typeof v === 'object' && v !== null && typeof (v as ProgressValue).learned === 'boolean'
  && ((v as ProgressValue).origin === 'toggle' || (v as ProgressValue).origin === 'migration');

/** Phase 3 IndexedDB records ↔ generic records (formats unchanged on disk). */
export function progressLocalAdapter(store: ProgressLocalStore): DocLocalStore<ProgressValue> {
  const origin = (o: unknown): ProgressOrigin => (o === 'migration' ? 'migration' : 'toggle');
  return {
    get persistent() { return store.persistent; },
    async load(uid) {
      const { confirmed, pending } = await store.load(uid);
      return {
        confirmed: confirmed.map((c) => ({ id: c.wordId, value: { learned: c.learned, origin: origin(c.origin) }, serverUpdatedAt: c.serverUpdatedAt, opId: c.opId })),
        pending: pending.map((p) => ({
          opId: p.opId, id: p.wordId, value: { learned: p.learned, origin: origin(p.origin) }, clientUpdatedAt: p.clientUpdatedAt,
          state: p.state, attempts: p.attempts, lastError: p.lastError,
        })),
      };
    },
    putPending: (uid, op) => store.putPending(uid, {
      opId: op.opId, wordId: op.id, learned: op.value.learned, origin: op.value.origin, clientUpdatedAt: op.clientUpdatedAt,
      state: op.state, attempts: op.attempts, lastError: op.lastError,
    } satisfies PendingOp),
    deletePending: (uid, id, opId) => store.deletePending(uid, id, opId),
    putConfirmed: (uid, records) => store.putConfirmed(uid, records.map((r) => ({
      wordId: r.id, learned: r.value.learned, serverUpdatedAt: r.serverUpdatedAt, opId: r.opId, origin: r.value.origin,
    } satisfies ConfirmedProgress))),
    getMeta: (uid, key) => store.getMeta(uid, key),
    setMeta: (uid, key, value) => store.setMeta(uid, key, value),
  };
}

/** Phase 3 Firestore remote ↔ generic remote. */
export function progressRemoteAdapter(remote: ProgressRemote): DocRemote<ProgressValue> {
  return {
    subscribe: (uid, handlers, options) => remote.subscribe(uid, {
      onDocs: (docs) => handlers.onDocs(docs.map((d) => ({ id: d.wordId, value: { learned: d.learned, origin: d.origin }, opId: d.opId, serverUpdatedAt: d.serverUpdatedAt }))),
      onError: handlers.onError,
    }, options),
    write: (uid, w) => remote.write(uid, { wordId: w.id, learned: w.value.learned, origin: w.value.origin, opId: w.opId, deviceId: w.deviceId, clientUpdatedAt: w.clientUpdatedAt }),
  };
}

const LAST_FULL_SYNC_KEY = 'lastFullSyncAt'; // Phase 3 key: existing devices keep their incremental cursor

const ERROR_TEXT: Record<string, string> = {
  'permission-denied': 'دسترسی به داده‌های حساب رد شد (قوانین امنیتی Firestore).',
  unauthenticated: 'نشست ورود منقضی شده است؛ دوباره وارد شوید.',
  'invalid-argument': 'سرور دادهٔ ارسالی را نپذیرفت.',
  unavailable: 'سرور در دسترس نیست؛ دوباره تلاش می‌شود.',
  'local-write-failed': 'ذخیره روی این دستگاه ناموفق بود.',
};
export const syncErrorText = (code: string) => ERROR_TEXT[code] ?? `خطای همگام‌سازی (${code})`;

export class ProgressSyncEngine {
  private readonly engine: DocSyncEngine<ProgressValue>;
  private view: ProgressView;
  private viewOf: DocSyncSnapshot<ProgressValue> | null = null;

  constructor(private readonly o: SyncEngineOptions) {
    this.engine = new DocSyncEngine<ProgressValue>({
      uid: o.uid,
      local: progressLocalAdapter(o.local),
      remote: progressRemoteAdapter(o.remote),
      deviceId: o.deviceId,
      isValidId: (id) => WORD_ID_PATTERN.test(id),
      isValidValue: isProgressValue,
      fullSyncMetaKey: LAST_FULL_SYNC_KEY,
      ...(o.online !== undefined ? { online: o.online } : {}),
      ...(o.now ? { now: o.now } : {}),
      ...(o.newOpId ? { newOpId: o.newOpId } : {}),
      ...(o.retryBaseMs !== undefined ? { retryBaseMs: o.retryBaseMs } : {}),
      ...(o.retryMaxMs !== undefined ? { retryMaxMs: o.retryMaxMs } : {}),
      ...(o.firstSnapshotTimeoutMs !== undefined ? { firstSnapshotTimeoutMs: o.firstSnapshotTimeoutMs } : {}),
      ...(o.fullResyncIntervalMs !== undefined ? { fullResyncIntervalMs: o.fullResyncIntervalMs } : {}),
    });
    this.view = this.buildView();
  }

  get uid() { return this.o.uid; }
  get firstSnapshotReceived() { return this.engine.firstSnapshotReceived; }

  start(): Promise<void> { return this.engine.start(); }
  stop(): void { this.engine.stop(); }
  subscribe(listener: () => void): () => void { return this.engine.subscribe(listener); }

  getView(): ProgressView {
    if (this.viewOf !== this.engine.getSnapshot()) this.view = this.buildView();
    return this.view;
  }

  /** Optimistic: the UI updates synchronously; persistence and upload follow. */
  setLearned(wordId: WordId, learned: boolean, origin: ProgressOrigin = 'toggle'): Promise<void> {
    return this.engine.set(wordId, { learned, origin });
  }

  retryFailed(): void { this.engine.retryFailed(); }
  setOnline(online: boolean): void { this.engine.setOnline(online); }
  waitForSettled(wordIds?: Iterable<string>, timeoutMs = 30_000): Promise<boolean> { return this.engine.waitForSettled(wordIds, timeoutMs); }
  readMeta<T>(key: string): Promise<T | undefined> { return this.engine.readMeta<T>(key); }
  writeMeta(key: string, value: unknown): Promise<void> { return this.engine.writeMeta(key, value); }
  flush(): void { this.engine.flush(); }

  /** Server-confirmed value of a word, if any (used by the migration conflict check). */
  confirmedOf(wordId: string): ConfirmedProgress | undefined {
    const c = this.engine.confirmedOf(wordId);
    return c ? { wordId: c.id, learned: c.value.learned, serverUpdatedAt: c.serverUpdatedAt, opId: c.opId, origin: c.value.origin } : undefined;
  }
  hasPending(wordId: string): boolean { return this.engine.hasPending(wordId); }

  private buildView(): ProgressView {
    const snap = this.engine.getSnapshot();
    this.viewOf = snap;
    const learned = new Set<string>();
    for (const [id, v] of snap.values) if (v.learned) learned.add(id);
    return {
      learned,
      stateOf: snap.stateOf,
      status: snap.status,
      unknownLearnedIds: [...learned].filter((id) => !this.o.knownIds.has(id)),
    };
  }
}
