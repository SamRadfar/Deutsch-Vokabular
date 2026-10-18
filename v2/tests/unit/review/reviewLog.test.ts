import 'fake-indexeddb/auto'; // provides IDBKeyRange (jsdom has no IndexedDB)
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbStore, createMemoryStore, DB_NAME, openProgressDb, type ProgressLocalStore } from '../../../src/features/progress/localStore';
import { mergeReview } from '../../../src/features/review/model';
import { ReviewLog } from '../../../src/features/review/reviewLog';

const A = 'dv_00000000a1';
const B = 'dv_00000000b2';

function idbStore(factory = new IDBFactory()) {
  return { factory, store: createIndexedDbStore(openProgressDb(factory)) };
}

describe('review records (merge)', () => {
  it('counts every answer and keeps the latest result by time', () => {
    let r = mergeReview(undefined, { wordId: A, result: 'again', at: 10 });
    r = mergeReview(r, { wordId: A, result: 'know', at: 20 });
    expect(r).toEqual({ wordId: A, lastResult: 'know', lastReviewedAt: 20, knowCount: 1, againCount: 1 });
    // An older answer arriving late (other tab) is counted but does not change the latest result.
    expect(mergeReview(r, { wordId: A, result: 'again', at: 15 })).toMatchObject({ lastResult: 'know', lastReviewedAt: 20, againCount: 2 });
  });
});

describe('ReviewLog persistence', () => {
  it('records answers, exposes the review-again list and survives a reload (IndexedDB)', async () => {
    const { factory, store } = idbStore();
    let t = 1000;
    const log = new ReviewLog('alice', store, () => t++);
    await log.load();
    expect(log.getSnapshot().againIds.size).toBe(0);
    const changes: number[] = [];
    log.subscribe(() => changes.push(log.getSnapshot().againIds.size));

    const pending = log.record(A, 'again'); // optimistic: visible before the write finished
    expect(log.getSnapshot().againIds.has(A)).toBe(true);
    await pending;
    await log.record(B, 'know');
    expect(changes.length).toBeGreaterThan(0);

    const reloaded = new ReviewLog('alice', createIndexedDbStore(openProgressDb(factory)));
    await reloaded.load();
    expect([...reloaded.getSnapshot().againIds]).toEqual([A]);
    expect(reloaded.getSnapshot().records.get(B)).toMatchObject({ lastResult: 'know', knowCount: 1, againCount: 0 });
    expect(reloaded.getSnapshot().saved).toBe(true);
  });

  it('knowing a word later removes it from the review-again list', async () => {
    const log = new ReviewLog('alice', createMemoryStore());
    await log.load();
    await log.record(A, 'again');
    await log.record(A, 'know');
    expect(log.getSnapshot().againIds.has(A)).toBe(false);
    expect(log.getSnapshot().records.get(A)).toMatchObject({ knowCount: 1, againCount: 1 });
  });

  it('is partitioned by uid', async () => {
    const { store } = idbStore();
    await new ReviewLog('alice', store).record(A, 'again');
    await new ReviewLog('alice2', store).record(B, 'again');
    const bob = new ReviewLog('bob', store);
    await bob.load();
    expect(bob.getSnapshot().records.size).toBe(0);
    expect((await store.loadReviews('alice')).map((r) => r.wordId)).toEqual([A]);
    expect(await store.loadReviews('alice')).not.toContainEqual(expect.objectContaining({ uid: expect.anything() }));
  });

  it('two tabs answering the same word are merged in one transaction (no lost counts)', async () => {
    const { factory } = idbStore();
    const tab1 = createIndexedDbStore(openProgressDb(factory));
    const tab2 = createIndexedDbStore(openProgressDb(factory));
    await Promise.all([
      tab1.recordReview('alice', { wordId: A, result: 'again', at: 1 }),
      tab2.recordReview('alice', { wordId: A, result: 'know', at: 2 }),
    ]);
    expect((await tab1.loadReviews('alice'))[0]).toMatchObject({ knowCount: 1, againCount: 1, lastResult: 'know' });
  });

  it('ignores invalid stored records', async () => {
    const store = createMemoryStore();
    const broken: ProgressLocalStore = {
      ...store,
      loadReviews: async () => [
        { wordId: A, lastResult: 'again', lastReviewedAt: 1, knowCount: 0, againCount: 1 },
        { wordId: 'not-an-id', lastResult: 'again', lastReviewedAt: 1, knowCount: 0, againCount: 1 },
        { wordId: B, lastResult: 'maybe', lastReviewedAt: 1, knowCount: 0, againCount: 1 } as never,
      ],
    };
    const log = new ReviewLog('alice', broken);
    await log.load();
    expect([...log.getSnapshot().againIds]).toEqual([A]);
  });

  it('a failing local write keeps the answer for this session and reports it', async () => {
    const store = createMemoryStore();
    const failing: ProgressLocalStore = { ...store, recordReview: async () => { throw new Error('quota'); } };
    const log = new ReviewLog('alice', failing);
    await log.load();
    await log.record(A, 'again');
    expect(log.getSnapshot()).toMatchObject({ saved: false });
    expect(log.getSnapshot().againIds.has(A)).toBe(true);
  });
});

describe('IndexedDB schema upgrade v1 → current', () => {
  it('adds the review, shadowing, personal-word and sync stores and keeps existing progress data', async () => {
    const factory = new IDBFactory();
    // A database as written by the Phase 3 app (version 1, three stores).
    await new Promise<void>((resolve, reject) => {
      const open = factory.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('progress-confirmed', { keyPath: ['uid', 'wordId'] });
        db.createObjectStore('progress-pending', { keyPath: ['uid', 'wordId'] });
        db.createObjectStore('meta', { keyPath: ['uid', 'key'] });
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['progress-confirmed', 'meta'], 'readwrite');
        tx.objectStore('progress-confirmed').put({ uid: 'alice', wordId: A, learned: true, serverUpdatedAt: 5, opId: 'o1', origin: 'toggle' });
        tx.objectStore('meta').put({ uid: '__device__', key: 'deviceId', value: 'device-1' });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });

    const db = await openProgressDb(factory);
    expect(db.version).toBe(5);
    expect([...db.objectStoreNames].sort()).toEqual(['custom-confirmed', 'custom-pending', 'meta', 'personal-words', 'progress-confirmed', 'progress-pending', 'review-state', 'shadowing-exposure']);
    const store = createIndexedDbStore(Promise.resolve(db));
    expect((await store.load('alice')).confirmed).toEqual([{ wordId: A, learned: true, serverUpdatedAt: 5, opId: 'o1', origin: 'toggle' }]);
    expect(await store.getMeta('__device__', 'deviceId')).toBe('device-1');
    expect(await store.loadReviews('alice')).toEqual([]);
    expect(await store.loadPersonalWords('alice')).toEqual([]);
  });

  it('an open older connection is released so the upgrade is not blocked', async () => {
    const factory = new IDBFactory();
    const first = await openProgressDb(factory);
    let closed = false;
    const originalClose = first.close.bind(first);
    first.close = () => { closed = true; originalClose(); };
    // Simulate a newer app version opening the same database in another tab.
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(DB_NAME, 6);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('blocked'));
    });
    expect(closed).toBe(true);
    expect(upgraded.version).toBe(6);
  });
});
