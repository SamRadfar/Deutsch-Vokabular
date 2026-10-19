// End-to-end synchronisation through the REAL Firebase SDK, Firestore Emulator and Auth
// Emulator (with v2/firestore.rules loaded by the emulator from firebase.json).
// "Devices" are separate Firebase app instances with their own local stores.
// The Auth Emulator accepts fake Google credentials — this is NOT real Google OAuth.

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import {
  connectFirestoreEmulator, disableNetwork, enableNetwork, initializeFirestore, memoryLocalCache, type Firestore,
} from 'firebase/firestore';
import { ProgressSyncEngine } from '../../src/features/progress/syncEngine';
import { createMemoryStore } from '../../src/features/progress/localStore';
import { createFirestoreProgressRemote } from '../../src/features/progress/firestoreProgressRemote';
import { createFirestoreAccountRemote, type MigrationRecord } from '../../src/features/progress/accountRemote';
import { getBundledRepository as getVocabularyRepository } from '../../src/services/content/bundled';
import { until } from '../helpers/fakeCloud';

const PROJECT = 'demo-deutsch-vokabular';
const HOST = '127.0.0.1';
const repo = getVocabularyRepository();
const ids = repo.categories.flatMap((c) => c.subtabs.flatMap((s) => s.groups.flatMap((g) => g.entries.map((e) => e.id))));
const knownIds = new Set(ids);

const apps: FirebaseApp[] = [];
const engines: ProgressSyncEngine[] = [];
let counter = 0;

async function device(googleSub: string) {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com`, appId: 'demo-app' }, `dev-${++counter}-${Date.now()}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
  const cred = GoogleAuthProvider.credential(JSON.stringify({ sub: googleSub, email: `${googleSub}@example.test`, email_verified: true }));
  const { user } = await signInWithCredential(auth, cred);
  const db: Firestore = initializeFirestore(app, { localCache: memoryLocalCache() });
  connectFirestoreEmulator(db, HOST, 8080);
  return { uid: user.uid, db, remote: createFirestoreProgressRemote(Promise.resolve(db)), account: createFirestoreAccountRemote(Promise.resolve(db)) };
}

function startEngine(uid: string, remote: ReturnType<typeof createFirestoreProgressRemote>, online = true) {
  const e = new ProgressSyncEngine({ uid, local: createMemoryStore(), remote, deviceId: `device-${engines.length}`, knownIds, online, retryBaseMs: 50, firstSnapshotTimeoutMs: 3000 });
  engines.push(e);
  return e;
}
const settled = (e: ProgressSyncEngine) => e.getView().status.pendingCount === 0;

afterEach(() => { for (const e of engines.splice(0)) e.stop(); });
afterAll(async () => { await Promise.all(apps.map((a) => deleteApp(a))); });

describe('cross-device synchronisation (emulator)', () => {
  it('the same Google account on two devices maps to one uid and shares progress both ways', async () => {
    const sub = `alice-${Date.now()}`;
    const laptopDev = await device(sub);
    const phoneDev = await device(sub);
    expect(phoneDev.uid).toBe(laptopDev.uid); // identity = Firebase uid, not email

    const laptop = startEngine(laptopDev.uid, laptopDev.remote);
    await laptop.start();
    const twenty = ids.slice(200, 220);
    for (const id of twenty) void laptop.setLearned(id, true);
    await until(() => settled(laptop), 15_000, 'laptop confirmed');

    const phone = startEngine(phoneDev.uid, phoneDev.remote);
    await phone.start();
    await until(() => phone.getView().learned.size === 20, 15_000, 'phone receives 20');

    await phone.setLearned(twenty[0]!, false);
    await until(() => !laptop.getView().learned.has(twenty[0]!), 15_000, 'laptop receives unmark');
    expect(laptop.getView().learned.size).toBe(19);
  });

  it('offline edits are queued and synchronised after reconnection', async () => {
    const sub = `offline-${Date.now()}`;
    const dev = await device(sub);
    const e = startEngine(dev.uid, dev.remote);
    await e.start();
    await disableNetwork(dev.db);
    e.setOnline(false);
    await e.setLearned(ids[300]!, true);
    expect(e.getView().status).toMatchObject({ online: false, pendingCount: 1 });
    await enableNetwork(dev.db);
    e.setOnline(true);
    await until(() => settled(e), 15_000, 'flush after reconnect');

    // A second device of the SAME account receives the change from the server.
    const second = await device(sub);
    const verify = startEngine(second.uid, second.remote);
    await verify.start();
    await until(() => verify.getView().learned.has(ids[300]!), 15_000, 'second device receives offline edit');
    // A different account sees nothing in its own (empty) progress.
    const stranger = await device(`${sub}-stranger`);
    const strangerEngine = startEngine(stranger.uid, stranger.remote);
    await strangerEngine.start();
    await until(() => strangerEngine.getView().status.remote === 'live', 15_000, 'stranger live');
    expect(strangerEngine.getView().learned.size).toBe(0);
  });
});

