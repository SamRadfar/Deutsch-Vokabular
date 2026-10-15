// Device-local persistence for progress, partitioned by Firebase uid.
// Every record key starts with the uid, and every read is a key range on that uid, so one
// account's data (including its pending queue) can never be returned for another account.

import type { ConfirmedProgress, PendingOp } from './model';
import { mergeReview, type ReviewEvent, type ReviewRecord } from '../review/model';
import { bumpExposure, type ExposureRecord } from '../shadowing/model';

export interface LocalSnapshot {
  confirmed: ConfirmedProgress[];
  pending: PendingOp[];
}

export interface ProgressLocalStore {
  readonly persistent: boolean;
  load(uid: string): Promise<LocalSnapshot>;
  putPending(uid: string, op: PendingOp): Promise<void>;
  /** Deletes the pending op for the word only if it still has `opId` (avoids deleting a newer op). */
  deletePending(uid: string, wordId: string, opId: string): Promise<void>;
  putConfirmed(uid: string, records: ConfirmedProgress[]): Promise<void>;
  getMeta<T>(uid: string, key: string): Promise<T | undefined>;
  setMeta(uid: string, key: string, value: unknown): Promise<void>;
  /** Flashcard review records of this uid (device-local only, see features/review/model.ts). */
  loadReviews(uid: string): Promise<ReviewRecord[]>;
  /** Merges one answer into the stored record inside a single transaction (safe across tabs). */
  recordReview(uid: string, event: ReviewEvent): Promise<ReviewRecord>;
  /** Shadowing exposure (how often each word was practised) of this uid — device-local only. */
  loadExposure(uid: string): Promise<ExposureRecord[]>;
  /** Adds one completed practice of a word inside a single transaction and returns the record. */
  recordExposure(uid: string, wordId: string, at: number): Promise<ExposureRecord>;
}

export const DB_NAME = 'deutsch-vokabular-v2';
// v1: progress + meta. v2 (Phase 4A): + review-state. v3 (Phase 4B): + shadowing-exposure.
// Upgrades only ever add stores.
const DB_VERSION = 3;
const STORES = {
  confirmed: 'progress-confirmed', pending: 'progress-pending', meta: 'meta', reviews: 'review-state', exposure: 'shadowing-exposure',
} as const;

const req = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
});
const uidRange = (uid: string) => IDBKeyRange.bound([uid, ''], [uid, '￿']);

export function openProgressDb(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORES.confirmed)) db.createObjectStore(STORES.confirmed, { keyPath: ['uid', 'wordId'] });
      if (!db.objectStoreNames.contains(STORES.pending)) db.createObjectStore(STORES.pending, { keyPath: ['uid', 'wordId'] });
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: ['uid', 'key'] });
      if (!db.objectStoreNames.contains(STORES.reviews)) db.createObjectStore(STORES.reviews, { keyPath: ['uid', 'wordId'] });
      if (!db.objectStoreNames.contains(STORES.exposure)) db.createObjectStore(STORES.exposure, { keyPath: ['uid', 'wordId'] });
    };
    open.onsuccess = () => {
      // A newer version opened in another tab: release this connection so its upgrade is not blocked.
      open.result.onversionchange = () => open.result.close();
      resolve(open.result);
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
}

type Stored<T> = T & { uid: string };
const strip = <T extends object>({ uid: _uid, ...rest }: Stored<T>) => rest as unknown as T;

