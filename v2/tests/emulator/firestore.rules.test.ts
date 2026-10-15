// Firestore Security Rules tests (Firebase Emulator). Verifies per-user isolation, schema
// validation and write restrictions of v2/firestore.rules.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const PROJECT = 'demo-deutsch-vokabular';
let env: RulesTestEnvironment;

const WORD = 'dv_522b07848b';
const progress = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1, wordId: WORD, learned: true, updatedAt: serverTimestamp(), clientUpdatedAt: 1760000000000,
  opId: 'op-1', deviceId: 'device-1', origin: 'toggle', ...overrides,
});
const HASH = 'a'.repeat(64);
const migration = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1, inputHash: HASH, source: 'backup-file', legacyContentCommit: '6763003', contentVersion: '1.0.0',
  counts: { matchedEntries: 3, imported: 2, alreadyLearned: 1, conflictsSkipped: 0, ambiguousKeys: 0, orphanedKeys: 0 },
  status: 'completed', completedAt: serverTimestamp(), ...overrides,
});

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    // RULES_FILE allows a mutation check against an alternative (e.g. permissive) rules file.
    firestore: { rules: readFileSync(process.env.RULES_FILE ?? resolve(__dirname, '../../firestore.rules'), 'utf8'), host: host!, port: Number(port) },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();

