import { afterEach, describe, expect, it } from 'vitest';
import { ProgressSyncEngine } from '../../../src/features/progress/syncEngine';
import { createMemoryStore, type ProgressLocalStore } from '../../../src/features/progress/localStore';
import type { ProgressRemote } from '../../../src/features/progress/remote';
import { getBundledRepository as getVocabularyRepository } from '../../../src/services/content/bundled';
import { buildLegacyKeyIndex } from '../../../src/services/content/idRegistry';
import { createFakeCloud, until } from '../../helpers/fakeCloud';
import { bundledIdRegistry as idRegistry } from '../../../src/services/content/bundled';

const repo = getVocabularyRepository();
const ids = repo.categories.flatMap((c) => c.subtabs.flatMap((s) => s.groups.flatMap((g) => g.entries.map((e) => e.id))));
const knownIds = new Set(ids);
const engines: ProgressSyncEngine[] = [];

function engine(uid: string, local: ProgressLocalStore, remote: ProgressRemote, extra: Partial<ConstructorParameters<typeof ProgressSyncEngine>[0]> = {}) {
  const e = new ProgressSyncEngine({ uid, local, remote, deviceId: `dev-${engines.length}`, knownIds, retryBaseMs: 5, retryMaxMs: 20, firstSnapshotTimeoutMs: 50, ...extra });
  engines.push(e);
  return e;
}
const learnedOf = (e: ProgressSyncEngine) => [...e.getView().learned].sort();
const settled = (e: ProgressSyncEngine) => e.getView().status.pendingCount === 0;

afterEach(() => { for (const e of engines.splice(0)) e.stop(); });

describe('single device', () => {
  it('marks and unmarks optimistically, then confirms through the server', async () => {
    const cloud = createFakeCloud();
    const e = engine('alice', createMemoryStore(), cloud.device('laptop'));
    await e.start();
    void e.setLearned(ids[0]!, true);
    expect(e.getView().learned.has(ids[0]!)).toBe(true); // immediate
    expect(e.getView().stateOf(ids[0]!)).toBe('pending');
    await until(() => settled(e), 2000, 'confirm');
    expect(e.getView().stateOf(ids[0]!)).toBe('synced');
    expect(cloud.serverState('alice').get(ids[0]!)).toBe(true);
    void e.setLearned(ids[0]!, false);
    expect(e.getView().learned.has(ids[0]!)).toBe(false);
    await until(() => settled(e));
    expect(cloud.serverState('alice').get(ids[0]!)).toBe(false); // unmark is stored, not deleted
  });

  it('restores progress after a reload from the local store, before the server answers', async () => {
    const cloud = createFakeCloud();
    const local = createMemoryStore();
    const first = engine('alice', local, cloud.device('laptop'));
    await first.start();
    await first.setLearned(ids[1]!, true);
    await until(() => settled(first));
    first.stop();
    const offlineRemote = cloud.device('laptop-after-reload');
    offlineRemote.setOnline(false);
    const second = engine('alice', local, offlineRemote, { online: false });
    await second.start();
    expect(learnedOf(second)).toEqual([ids[1]]);
    expect(second.getView().status.phase).toBe('ready');
  });

  it('keeps entries that share a legacy key independent', async () => {
    const [a, b] = buildLegacyKeyIndex(idRegistry).get('bauphysik::der Hebelarm')!;
    const cloud = createFakeCloud();
    const e = engine('alice', createMemoryStore(), cloud.device('laptop'));
    await e.start();
    await e.setLearned(a!, true);
    await until(() => settled(e));
    expect(e.getView().learned.has(a!)).toBe(true);
    expect(e.getView().learned.has(b!)).toBe(false);
  });

  it('rapid toggling converges to the last action, locally and on the server', async () => {
    const cloud = createFakeCloud();
    const e = engine('alice', createMemoryStore(), cloud.device('laptop'));
    await e.start();
    for (let i = 0; i < 7; i++) void e.setLearned(ids[2]!, i % 2 === 0); // ends with true (i = 6)
    expect(e.getView().learned.has(ids[2]!)).toBe(true);
    await until(() => settled(e), 3000, 'rapid toggles');
    expect(cloud.serverState('alice').get(ids[2]!)).toBe(true);
    expect(e.getView().learned.has(ids[2]!)).toBe(true);
    // Coalescing: far fewer than 7 writes reach the server.
    expect(cloud.writeLog.filter((w) => w.write.wordId === ids[2]).length).toBeLessThanOrEqual(3);
  });

  it('does not write back what it receives (no feedback loop)', async () => {
    const cloud = createFakeCloud();
    const laptop = engine('alice', createMemoryStore(), cloud.device('laptop'));
    const phone = engine('alice', createMemoryStore(), cloud.device('phone'));
    await laptop.start();
    await phone.start();
    await laptop.setLearned(ids[3]!, true);
    await until(() => phone.getView().learned.has(ids[3]!));
    await new Promise((r) => setTimeout(r, 50));
    expect(cloud.writeLog.map((w) => w.device)).toEqual(['laptop']);
  });

  it('ignores stale snapshots that are older than what it already confirmed', async () => {
    const cloud = createFakeCloud();
    const dev = cloud.device('laptop');
    const e = engine('alice', createMemoryStore(), dev);
    await e.start();
    await e.setLearned(ids[4]!, true);
    await until(() => settled(e));
    const confirmed = e.confirmedOf(ids[4]!)!;
    dev.inject('alice', { wordId: ids[4]!, learned: false, opId: 'old-op', origin: 'toggle', serverUpdatedAt: confirmed.serverUpdatedAt - 10 });
    await new Promise((r) => setTimeout(r, 30));
    expect(e.getView().learned.has(ids[4]!)).toBe(true);
  });

  it('keeps unknown (obsolete) word ids from the server, reports them and never deletes them', async () => {
    const cloud = createFakeCloud();
    const dev = cloud.device('laptop');
    const e = engine('alice', createMemoryStore(), dev);
    await e.start();
    dev.inject('alice', { wordId: 'dv_ffffffffff', learned: true, opId: 'x', origin: 'toggle', serverUpdatedAt: 5 });
    await until(() => e.getView().unknownLearnedIds.length === 1);
    expect(e.getView().unknownLearnedIds).toEqual(['dv_ffffffffff']);
    expect(cloud.writeLog).toHaveLength(0);
  });
});