export function createIndexedDbStore(dbPromise: Promise<IDBDatabase>): ProgressLocalStore {
  return {
    persistent: true,
    async load(uid) {
      const db = await dbPromise;
      const tx = db.transaction([STORES.confirmed, STORES.pending], 'readonly');
      const [confirmed, pending] = await Promise.all([
        req(tx.objectStore(STORES.confirmed).getAll(uidRange(uid))) as Promise<Stored<ConfirmedProgress>[]>,
        req(tx.objectStore(STORES.pending).getAll(uidRange(uid))) as Promise<Stored<PendingOp>[]>,
      ]);
      // Defence in depth: never return records of another uid even if a range were wrong.
      return {
        confirmed: confirmed.filter((r) => r.uid === uid).map(strip),
        pending: pending.filter((r) => r.uid === uid).map(strip),
      };
    },
    async putPending(uid, op) {
      const db = await dbPromise;
      const tx = db.transaction(STORES.pending, 'readwrite');
      tx.objectStore(STORES.pending).put({ ...op, uid });
      await done(tx);
    },
    async deletePending(uid, wordId, opId) {
      const db = await dbPromise;
      const tx = db.transaction(STORES.pending, 'readwrite');
      const store = tx.objectStore(STORES.pending);
      const current = (await req(store.get([uid, wordId]))) as Stored<PendingOp> | undefined;
      if (current && current.opId === opId) store.delete([uid, wordId]);
      await done(tx);
    },
    async putConfirmed(uid, records) {
      if (!records.length) return;
      const db = await dbPromise;
      const tx = db.transaction(STORES.confirmed, 'readwrite');
      const store = tx.objectStore(STORES.confirmed);
      for (const r of records) store.put({ ...r, uid });
      await done(tx);
    },
    async getMeta(uid, key) {
      const db = await dbPromise;
      const row = (await req(db.transaction(STORES.meta, 'readonly').objectStore(STORES.meta).get([uid, key]))) as
        { value: unknown } | undefined;
      return row?.value as never;
    },
    async setMeta(uid, key, value) {
      const db = await dbPromise;
      const tx = db.transaction(STORES.meta, 'readwrite');
      tx.objectStore(STORES.meta).put({ uid, key, value });
      await done(tx);
    },
    async loadReviews(uid) {
      const db = await dbPromise;
      const rows = (await req(db.transaction(STORES.reviews, 'readonly').objectStore(STORES.reviews).getAll(uidRange(uid)))) as
        Stored<ReviewRecord>[];
      return rows.filter((r) => r.uid === uid).map(strip);
    },
    async recordReview(uid, event) {
      const db = await dbPromise;
      const tx = db.transaction(STORES.reviews, 'readwrite');
      const store = tx.objectStore(STORES.reviews);
      const current = (await req(store.get([uid, event.wordId]))) as Stored<ReviewRecord> | undefined;
      const next = mergeReview(current ? strip(current) : undefined, event);
      store.put({ ...next, uid });
      await done(tx);
      return next;
    },
    async loadExposure(uid) {
      const db = await dbPromise;
      const rows = (await req(db.transaction(STORES.exposure, 'readonly').objectStore(STORES.exposure).getAll(uidRange(uid)))) as
        Stored<ExposureRecord>[];
      return rows.filter((r) => r.uid === uid).map(strip);
    },
    async recordExposure(uid, wordId, at) {
      const db = await dbPromise;
      const tx = db.transaction(STORES.exposure, 'readwrite');
      const store = tx.objectStore(STORES.exposure);
      const current = (await req(store.get([uid, wordId]))) as Stored<ExposureRecord> | undefined;
      const next = bumpExposure(current ? strip(current) : undefined, wordId, at);
      store.put({ ...next, uid });
      await done(tx);
      return next;
    },
  };
}

/** Non-persistent fallback (IndexedDB unavailable) and test double. Same partitioning rules. */
export function createMemoryStore(): ProgressLocalStore {
  const confirmed = new Map<string, Map<string, ConfirmedProgress>>();
  const pending = new Map<string, Map<string, PendingOp>>();
  const meta = new Map<string, unknown>();
  const reviews = new Map<string, Map<string, ReviewRecord>>();
  const exposure = new Map<string, Map<string, ExposureRecord>>();
  const part = <T>(m: Map<string, Map<string, T>>, uid: string) => {
    let p = m.get(uid);
    if (!p) { p = new Map(); m.set(uid, p); }
    return p;
  };
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    persistent: false,
    async load(uid) {
      return { confirmed: [...part(confirmed, uid).values()].map(clone), pending: [...part(pending, uid).values()].map(clone) };
    },
    async putPending(uid, op) { part(pending, uid).set(op.wordId, clone(op)); },
    async deletePending(uid, wordId, opId) {
      const p = part(pending, uid);
      if (p.get(wordId)?.opId === opId) p.delete(wordId);
    },
    async putConfirmed(uid, records) { for (const r of records) part(confirmed, uid).set(r.wordId, clone(r)); },
    async getMeta(uid, key) { return clone(meta.get(`${uid}\u0000${key}`)) as never; },
    async setMeta(uid, key, value) { meta.set(`${uid}\u0000${key}`, clone(value)); },
    async loadReviews(uid) { return [...part(reviews, uid).values()].map(clone); },
    async recordReview(uid, event) {
      const next = mergeReview(part(reviews, uid).get(event.wordId), event);
      part(reviews, uid).set(event.wordId, next);
      return clone(next);
    },
    async loadExposure(uid) { return [...part(exposure, uid).values()].map(clone); },
    async recordExposure(uid, wordId, at) {
      const next = bumpExposure(part(exposure, uid).get(wordId), wordId, at);
      part(exposure, uid).set(wordId, next);
      return clone(next);
    },
  };
}

/** Opens IndexedDB, falling back to memory (and reporting it) when the browser blocks storage. */
export async function createDefaultLocalStore(): Promise<ProgressLocalStore> {
  try {
    if (typeof indexedDB === 'undefined') return createMemoryStore();
    const db = openProgressDb();
    await db;
    return createIndexedDbStore(db);
  } catch {
    return createMemoryStore();
  }
}

/** Random per-installation device id (not linked to a person), stored under a non-user partition. */
export async function getDeviceId(store: ProgressLocalStore, random: () => string = () => crypto.randomUUID()): Promise<string> {
  const existing = await store.getMeta<string>('__device__', 'deviceId');
  if (existing) return existing;
  const id = random();
  await store.setMeta('__device__', 'deviceId', id);
  return id;
}
