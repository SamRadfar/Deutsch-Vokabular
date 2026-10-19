// Owner library (users/{uid}/library/*) on the Firebase Emulator: rules, and the app's real
// Firestore loader against seeded documents (split → store → watch → verify → repository).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { bundledContent } from '../../src/services/content/bundled';
import { LIBRARY_META_ID, splitLibrary } from '../../src/features/library/format';
import { createFirestoreLibraryRemote } from '../../src/features/library/firestoreLibraryRemote';
import { createLibraryService, memoryLibraryCache, type LibraryState } from '../../src/features/library/libraryService';

const PROJECT = 'demo-deutsch-vokabular';
let env: RulesTestEnvironment;
const library = await splitLibrary(bundledContent as never);

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'), host: host!, port: Number(port) },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

/** The owner import, as the import script does it (rules bypassed = IAM-authorized admin write). */
async function seed(uid: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [id, json] of Object.entries(library.chunks)) await setDoc(doc(db, `users/${uid}/library/${id}`), { json });
    await setDoc(doc(db, `users/${uid}/library/${LIBRARY_META_ID}`), library.meta);
  });
}

describe('library rules', () => {
  it('only the owner can read their library; nobody can list another library', async () => {
    await seed('owner');
    const owner = env.authenticatedContext('owner').firestore();
    const other = env.authenticatedContext('other').firestore();
    await assertSucceeds(getDoc(doc(owner, 'users/owner/library/meta')));
    await assertSucceeds(getDocs(collection(owner, 'users/owner/library')));
    await assertFails(getDoc(doc(other, 'users/owner/library/meta')));
    await assertFails(getDocs(collection(other, 'users/owner/library')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/owner/library/category-arch')));
  });

  it('no client can write any library — not even the owner', async () => {
    await seed('owner');
    const owner = env.authenticatedContext('owner').firestore();
    await assertFails(setDoc(doc(owner, 'users/owner/library/meta'), { format: 'x' }));
    await assertFails(updateDoc(doc(owner, 'users/owner/library/category-arch'), { json: '{}' }));
    await assertFails(deleteDoc(doc(owner, 'users/owner/library/category-arch')));
    await assertFails(setDoc(doc(owner, 'users/owner/library/extra'), { json: '[]' }));
    const other = env.authenticatedContext('other').firestore();
    await assertFails(setDoc(doc(other, 'users/other/library/meta'), library.meta)); // nobody creates a library from the app
  });
});

describe('library loader (real Firestore SDK)', () => {
  const watch = (uid: string) => new Promise<LibraryState>((resolve) => {
    const db = env.authenticatedContext(uid).firestore();
    const service = createLibraryService({ remote: createFirestoreLibraryRemote(Promise.resolve(db as never)), cache: memoryLibraryCache(), offlineTimeoutMs: 20_000 });
    const stop = service.watch(uid, (s) => { if (s.status !== 'loading') { stop(); resolve(s); } });
  });

  it('the owner gets all 999 verified entries; another account gets an empty library', async () => {
    await seed('owner');
    const owner = await watch('owner');
    expect(owner).toMatchObject({ status: 'ready', empty: false, source: 'server' });
    if (owner.status === 'ready') {
      expect(owner.repository.totalEntries).toBe(999);
      expect(owner.repository.categories).toHaveLength(7);
      expect(owner.repository.getEntry('dv_522b07848b')).toBeDefined();
    }
    expect(await watch('other')).toMatchObject({ status: 'ready', empty: true });
  });

  it('an altered chunk is refused (checksum), nothing is shown', async () => {
    await seed('owner');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/owner/library/category-arch'), { json: library.chunks['category-arch']!.replace('Außenwand', 'Aussenwand') });
    });
    expect(await watch('owner')).toMatchObject({ status: 'error', reason: 'invalid' });
  });
});