async function seedAliceProgress() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/alice/progress/${WORD}`), { ...progress(), updatedAt: Timestamp.now() });
  });
}

describe('progress: isolation', () => {
  it('a user can write and read their own progress', async () => {
    await assertSucceeds(setDoc(doc(alice(), `users/alice/progress/${WORD}`), progress()));
    await assertSucceeds(getDoc(doc(alice(), `users/alice/progress/${WORD}`)));
    await assertSucceeds(getDocs(collection(alice(), 'users/alice/progress')));
  });

  it('another user cannot read, list or modify it', async () => {
    await seedAliceProgress();
    await assertFails(getDoc(doc(bob(), `users/alice/progress/${WORD}`)));
    await assertFails(getDocs(collection(bob(), 'users/alice/progress')));
    await assertFails(setDoc(doc(bob(), `users/alice/progress/${WORD}`), progress({ learned: false })));
    await assertFails(updateDoc(doc(bob(), `users/alice/progress/${WORD}`), { learned: false, updatedAt: serverTimestamp() }));
  });

  it('unauthenticated requests cannot read or write private data', async () => {
    await seedAliceProgress();
    await assertFails(getDoc(doc(anon(), `users/alice/progress/${WORD}`)));
    await assertFails(getDocs(collection(anon(), 'users/alice/progress')));
    await assertFails(setDoc(doc(anon(), `users/alice/progress/${WORD}`), progress()));
    await assertFails(getDoc(doc(anon(), 'users/alice')));
  });

  it('nobody can delete progress (unlearning is a learned=false write)', async () => {
    await seedAliceProgress();
    await assertFails(deleteDoc(doc(alice(), `users/alice/progress/${WORD}`)));
    await assertSucceeds(setDoc(doc(alice(), `users/alice/progress/${WORD}`), progress({ learned: false, opId: 'op-2' })));
  });

  it('collection-group style listing of all users is not possible', async () => {
    await assertFails(getDocs(collection(alice(), 'users')));
  });
});

describe('progress: schema validation', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['learned not boolean', { learned: 'yes' }],
    ['client-chosen updatedAt', { updatedAt: Timestamp.fromMillis(Date.now() + 86_400_000) }],
    ['wordId mismatching the path', { wordId: 'dv_ffffffffff' }],
    ['unknown extra field', { email: 'alice@example.test' }],
    ['wrong schemaVersion', { schemaVersion: 2 }],
    ['invalid origin', { origin: 'admin' }],
    ['oversized opId', { opId: 'x'.repeat(65) }],
    ['empty deviceId', { deviceId: '' }],
    ['non-integer clientUpdatedAt', { clientUpdatedAt: 'now' }],
    ['negative clientUpdatedAt', { clientUpdatedAt: -1 }],
    ['absurd future clientUpdatedAt', { clientUpdatedAt: 10000000000000 }],
  ];
  for (const [name, overrides] of cases) {
    it(`rejects ${name}`, async () => {
      await assertFails(setDoc(doc(alice(), `users/alice/progress/${WORD}`), progress(overrides)));
    });
  }
  it('rejects missing fields', async () => {
    const { deviceId: _omit, ...rest } = progress();
    await assertFails(setDoc(doc(alice(), `users/alice/progress/${WORD}`), rest));
  });
  it('rejects document ids that are not word ids', async () => {
    await assertFails(setDoc(doc(alice(), 'users/alice/progress/arch::die Außenwand'), progress({ wordId: 'arch::die Außenwand' })));
    await assertFails(setDoc(doc(alice(), 'users/alice/progress/dv_XYZ'), progress({ wordId: 'dv_XYZ' })));
  });
});

describe('user profile document', () => {
  it('owner can create and update a minimal profile; others cannot read it', async () => {
    const profile = { schemaVersion: 1, profile: { displayName: 'Alice', photoURL: null }, updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(alice(), 'users/alice'), profile));
    await assertSucceeds(setDoc(doc(alice(), 'users/alice'), { ...profile, preferences: { theme: 'dark' } }, { merge: true }));
    await assertSucceeds(getDoc(doc(alice(), 'users/alice')));
    await assertFails(getDoc(doc(bob(), 'users/alice')));
    await assertFails(setDoc(doc(bob(), 'users/alice'), profile));
    await assertFails(deleteDoc(doc(alice(), 'users/alice')));
  });
  it('rejects storing extra personal data such as the email address', async () => {
    await assertFails(setDoc(doc(alice(), 'users/alice'), { schemaVersion: 1, profile: { displayName: 'A', photoURL: null, email: 'a@x' }, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(alice(), 'users/alice'), { schemaVersion: 1, email: 'a@x', updatedAt: serverTimestamp() }));
  });
});

describe('migration records', () => {
  it('owner can create once; records cannot be updated, deleted or read by others', async () => {
    await assertSucceeds(setDoc(doc(alice(), `users/alice/migrations/${HASH}`), migration()));
    await assertFails(setDoc(doc(alice(), `users/alice/migrations/${HASH}`), migration({ counts: { matchedEntries: 0, imported: 0, alreadyLearned: 0, conflictsSkipped: 0, ambiguousKeys: 0, orphanedKeys: 0 } })));
    await assertFails(deleteDoc(doc(alice(), `users/alice/migrations/${HASH}`)));
    await assertSucceeds(getDoc(doc(alice(), `users/alice/migrations/${HASH}`)));
    await assertFails(getDoc(doc(bob(), `users/alice/migrations/${HASH}`)));
    await assertFails(setDoc(doc(bob(), `users/alice/migrations/${'b'.repeat(64)}`), migration({ inputHash: 'b'.repeat(64) })));
  });
  it('rejects malformed records', async () => {
    await assertFails(setDoc(doc(alice(), `users/alice/migrations/${HASH}`), migration({ inputHash: 'c'.repeat(64) })));
    await assertFails(setDoc(doc(alice(), 'users/alice/migrations/not-a-hash'), migration({ inputHash: 'not-a-hash' })));
    await assertFails(setDoc(doc(alice(), `users/alice/migrations/${HASH}`), migration({ apiKey: 'sk-ant-x' })));
    await assertFails(setDoc(doc(alice(), `users/alice/migrations/${HASH}`), migration({ counts: { imported: -1 } })));
  });
});

describe('legacy collection', () => {
  it('this rules file alone denies syncCodes — it must be merged, not deployed as-is', async () => {
    await assertFails(getDoc(doc(alice(), 'syncCodes/123456')));
    await assertFails(getDoc(doc(anon(), 'syncCodes/123456')));
  });
});