describe('offline and failures', () => {
  it('queues offline changes, survives a reload and syncs on reconnection', async () => {
    const cloud = createFakeCloud();
    const local = createMemoryStore();
    const dev = cloud.device('phone');
    dev.setOnline(false);
    const e = engine('alice', local, dev, { online: false });
    await e.start();
    await e.setLearned(ids[5]!, true);
    await e.setLearned(ids[6]!, true);
    expect(e.getView().status).toMatchObject({ online: false, pendingCount: 2 });
    e.stop(); // "reload" while offline

    const dev2 = cloud.device('phone-reloaded');
    dev2.setOnline(false);
    const again = engine('alice', local, dev2, { online: false });
    await again.start();
    expect(again.getView().status.pendingCount).toBe(2);
    expect(learnedOf(again)).toEqual([ids[5], ids[6]].sort());
    dev2.setOnline(true);
    again.setOnline(true);
    await until(() => settled(again), 3000, 'reconnect flush');
    expect(cloud.serverState('alice').get(ids[5]!)).toBe(true);
    expect(cloud.serverState('alice').get(ids[6]!)).toBe(true);
  });

  it('retries transient errors with backoff and succeeds', async () => {
    const cloud = createFakeCloud();
    const dev = cloud.device('laptop');
    dev.failNextWrites(2, { code: 'unavailable', permanent: false });
    const e = engine('alice', createMemoryStore(), dev);
    await e.start();
    void e.setLearned(ids[7]!, true);
    await until(() => settled(e), 10_000, 'retry'); // generous: shared CI runners can delay timers
    expect(cloud.serverState('alice').get(ids[7]!)).toBe(true);
  });

  it('surfaces permanent failures, keeps the change, and retries on request', async () => {
    const cloud = createFakeCloud();
    const dev = cloud.device('laptop');
    dev.failNextWrites(1, { code: 'permission-denied', permanent: true });
    const e = engine('alice', createMemoryStore(), dev);
    await e.start();
    void e.setLearned(ids[8]!, true);
    await until(() => e.getView().stateOf(ids[8]!) === 'failed');
    expect(e.getView().status).toMatchObject({ failedCount: 1, lastError: 'permission-denied' });
    expect(e.getView().learned.has(ids[8]!)).toBe(true); // not discarded
    e.retryFailed();
    await until(() => settled(e));
    expect(cloud.serverState('alice').get(ids[8]!)).toBe(true);
  });
});

