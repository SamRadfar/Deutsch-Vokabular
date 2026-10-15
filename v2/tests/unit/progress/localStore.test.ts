import 'fake-indexeddb/auto'; // provides IDBKeyRange (jsdom has no IndexedDB)
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbStore, getDeviceId, openProgressDb } from '../../../src/features/progress/localStore';
import type { PendingOp } from '../../../src/features/progress/model';

const op = (wordId: string, opId: string, learned = true): PendingOp =>
  ({ opId, wordId, learned, origin: 'toggle', clientUpdatedAt: 1, state: 'queued', attempts: 0, lastError: null });

function freshStore() {
  const factory = new IDBFactory();
  return { factory, store: createIndexedDbStore(openProgressDb(factory)) };
}

describe('IndexedDB progress store', () => {
  it('partitions confirmed records and pending queue by uid', async () => {
    const { store } = freshStore();
    await store.putPending('alice', op('dv_0000000001', 'a1'));
    await store.putConfirmed('alice', [{ wordId: 'dv_0000000002', learned: true, serverUpdatedAt: 1, opId: 'x', origin: 'toggle' }]);
    await store.putPending('bob', op('dv_0000000003', 'b1'));
    // A uid that is a prefix of another must not match it either.
    await store.putPending('alice2', op('dv_0000000004', 'c1'));
    const alice = await store.load('alice');
    expect(alice.pending.map((p) => p.wordId)).toEqual(['dv_0000000001']);
    expect(alice.confirmed.map((c) => c.wordId)).toEqual(['dv_0000000002']);
    expect(alice.pending[0]).not.toHaveProperty('uid');
    expect((await store.load('bob')).pending.map((p) => p.opId)).toEqual(['b1']);
    expect(await store.load('nobody')).toEqual({ confirmed: [], pending: [] });
  });

  it('survives reopening the database (page reload)', async () => {
    const { factory, store } = freshStore();
    await store.putPending('alice', op('dv_0000000001', 'a1'));
    const reopened = createIndexedDbStore(openProgressDb(factory));
    expect((await reopened.load('alice')).pending).toHaveLength(1);
  });

  it('deletePending only removes the op it was asked to remove (newer ops survive)', async () => {
    const { store } = freshStore();
    await store.putPending('alice', op('dv_0000000001', 'old'));
    await store.putPending('alice', op('dv_0000000001', 'new', false));
    await store.deletePending('alice', 'dv_0000000001', 'old');
    expect((await store.load('alice')).pending.map((p) => p.opId)).toEqual(['new']);
    await store.deletePending('alice', 'dv_0000000001', 'new');
    expect((await store.load('alice')).pending).toEqual([]);
  });

  it('keeps one stable random device id outside any user partition', async () => {
    const { store } = freshStore();
    const first = await getDeviceId(store, () => 'device-1');
    const second = await getDeviceId(store, () => 'device-2');
    expect([first, second]).toEqual(['device-1', 'device-1']);
    expect(await store.load('__device__')).toEqual({ confirmed: [], pending: [] });
  });
});