describe('read cost through the real adapter', () => {
  it('a restart with a local copy uses an incremental query and receives only changed documents', async () => {
    const sub = `incr-${Date.now()}`;
    const writerDev = await device(sub);
    const writer = startEngine(writerDev.uid, writerDev.remote);
    await writer.start();
    const five = ids.slice(800, 805);
    for (const id of five) void writer.setLearned(id, true);
    await until(() => settled(writer), 15_000, 'writer confirmed');

    const local = createMemoryStore();
    const readerDev = await device(sub);
    const counting = (label: string, sink: string[][]) => ({
      ...readerDev.remote,
      subscribe: (uid: string, h: Parameters<typeof readerDev.remote.subscribe>[1], o?: Parameters<typeof readerDev.remote.subscribe>[2]) =>
        readerDev.remote.subscribe(uid, { ...h, onDocs: (docs) => { sink.push([label, ...docs.map((d) => d.wordId)]); h.onDocs(docs); } }, o),
    });
    const firstBatches: string[][] = [];
    const first = new ProgressSyncEngine({ uid: readerDev.uid, local, remote: counting('first', firstBatches), deviceId: 'r1', knownIds, retryBaseMs: 50, firstSnapshotTimeoutMs: 3000 });
    engines.push(first);
    await first.start();
    await until(() => first.getView().learned.size === 5, 15_000, 'full read');
    first.stop();
    expect(firstBatches.flatMap((b) => b.slice(1)).sort()).toEqual([...five].sort());

    await writer.setLearned(ids[805]!, true);
    await until(() => settled(writer), 15_000);

    const secondBatches: string[][] = [];
    const second = new ProgressSyncEngine({ uid: readerDev.uid, local, remote: counting('second', secondBatches), deviceId: 'r2', knownIds, retryBaseMs: 50, firstSnapshotTimeoutMs: 3000 });
    engines.push(second);
    await second.start();
    await until(() => second.getView().learned.size === 6, 15_000, 'incremental change');
    expect(secondBatches.flatMap((b) => b.slice(1))).toEqual([ids[805]]);
  });
});

describe('isolation and rules through the real adapter', () => {
  it('a different account cannot subscribe to or write another user’s progress', async () => {
    const alice = await device(`iso-alice-${Date.now()}`);
    const bob = await device(`iso-bob-${Date.now()}`);
    const intruder = startEngine(alice.uid, bob.remote); // bob's credentials, alice's path
    await intruder.start();
    await until(() => intruder.getView().status.remote === 'error', 15_000, 'listen denied');
    expect(intruder.getView().status.lastError).toBe('permission-denied');
    void intruder.setLearned(ids[400]!, true);
    await until(() => intruder.getView().stateOf(ids[400]!) === 'failed', 15_000, 'write denied');
  });

  it('profile document and create-only migration record', async () => {
    const dev = await device(`acct-${Date.now()}`);
    await dev.account.saveProfile(dev.uid, { displayName: 'Alice', photoURL: null });
    const hash = 'f'.repeat(64);
    expect(await dev.account.getMigrationRecord(dev.uid, hash)).toBeNull();
    const record: MigrationRecord = {
      schemaVersion: 1, inputHash: hash, source: 'backup-file', legacyContentCommit: '6763003', contentVersion: '1.0.0', status: 'completed',
      counts: { matchedEntries: 2, imported: 2, alreadyLearned: 0, conflictsSkipped: 0, ambiguousKeys: 0, orphanedKeys: 0 },
    };
    await dev.account.createMigrationRecord(dev.uid, record);
    expect(await dev.account.getMigrationRecord(dev.uid, hash)).toMatchObject({ inputHash: hash, status: 'completed' });
    await expect(dev.account.createMigrationRecord(dev.uid, record)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
