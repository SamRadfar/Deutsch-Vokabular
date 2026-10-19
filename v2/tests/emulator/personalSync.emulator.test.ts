// Personal vocabulary sync through the REAL Firebase SDK, Firestore Emulator and Auth Emulator
// (v2/firestore.rules incl. customWords loaded by the emulator from firebase.json). "Devices" are
// separate Firebase app instances, each with its own local store. Not real Google OAuth.

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, disableNetwork, doc, enableNetwork, getDoc, getDocs, initializeFirestore, memoryLocalCache, type Firestore,
} from 'firebase/firestore';
import { createMemoryStore, type ProgressLocalStore } from '../../src/features/progress/localStore';
import { PersonalVocabulary } from '../../src/features/personal/personalVocabulary';
import { createFirestoreCustomWordsRemote } from '../../src/features/personal/firestoreCustomWordsRemote';
import type { PersonalWordInput } from '../../src/features/personal/model';
import type { DocRemote } from '../../src/features/sync/docSyncEngine';
import type { CustomWordValue } from '../../src/features/personal/syncModel';
import { until } from '../helpers/fakeCloud';

const PROJECT = 'demo-deutsch-vokabular';
const HOST = '127.0.0.1';
const apps: FirebaseApp[] = [];
const vocabs: PersonalVocabulary[] = [];
let counter = 0;

const input = (o: Partial<PersonalWordInput> = {}): PersonalWordInput => ({
  article: 'die', lemma: 'Probewand', type: 'n', grammar: '', fa: 'دیوار آزمایشی', example: '', exampleFa: '', pronunciationFa: '', placement: null, ...o,
});

async function device(googleSub: string) {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com`, appId: 'demo-app' }, `pw-${++counter}-${Date.now()}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
  const cred = GoogleAuthProvider.credential(JSON.stringify({ sub: googleSub, email: `${googleSub}@example.test`, email_verified: true }));
  const { user } = await signInWithCredential(auth, cred);
  const db: Firestore = initializeFirestore(app, { localCache: memoryLocalCache() });
  connectFirestoreEmulator(db, HOST, 8080);
  return { uid: user.uid, db, remote: createFirestoreCustomWordsRemote(Promise.resolve(db)), local: createMemoryStore() };
}

async function open(d: { uid: string; remote: DocRemote<CustomWordValue>; local: ProgressLocalStore }, opts: { online?: boolean; remote?: DocRemote<CustomWordValue> } = {}) {
  const v = new PersonalVocabulary(d.uid, d.local, {
    remote: opts.remote ?? d.remote, deviceId: `device-${vocabs.length}`, online: opts.online ?? true, retryBaseMs: 50, retryMaxMs: 200, firstSnapshotTimeoutMs: 3000,
  });
  vocabs.push(v);
  await v.load();
  return v;
}
const words = (v: PersonalVocabulary) => v.getSnapshot().words;
const lemmas = (v: PersonalVocabulary) => words(v).map((w) => w.lemma).sort();
const settled = (v: PersonalVocabulary) => v.getSnapshot().sync.status.pendingCount === 0;

afterEach(() => { for (const v of vocabs.splice(0)) v.stop(); });
afterAll(async () => { await Promise.all(apps.map((a) => deleteApp(a))); });

