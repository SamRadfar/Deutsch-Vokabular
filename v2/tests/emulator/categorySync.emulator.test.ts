// Account categories through the REAL Firebase SDK, Firestore Emulator and Auth Emulator
// (v2/firestore.rules incl. users/{uid}/categories). "Devices" are separate Firebase app instances,
// each with its own local store. Not real Google OAuth, never the real project.

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { collection, connectFirestoreEmulator, getDocs, initializeFirestore, memoryLocalCache, type Firestore } from 'firebase/firestore';
import { createMemoryStore, type ProgressLocalStore } from '../../src/features/progress/localStore';
import { CategoryStore } from '../../src/features/categories/categoryStore';
import { createFirestoreCategoriesRemote } from '../../src/features/categories/firestoreCategoriesRemote';
import { applyDestination, placementOf } from '../../src/features/categories/catalog';
import { PersonalVocabulary } from '../../src/features/personal/personalVocabulary';
import { createFirestoreCustomWordsRemote } from '../../src/features/personal/firestoreCustomWordsRemote';
import { until } from '../helpers/fakeCloud';

const PROJECT = 'demo-deutsch-vokabular';
const HOST = '127.0.0.1';
const KEYS = new Set(['arch', 'fitness']);
const apps: FirebaseApp[] = [];
const open: Array<{ stop(): void }> = [];
let counter = 0;

async function device(googleSub: string) {
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com`, appId: 'demo-app' }, `uc-${++counter}-${Date.now()}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
  const cred = GoogleAuthProvider.credential(JSON.stringify({ sub: googleSub, email: `${googleSub}@example.test`, email_verified: true }));
  const { user } = await signInWithCredential(auth, cred);
  const db: Firestore = initializeFirestore(app, { localCache: memoryLocalCache() });
  connectFirestoreEmulator(db, HOST, 8080);
  return { uid: user.uid, db, local: createMemoryStore() as ProgressLocalStore };
}

async function categories(d: Awaited<ReturnType<typeof device>>, online = true) {
  const s = new CategoryStore(d.uid, d.local, { remote: createFirestoreCategoriesRemote(Promise.resolve(d.db)), deviceId: `device-${counter}-${open.length}`, online, retryBaseMs: 50, retryMaxMs: 200 });
  open.push(s);
  await s.load();
  return s;
}
async function vocabulary(d: Awaited<ReturnType<typeof device>>) {
  const v = new PersonalVocabulary(d.uid, d.local, { remote: createFirestoreCustomWordsRemote(Promise.resolve(d.db)), deviceId: `device-${counter}-${open.length}`, online: true, retryBaseMs: 50, retryMaxMs: 200, firstSnapshotTimeoutMs: 3000 });
  open.push(v);
  await v.load();
  return v;
}
const names = (s: CategoryStore) => s.getSnapshot().categories.map((c) => c.name).sort();

afterEach(() => { for (const s of open.splice(0)) s.stop(); });
afterAll(async () => { await Promise.all(apps.map((a) => deleteApp(a))); });

describe('category sync (emulator, real SDK)', () => {
  it('create (main, sub, sub under a built-in), rename and delete travel between two devices; ids stay', async () => {
    const sub = `uc-two-${Date.now()}`;
    const laptopDev = await device(sub);
    const phoneDev = await device(sub);
    const laptop = await categories(laptopDev);
    const phone = await categories(phoneDev);

    const main = laptop.create('Reisen', null, KEYS);
    if (!main.ok) throw new Error('create');
    laptop.create('Flughafen', main.category.id, KEYS);
    laptop.create('Holzbau', 'arch', KEYS);
    await until(() => names(phone).join() === 'Flughafen,Holzbau,Reisen', 15_000, 'phone receives categories');
    expect(phone.children('arch').map((c) => c.name)).toEqual(['Holzbau']);

    phone.rename(main.category.id, 'Urlaub');
    await until(() => laptop.getSnapshot().byId.get(main.category.id)?.name === 'Urlaub', 15_000, 'laptop receives rename');

    laptop.remove(main.category.id);
    await until(() => names(phone).join() === 'Holzbau', 15_000, 'phone receives deletion (with the sub)');
    const cloud = await getDocs(collection(laptopDev.db, 'users', laptopDev.uid, 'categories'));
    expect(cloud.docs.filter((d) => d.data().deleted === true)).toHaveLength(2); // tombstones, never a hole

    // After a reload (new store on a fresh device cache) everything is still there.
    const fresh = await categories(await device(sub));
    await until(() => names(fresh).join() === 'Holzbau', 15_000, 'reload sees the categories');
  });

  it('words placed in a new category sync together with it (AI import path: categories committed at import)', async () => {
    const sub = `uc-words-${Date.now()}`;
    const aDev = await device(sub);
    const bDev = await device(sub);
    const [aCats, aWords] = [await categories(aDev), await vocabulary(aDev)];
    const [bCats, bWords] = [await categories(bDev), await vocabulary(bDev)];
    const placed = applyDestination({ kind: 'newMain', name: 'Kleidung', subName: 'Schuhe' }, aCats, KEYS);
    if (!placed.ok) throw new Error(placed.error);
    const again = applyDestination({ kind: 'newMain', name: 'Kleidung', subName: 'Schuhe' }, aCats, KEYS); // retry
    expect(again).toEqual(placed);
    const r = aWords.add({ article: 'der', lemma: 'Stiefel', type: 'n', grammar: '', fa: 'چکمه', example: '', exampleFa: '', pronunciationFa: '', placement: placed.placement });
    expect(r.ok).toBe(true);
    await until(() => bWords.getSnapshot().words.some((w) => w.lemma === 'Stiefel'), 15_000, 'word arrives');
    await until(() => names(bCats).join() === 'Kleidung,Schuhe', 15_000, 'categories arrive');
    expect(bWords.getSnapshot().words.find((w) => w.lemma === 'Stiefel')!.placement).toEqual(placement(bCats));
    function placement(s: CategoryStore) {
      const m = s.children(null)[0]!;
      return placementOf(m.id, s.children(m.id)[0]!.id);
    }
  });

  it('offline: created on the device, uploaded after reconnect', async () => {
    const sub = `uc-off-${Date.now()}`;
    const offline = await categories(await device(sub), false);
    offline.create('Offline-Kategorie', null, KEYS);
    expect(offline.getSnapshot().sync.status.pendingCount).toBeGreaterThan(0);
    const other = await categories(await device(sub));
    offline.setOnline(true);
    await until(() => names(other).includes('Offline-Kategorie'), 15_000, 'uploaded after reconnect');
  });

  it('accounts are isolated: another account sees nothing', async () => {
    const alice = await categories(await device(`uc-alice-${Date.now()}`));
    alice.create('Privat', null, KEYS);
    await until(() => alice.getSnapshot().sync.status.pendingCount === 0, 15_000, 'alice uploaded');
    const bobDev = await device(`uc-bob-${Date.now()}`);
    const bob = await categories(bobDev);
    await new Promise((r) => setTimeout(r, 500));
    expect(names(bob)).toEqual([]);
    const aliceUid = alice.uid;
    await expect(getDocs(collection(bobDev.db, 'users', aliceUid, 'categories'))).rejects.toThrow();
  });
});
