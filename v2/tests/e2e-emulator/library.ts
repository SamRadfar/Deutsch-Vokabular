// Library seeding for the emulator browser tests: the same documents the owner import script
// creates (format, checksums), written with emulator admin rights ("Bearer owner").

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitLibrary, LIBRARY_META_ID } from '../../src/features/library/format';

const PROJECT = 'demo-deutsch-vokabular';
const host = process.env.E2E_EMULATOR_HOST ?? '127.0.0.1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8')) as never;
let library: ReturnType<typeof splitLibrary> | null = null;
const content = () => (library ??= splitLibrary({
  vocabulary: read('src/data/vocabulary/vocabulary.v1.json'),
  technicalInfo: read('src/data/vocabulary/technical-info.v1.json'),
  idRegistry: read('src/data/vocabulary/id-registry.v1.json'),
  dvok5Maps: read('src/data/legacy/dvok5-index-maps.v1.json'),
}));

const enc = (v: unknown): unknown => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, enc(x)])) } };
};

/** uid of an Auth Emulator account. */
export async function uidOf(email: string): Promise<string> {
  const res = await fetch(`http://${host}:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, {
    method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ email: [email] }),
  });
  const user = ((await res.json()) as { users?: Array<{ localId: string }> }).users?.[0];
  if (!user) throw new Error(`no emulator account ${email}`);
  return user.localId;
}

/** Gives the account the built-in library (as the owner import does). */
export async function seedLibrary(uid: string): Promise<void> {
  const { meta, chunks } = await content();
  const name = (id: string) => `projects/${PROJECT}/databases/(default)/documents/users/${uid}/library/${id}`;
  const writes = [
    ...Object.entries(chunks).map(([id, json]) => ({ update: { name: name(id), fields: { json: enc(json) } } })),
    { update: { name: name(LIBRARY_META_ID), fields: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, enc(v)])) } },
  ];
  const res = await fetch(`http://${host}:8080/v1/projects/${PROJECT}/databases/(default)/documents:commit`, {
    method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ writes }),
  });
  if (!res.ok) throw new Error(`seeding failed: HTTP ${res.status}`);
}
