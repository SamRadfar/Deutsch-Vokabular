// Security rules for the account's categories (users/{uid}/categories) — Firebase Emulator only.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';

const PROJECT = 'demo-deutsch-vokabular';
const ID = 'uc_0123456789abcdef0123';
const SUB = 'uc_0123456789abcdef0124';
let env: RulesTestEnvironment;

const cat = (o: Record<string, unknown> = {}) => ({
  schemaVersion: 1, id: ID, name: 'Reisen', parentId: null, sort: 0, deleted: false,
  createdAt: 1760000000000, clientUpdatedAt: 1760000000000, updatedAt: serverTimestamp(), opId: 'op-1', deviceId: 'device-1', ...o,
});

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'), host: host!, port: Number(port) } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();
const path = (uid = 'alice', id = ID) => `users/${uid}/categories/${id}`;

describe('categories rules', () => {
  it('the owner creates main categories and subcategories (below own or built-in categories)', async () => {
    await assertSucceeds(setDoc(doc(alice(), path()), cat()));
    await assertSucceeds(setDoc(doc(alice(), path('alice', SUB)), cat({ id: SUB, name: 'Flughafen', parentId: ID })));
    await assertSucceeds(setDoc(doc(alice(), path('alice', 'uc_0123456789abcdef0125')), cat({ id: 'uc_0123456789abcdef0125', name: 'Eigene Übungen', parentId: 'fitness' })));
    await assertSucceeds(getDocs(collection(alice(), 'users/alice/categories')));
  });

  it('other accounts and anonymous users can neither read nor write', async () => {
    await assertSucceeds(setDoc(doc(alice(), path()), cat()));
    await assertFails(getDoc(doc(bob(), path())));
    await assertFails(getDoc(doc(anon(), path())));
    await assertFails(setDoc(doc(bob(), path()), cat()));
    await assertFails(setDoc(doc(bob(), path('alice', SUB)), cat({ id: SUB })));
  });

  it('schema: id, names, parent, fields, server time', async () => {
    const bad: Array<Record<string, unknown>> = [
      { name: '' }, { name: 'x'.repeat(61) }, { parentId: 'Arch Itecture' }, { parentId: ID }, { parentId: 7 },
      { sort: -1 }, { deleted: 'no' }, { schemaVersion: 2 }, { id: SUB }, { extra: 1 }, { updatedAt: Timestamp.fromMillis(1) }, { opId: '' },
    ];
    for (const b of bad) await assertFails(setDoc(doc(alice(), path()), cat(b)));
    await assertFails(setDoc(doc(alice(), path('alice', 'not-an-id')), cat({ id: 'not-an-id' })));
  });

  it('rename keeps createdAt; deletion is a final tombstone, never a removal', async () => {
    await assertSucceeds(setDoc(doc(alice(), path()), cat()));
    await assertSucceeds(setDoc(doc(alice(), path()), cat({ name: 'Reisen & Urlaub', opId: 'op-2' })));
    await assertFails(setDoc(doc(alice(), path()), cat({ createdAt: 1 })));
    await assertFails(deleteDoc(doc(alice(), path())));
    await assertSucceeds(setDoc(doc(alice(), path()), cat({ deleted: true, opId: 'op-3' })));
    await assertFails(setDoc(doc(alice(), path()), cat({ deleted: false, opId: 'op-4' })));
  });

  it('the protected library stays read-only', async () => {
    await assertFails(setDoc(doc(alice(), 'users/alice/library/meta'), { x: 1 }));
  });
});