describe('two devices, same account', () => {
  it('20 words marked on the laptop appear on the phone; a phone change reaches the laptop', async () => {
    const cloud = createFakeCloud();
    const laptop = engine('alice', createMemoryStore(), cloud.device('laptop'));
    await laptop.start();
    const twenty = ids.slice(100, 120);
    for (const id of twenty) void laptop.setLearned(id, true);
    await until(() => settled(laptop), 3000);

    const phone = engine('alice', createMemoryStore(), cloud.device('phone'));
    await phone.start();
    await until(() => phone.getView().learned.size === 20, 3000, 'phone receives 20');
    expect(learnedOf(phone)).toEqual([...twenty].sort());

    await phone.setLearned(twenty[0]!, false);
    await until(() => !laptop.getView().learned.has(twenty[0]!), 3000, 'laptop receives unmark');
    expect(laptop.getView().learned.size).toBe(19);
  });

  it('an incoming snapshot never overwrites an unsynced local change', async () => {
    const cloud = createFakeCloud();
    const laptopRemote = cloud.device('laptop');
    const phoneRemote = cloud.device('phone');
    const laptop = engine('alice', createMemoryStore(), laptopRemote);
    const phone = engine('alice', createMemoryStore(), phoneRemote);
    await laptop.start();
    await phone.start();

    phoneRemote.setOnline(false);
    phone.setOnline(false);
    await phone.setLearned(ids[9]!, false); // offline intent: NOT learned
    await laptop.setLearned(ids[9]!, true); // online: learned
    await until(() => settled(laptop));
    phoneRemote.setOnline(true); // snapshot (learned=true) and phone's queued write race
    phone.setOnline(true);
    await new Promise((r) => setTimeout(r, 10));
    // While its own write is pending, the phone keeps showing the user's last action.
    if (phone.hasPending(ids[9]!)) expect(phone.getView().learned.has(ids[9]!)).toBe(false);
    await until(() => settled(phone), 3000);
    // Server order decides: the phone's write reached the server last → not learned everywhere.
    expect(cloud.serverState('alice').get(ids[9]!)).toBe(false);
    await until(() => !laptop.getView().learned.has(ids[9]!), 3000, 'laptop converges');
    expect(phone.getView().learned.has(ids[9]!)).toBe(false);
  });

  it('concurrent online edits of the same word converge to the server’s last commit', async () => {
    const cloud = createFakeCloud();
    const a = engine('alice', createMemoryStore(), cloud.device('a'));
    const b = engine('alice', createMemoryStore(), cloud.device('b'));
    await a.start();
    await b.start();
    void a.setLearned(ids[10]!, true);
    void b.setLearned(ids[10]!, false);
    await until(() => settled(a) && settled(b), 3000);
    await new Promise((r) => setTimeout(r, 30));
    const server = cloud.serverState('alice').get(ids[10]!);
    expect(a.getView().learned.has(ids[10]!)).toBe(server);
    expect(b.getView().learned.has(ids[10]!)).toBe(server);
  });
});

describe('account isolation', () => {
  it('two accounts on one device never see each other’s progress or pending queue', async () => {
    const cloud = createFakeCloud();
    const local = createMemoryStore();
    const dev = cloud.device('shared-laptop');
    dev.setOnline(false);
    const alice = engine('alice', local, dev, { online: false });
    await alice.start();
    await alice.setLearned(ids[11]!, true); // stays pending (offline)
    alice.stop(); // sign out with a pending change: it is kept for alice

    dev.setOnline(true);
    const bob = engine('bob', local, dev);
    await bob.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(learnedOf(bob)).toEqual([]);
    expect(bob.getView().status.pendingCount).toBe(0);
    expect(cloud.writeLog).toHaveLength(0); // alice's change was not sent under bob
    await bob.setLearned(ids[12]!, true);
    await until(() => settled(bob));
    expect(cloud.serverState('bob').get(ids[12]!)).toBe(true);
    expect(cloud.serverState('alice').size).toBe(0);
    bob.stop();

    const aliceAgain = engine('alice', local, dev);
    await aliceAgain.start();
    expect(aliceAgain.getView().learned.has(ids[12]!)).toBe(false);
    await until(() => settled(aliceAgain), 3000, 'alice resumes her queue');
    expect(cloud.serverState('alice').get(ids[11]!)).toBe(true);
    expect(cloud.writeLog.map((w) => `${w.uid}:${w.write.wordId}`)).toEqual([`bob:${ids[12]}`, `alice:${ids[11]}`]);
  });
});

