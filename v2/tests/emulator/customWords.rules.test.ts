// PROPOSED rules for personal vocabulary (v2/firestore.proposed.rules), Firebase Emulator only.
// These rules are NOT deployed. Together with `npm run test:emulator:proposed` (all existing rules
// tests against the proposed file) this shows the proposal adds customWords without weakening
// anything that is deployed today.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const PROJECT = 'demo-deutsch-vokabular';
const ID = 'pw_0123456789abcdef0123';
let env: RulesTestEnvironment;

const word = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1, id: ID, article: 'die', lemma: 'Nachhaltigkeit', type: 'n', grammar: 'Plural: —', fa: 'پایداری',
  example: 'Nachhaltigkeit ist wichtig.', exampleFa: 'پایداری مهم است.', pronunciationFa: 'ناخ‌هالتیش‌کایت',
  placement: { category: 'arch', subtab: 'bau' }, learned: false, deleted: false, source: 'manual', legacyId: null,
  createdAt: 1760000000000, clientUpdatedAt: 1760000000000, updatedAt: serverTimestamp(), opId: 'op-1', deviceId: 'device-1',
  ...overrides,
});

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.proposed.rules'), 'utf8'), host: host!, port: Number(port) },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();
const path = (uid = 'alice', id = ID) => `users/${uid}/customWords/${id}`;

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path()), { ...word(), updatedAt: Timestamp.now() });
  });
}

describe('customWords (proposed): isolation', () => {
  it('the owner can create, read and list their own words', async () => {
    await assertSucceeds(setDoc(doc(alice(), path()), word()));
    await assertSucceeds(getDoc(doc(alice(), path())));
    await assertSucceeds(getDocs(collection(alice(), 'users/alice/customWords')));
  });

  it('other users and anonymous visitors can neither read nor write', async () => {
    await seed();
    await assertFails(getDoc(doc(bob(), path())));
    await assertFails(getDocs(collection(bob(), 'users/alice/customWords')));
    await assertFails(getDoc(doc(anon(), path())));
    await assertFails(setDoc(doc(bob(), path()), word()));
    await assertFails(setDoc(doc(anon(), path()), word()));
  });

  it('nobody can delete a document (deletion is a tombstone)', async () => {
    await seed();
    await assertFails(deleteDoc(doc(alice(), path())));
    await assertSucceeds(setDoc(doc(alice(), path()), word({ deleted: true, clientUpdatedAt: 1760000000500 })));
  });
});

describe('customWords (proposed): schema', () => {
  it('id must be pw_ + 20 hex and equal the document id; built-in ids are rejected', async () => {
    await assertFails(setDoc(doc(alice(), path('alice', 'dv_522b07848b')), word({ id: 'dv_522b07848b' })));
    await assertFails(setDoc(doc(alice(), path('alice', 'pw_xyz')), word({ id: 'pw_xyz' })));
    await assertFails(setDoc(doc(alice(), path()), word({ id: 'pw_ffffffffffffffffffff' })));
  });

  it('exact field set: unknown or missing fields are rejected (e.g. an email)', async () => {
    await assertFails(setDoc(doc(alice(), path()), { ...word(), email: 'a@b.c' }));
    const { fa: _fa, ...missing } = word();
    await assertFails(setDoc(doc(alice(), path()), missing));
  });

  it('types, enums and sizes are validated', async () => {
    const bad: Array<Record<string, unknown>> = [
      { lemma: '' }, { lemma: 'x'.repeat(121) }, { article: 'den' }, { type: 'noun' }, { fa: 'ف'.repeat(201) },
      { example: 'e'.repeat(401) }, { learned: 'yes' }, { deleted: 0 }, { source: 'ai' }, { legacyId: 'x'.repeat(41) },
      { placement: { category: 'arch' } }, { placement: { category: 'arch', subtab: 'bau', extra: 1 } },
      { createdAt: -1 }, { clientUpdatedAt: 1e13 }, { opId: '' }, { schemaVersion: 2 },
    ];
    for (const b of bad) await assertFails(setDoc(doc(alice(), path()), word(b)));
    await assertSucceeds(setDoc(doc(alice(), path()), word({ article: null, type: 'au', placement: null, fa: '', legacyId: 'cw1712345678901', source: 'legacy-import' })));
  });

  it('updatedAt must be the server time', async () => {
    await assertFails(setDoc(doc(alice(), path()), word({ updatedAt: Timestamp.fromMillis(1) })));
  });

  it('createdAt, source and legacyId cannot be changed by an update', async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(alice(), path()), { fa: 'پایداری (محیط زیست)', updatedAt: serverTimestamp(), clientUpdatedAt: 1760000001000 }));
    await assertFails(updateDoc(doc(alice(), path()), { createdAt: 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(alice(), path()), { source: 'legacy-import', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(alice(), path()), { legacyId: 'cw1', updatedAt: serverTimestamp() }));
  });
});

describe('proposed rules keep the deployed guarantees for other paths', () => {
  it('legacy syncCodes and other users stay closed; progress still requires dv_ ids', async () => {
    await assertFails(getDoc(doc(alice(), 'syncCodes/123456')));
    await assertFails(getDocs(collection(alice(), 'users')));
    await assertFails(setDoc(doc(alice(), `users/alice/progress/${ID}`), {
      schemaVersion: 1, wordId: ID, learned: true, updatedAt: serverTimestamp(), clientUpdatedAt: 1, opId: 'o', deviceId: 'd', origin: 'toggle',
    }));
  });
});