describe('personal vocabulary sync (emulator, real SDK)', () => {
  it('a new word, an edit, a learned flag and a deletion travel between two devices', async () => {
    const sub = `pw-two-${Date.now()}`;
    const laptopDev = await device(sub);
    const phoneDev = await device(sub);
    const laptop = await open(laptopDev);
    const phone = await open(phoneDev);

    const r = laptop.add(input());
    const id = r.ok ? r.word.id : '';
    await until(() => words(phone).some((w) => w.id === id), 15_000, 'phone receives new word');
    expect(phone.getSnapshot().byId.get(id)).toMatchObject({ article: 'die', lemma: 'Probewand', fa: 'دیوار آزمایشی', source: 'manual' });

    phone.update(id, input({ fa: 'دیوار آزمایشی (ویرایش)' }));
    await until(() => laptop.getSnapshot().byId.get(id)?.fa === 'دیوار آزمایشی (ویرایش)', 15_000, 'laptop receives edit');
    laptop.setLearned(id, true);
    await until(() => phone.getSnapshot().byId.get(id)?.learned === true, 15_000, 'phone receives learned');

    phone.remove(id);
    await until(() => !laptop.getSnapshot().byId.has(id), 15_000, 'laptop receives deletion');
    // The cloud keeps a tombstone, not a hole: other devices learn about the deletion.
    const stored = await getDoc(doc(laptopDev.db, 'users', laptopDev.uid, 'customWords', id));
    expect(stored.data()).toMatchObject({ deleted: true, id, schemaVersion: 1 });
  });

  it('offline creation, editing and deletion are queued and synchronised after reconnection', async () => {
    const sub = `pw-offline-${Date.now()}`;
    const a = await device(sub);
    const b = await device(sub);
    const offline = await open(a);
    await until(() => offline.getSnapshot().sync.status.remote === 'live', 15_000, 'connected');
    await disableNetwork(a.db);
    offline.setOnline(false);
    const keep = offline.add(input({ lemma: 'Offlinewort' }));
    const gone = offline.add(input({ lemma: 'Kurzlebig' }));
    if (keep.ok) offline.update(keep.word.id, input({ lemma: 'Offlinewort', fa: 'ویرایش آفلاین' }));
    if (gone.ok) offline.remove(gone.word.id);
    expect(offline.getSnapshot().sync.status.pendingCount).toBe(2);

    await enableNetwork(a.db);
    offline.setOnline(true);
    await until(() => settled(offline), 15_000, 'offline queue uploaded');
    const other = await open(b);
    await until(() => words(other).length === 1, 15_000, 'other device sees the result');
    expect(words(other)[0]).toMatchObject({ lemma: 'Offlinewort', fa: 'ویرایش آفلاین' });
  });

  it('concurrent edits converge deterministically (last write in server order wins on every device)', async () => {
    const sub = `pw-race-${Date.now()}`;
    const [a, b] = [await device(sub), await device(sub)];
    const one = await open(a);
    const two = await open(b);
    const r = one.add(input());
    const id = r.ok ? r.word.id : '';
    await until(() => two.getSnapshot().byId.has(id), 15_000, 'shared');
    one.update(id, input({ fa: 'نسخهٔ یک' }));
    two.update(id, input({ fa: 'نسخهٔ دو' }));
    await until(() => settled(one) && settled(two), 15_000, 'both uploaded');
    await until(() => one.getSnapshot().byId.get(id)?.fa === two.getSnapshot().byId.get(id)?.fa, 15_000, 'converged');
    const server = (await getDoc(doc(a.db, 'users', a.uid, 'customWords', id))).data()!;
    expect(one.getSnapshot().byId.get(id)!.fa).toBe(server.fa);
  });

  it('a stale offline edit cannot resurrect a word deleted elsewhere; the edit is kept as a new word', async () => {
    const sub = `pw-zombie-${Date.now()}`;
    const [a, b] = [await device(sub), await device(sub)];
    const deleter = await open(a);
    const editor = await open(b);
    const r = deleter.add(input({ lemma: 'Zombiewort' }));
    const id = r.ok ? r.word.id : '';
    await until(() => editor.getSnapshot().byId.has(id), 15_000, 'shared');

    await disableNetwork(b.db);
    editor.setOnline(false);
    editor.update(id, input({ lemma: 'Zombiewort', fa: 'ویرایش دیرهنگام' }));
    deleter.remove(id);
    await until(() => settled(deleter), 15_000, 'tombstone stored');

    await enableNetwork(b.db);
    editor.setOnline(true);
    await until(() => editor.getSnapshot().conflicts.length === 1, 20_000, 'conflict resolved as a copy');
    const notice = editor.getSnapshot().conflicts[0]!;
    expect(notice.deletedId).toBe(id);
    await until(() => settled(editor), 15_000, 'copy uploaded');
    expect(editor.getSnapshot().byId.has(id)).toBe(false); // the deleted word stays deleted
    expect(editor.getSnapshot().byId.get(notice.copyId)).toMatchObject({ lemma: 'Zombiewort', fa: 'ویرایش دیرهنگام' });
    expect((await getDoc(doc(a.db, 'users', a.uid, 'customWords', id))).data()).toMatchObject({ deleted: true });
    await until(() => deleter.getSnapshot().byId.get(notice.copyId)?.fa === 'ویرایش دیرهنگام', 15_000, 'copy reaches the other device');
  });

  it('an interrupted upload is retried; duplicate deliveries do not create duplicate words', async () => {
    const sub = `pw-retry-${Date.now()}`;
    const d = await device(sub);
    let failures = 2;
    const flaky: DocRemote<CustomWordValue> = {
      subscribe: d.remote.subscribe,
      write: (uid, w) => (failures-- > 0 ? Promise.reject({ code: 'unavailable' }) : d.remote.write(uid, w)),
    };
    const v = await open(d, { remote: flaky });
    const r = v.add(input({ lemma: 'Wiederholt' }));
    expect(v.getSnapshot().sync.stateOf(r.ok ? r.word.id : '')).toBe('pending');
    await until(() => settled(v), 25_000, 'uploaded after retries'); // backoff 2 s + 4 s; headroom for slow CI runners
    const all = await getDocs(collection(d.db, 'users', d.uid, 'customWords'));
    expect(all.size).toBe(1);
    expect(words(v)).toHaveLength(1);
  });

  it('survives a reload: queued changes from the previous session are uploaded', async () => {
    const sub = `pw-reload-${Date.now()}`;
    const d = await device(sub);
    const first = await open(d, { online: false });
    first.add(input({ lemma: 'Vorgemerkt' }));
    await first.flushed();
    first.stop();
    const second = await open(d); // same device store, online now
    expect(lemmas(second)).toEqual(['Vorgemerkt']);
    await until(() => settled(second), 25_000, 'uploaded after reload');
    expect((await getDocs(collection(d.db, 'users', d.uid, 'customWords'))).size).toBe(1);
  });

  it('accounts are isolated: another account sees nothing and cannot read the documents', async () => {
    const alice = await device(`pw-alice-${Date.now()}`);
    const bob = await device(`pw-bob-${Date.now()}`);
    const av = await open(alice);
    av.add(input({ lemma: 'Privat' }));
    await until(() => settled(av), 15_000, 'uploaded');
    const bv = await open(bob);
    await until(() => bv.getSnapshot().sync.status.remote === 'live', 15_000, 'bob connected');
    expect(words(bv)).toEqual([]);
    await expect(getDocs(collection(bob.db, 'users', alice.uid, 'customWords'))).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('Phase 5A words of this device are uploaded once (takeover), the old store is kept', async () => {
    const d = await device(`pw-5a-${Date.now()}`);
    await d.local.putPersonalWord(d.uid, {
      schemaVersion: 1, id: 'pw_00000000000000005a5a', article: null, lemma: 'Altbestand', type: 'au', grammar: '', fa: 'از فاز ۵A',
      example: '', exampleFa: '', pronunciationFa: '', placement: null, learned: true, createdAt: 1_760_000_000_000, updatedAt: 1_760_000_000_000,
      source: 'manual', legacyId: null,
    });
    const v = await open(d);
    expect(lemmas(v)).toEqual(['Altbestand']);
    await until(() => settled(v), 15_000, 'uploaded');
    expect((await getDoc(doc(d.db, 'users', d.uid, 'customWords', 'pw_00000000000000005a5a'))).data()).toMatchObject({ lemma: 'Altbestand', learned: true });
    expect(await d.local.loadPersonalWords(d.uid)).toHaveLength(1); // kept as a backup
    v.stop();
    const again = await open(d);
    expect(again.getSnapshot().sync.status.pendingCount).toBe(0); // not queued a second time
  });
});