describe('pending local change vs. remote snapshot (deterministic)', () => {
  it('holds the local value while its write is in flight, then converges to the server order', async () => {
    const cloud = createFakeCloud();
    const phoneUnderlying = cloud.device('phone');
    let release: (() => void) | null = null;
    const heldPhone: ProgressRemote = {
      subscribe: (uid, h) => phoneUnderlying.subscribe(uid, h),
      // The phone's write is held "in flight" until released.
      write: (uid, w) => new Promise<void>((resolve, reject) => {
        release = () => { phoneUnderlying.write(uid, w).then(resolve, reject); };
      }),
    };
    const laptop = engine('alice', createMemoryStore(), cloud.device('laptop'));
    const phone = engine('alice', createMemoryStore(), heldPhone);
    await laptop.start();
    await phone.start();

    void phone.setLearned(ids[13]!, false); // user intent on the phone (write held)
    await until(() => release !== null, 1000, 'phone write started');
    await laptop.setLearned(ids[13]!, true);
    await until(() => settled(laptop));
    await until(() => phone.confirmedOf(ids[13]!)?.learned === true, 2000, 'phone received laptop snapshot');
    // The snapshot is recorded as server state but does NOT override the pending local action.
    expect(phone.getView().learned.has(ids[13]!)).toBe(false);
    expect(phone.getView().stateOf(ids[13]!)).toBe('pending');

    release!();
    await until(() => settled(phone), 2000, 'phone write confirmed');
    expect(cloud.serverState('alice').get(ids[13]!)).toBe(false);
    await until(() => !laptop.getView().learned.has(ids[13]!), 2000, 'laptop converges');
  });
});

describe('read cost: incremental synchronisation', () => {
  it('first start reads everything; the next start reads only documents changed since the local copy', async () => {
    const cloud = createFakeCloud();
    const laptopLocal = createMemoryStore();
    const writer = engine('alice', createMemoryStore(), cloud.device('writer'));
    await writer.start();
    for (const id of ids.slice(500, 520)) void writer.setLearned(id, true);
    await until(() => settled(writer), 3000);

    const laptop = engine('alice', laptopLocal, cloud.device('laptop'));
    await laptop.start();
    await until(() => laptop.getView().learned.size === 20, 3000);
    laptop.stop();
    const fullReads = cloud.readLog.filter((r) => r.device === 'laptop').length;
    expect(fullReads).toBe(20);

    await writer.setLearned(ids[520]!, true); // one change while the laptop is closed
    await until(() => settled(writer));

    const laptopAgain = engine('alice', laptopLocal, cloud.device('laptop-again'));
    await laptopAgain.start();
    await until(() => laptopAgain.getView().learned.size === 21, 3000, 'incremental change arrives');
    const incremental = cloud.readLog.filter((r) => r.device === 'laptop-again');
    expect(incremental.map((r) => r.wordId)).toEqual([ids[520]]); // 1 read instead of 21
    expect(incremental[0]!.since).toBeTypeOf('number');
  });

  it('falls back to a full read when the last full sync is older than the interval', async () => {
    const cloud = createFakeCloud();
    const local = createMemoryStore();
    let clock = 1_000_000_000_000;
    const now = () => clock;
    const writer = engine('alice', createMemoryStore(), cloud.device('w'));
    await writer.start();
    for (const id of ids.slice(600, 605)) void writer.setLearned(id, true);
    await until(() => settled(writer));
    const first = engine('alice', local, cloud.device('d1'), { now, fullResyncIntervalMs: 1000 });
    await first.start();
    await until(() => first.getView().learned.size === 5);
    first.stop();
    clock += 5000; // interval elapsed
    const second = engine('alice', local, cloud.device('d2'), { now, fullResyncIntervalMs: 1000 });
    await second.start();
    await until(() => cloud.readLog.filter((r) => r.device === 'd2').length === 5, 3000, 'full re-read');
    expect(cloud.readLog.filter((r) => r.device === 'd2').every((r) => r.since === undefined)).toBe(true);
  });

  it('without a local copy (new device / cleared storage) it always reads everything', async () => {
    const cloud = createFakeCloud();
    const writer = engine('alice', createMemoryStore(), cloud.device('w'));
    await writer.start();
    await writer.setLearned(ids[700]!, true);
    await until(() => settled(writer));
    const fresh = engine('alice', createMemoryStore(), cloud.device('fresh'));
    await fresh.start();
    await until(() => fresh.getView().learned.has(ids[700]!));
    expect(cloud.readLog.filter((r) => r.device === 'fresh')[0]!.since).toBeUndefined();
  });
});
