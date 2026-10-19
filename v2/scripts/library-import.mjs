#!/usr/bin/env node
// Owner library import: the built-in vocabulary (src/data/…) → users/{uid}/library/* of ONE verified
// account. The app has no copy of the vocabulary; only this account will see it (firestore.rules).
//
//   DRY RUN (default, read-only): verifies the account and shows the plan
//     node scripts/library-import.mjs --project deutsch-vokabular --email you@example.com
//   IMPORT (owner approval): uid AND email must match the same Google account; --confirm repeats the uid
//     node scripts/library-import.mjs --project deutsch-vokabular --email you@example.com --uid <uid> --confirm <uid>
//   EMULATOR (tests): --emulator --project demo-… [--host 127.0.0.1]
//
// Safety: production project allowlist (legacy/dev refused); the account must exist, use Google
// sign-in and not be disabled; non-destructive — refused if a library already exists, every write is
// create-only (precondition exists=false), all documents in ONE atomic commit (meta last); nothing is
// ever deleted or updated; the written documents are read back and verified (checksums, 999 entries).
// Credentials: the owner's `npx firebase login` (production) — tokens are never printed.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assembleLibrary, LIBRARY_META_ID, splitLibrary } from '../src/features/library/format.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION = ['deutsch-vokabular'];
const FORBIDDEN = ['deutsch-wortschatz-c7a11', 'deutsch-vokabular-v2-dev'];
class Abort extends Error {}
/** Stops the script with a message; it ends normally (no process.exit while requests are open). */
const fail = (msg) => { throw new Abort(msg); };
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const emulator = process.argv.includes('--emulator');
const project = arg('--project');
const email = arg('--email')?.toLowerCase();
const uid = arg('--uid');
const confirm = arg('--confirm');
const host = arg('--host') ?? '127.0.0.1';
const mask = (e) => (e ? e.replace(/^(.)(.*?)(@.*)$/, (_, a, b, c) => `${a}${'*'.repeat(Math.max(2, b.length))}${c}`) : '(none)');

async function main() {
  if (!project) fail('missing --project');
  if (FORBIDDEN.includes(project)) fail(`"${project}" is not the production project — refusing`);
  if (emulator ? !project.startsWith('demo-') : !PRODUCTION.includes(project)) fail(emulator ? 'emulator mode needs a demo- project' : `"${project}" is not the approved production project (${PRODUCTION.join(', ')})`);
  if (!emulator && !email) fail('missing --email (the Google account that owns the vocabulary)');
  if (confirm !== undefined && (!uid || confirm !== uid)) fail('--confirm must repeat the --uid value');

  // ── HTTP clients ────────────────────────────────────────────────────────────────────────────────
  let request;
  if (emulator) {
    const base = { firestore: `http://${host}:8080`, auth: `http://${host}:9099/identitytoolkit.googleapis.com` };
    request = async (service, method, path, body) => {
      const res = await fetch(`${base[service]}${path}`, { method, headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, body: json };
    };
  } else {
    const require = createRequire(import.meta.url);
    const FT = resolve(root, 'node_modules/firebase-tools/lib');
    const { requireAuth } = require(resolve(FT, 'requireAuth'));
    const { Client } = require(resolve(FT, 'apiv2'));
    const { configstore } = require(resolve(FT, 'configstore'));
    await requireAuth({ project, user: configstore.get('user'), tokens: configstore.get('tokens') });
    const clients = {
      firestore: new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' }),
      auth: new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', apiVersion: 'v1' }),
    };
    request = async (service, method, path, body) => {
      try {
        // The clients carry the API version: '/v1/projects/…' → '/projects/…'.
        const res = await clients[service].request({ method, path: path.replace(/^\/v1/, ''), ...(body ? { body } : {}), resolveOnHTTPError: true });
        return { status: res.status, body: res.body ?? {} };
      } catch (e) { return { status: e.status ?? 500, body: { error: { message: String(e.message).slice(0, 200) } } }; }
    };
  }

  // ── Firestore REST value encoding ───────────────────────────────────────────────────────────────
  const enc = (v) => {
    if (v === null) return { nullValue: null };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
  };
  const dec = (v) => {
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(dec);
    return Object.fromEntries(Object.entries(v.mapValue?.fields ?? {}).map(([k, x]) => [k, dec(x)]));
  };
  const docsRoot = `/v1/projects/${project}/databases/(default)/documents`;
  const libPath = (u, id) => `${docsRoot}/users/${u}/library/${id}`;
  const getDoc = async (u, id) => {
    const r = await request('firestore', 'GET', libPath(u, id));
    if (r.status === 404) return null;
    if (r.status !== 200) fail(`Firestore read failed (HTTP ${r.status}): ${r.body?.error?.message ?? ''}`);
    return Object.fromEntries(Object.entries(r.body.fields ?? {}).map(([k, x]) => [k, dec(x)]));
  };

  // ── 1. Content (the original files) ────────────────────────────────────────────────────────────
  const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
  const library = await splitLibrary({
    vocabulary: read('src/data/vocabulary/vocabulary.v1.json'),
    technicalInfo: read('src/data/vocabulary/technical-info.v1.json'),
    idRegistry: read('src/data/vocabulary/id-registry.v1.json'),
    dvok5Maps: read('src/data/legacy/dvok5-index-maps.v1.json'),
  });
  await assembleLibrary(library.meta, library.chunks); // self-check of the split
  console.log(`• Content: ${library.meta.entryCount} entries in ${library.meta.categories.length} categories, ${Object.keys(library.chunks).length} chunks, content ${library.meta.contentHash.slice(0, 16)}…`);

  // ── 2. Account verification ────────────────────────────────────────────────────────────────────
  const lookup = async (query) => {
    const r = await request('auth', 'POST', `/v1/projects/${project}/accounts:lookup`, query);
    if (r.status !== 200) fail(`Auth lookup failed (HTTP ${r.status}): ${r.body?.error?.message ?? ''}`);
    return r.body.users ?? [];
  };
  let account = null;
  if (email) {
    const users = (await lookup({ email: [email] })).filter((u) => u.email?.toLowerCase() === email);
    if (!users.length) fail(`no account with ${mask(email)} in ${project} — sign in once on the website with that Google account, then run this again`);
    if (users.length > 1) fail('several accounts with this e-mail — refusing to guess');
    account = users[0];
  }
  if (uid) {
    const [byUid] = await lookup({ localId: [uid] });
    if (!byUid) fail('the given --uid does not exist in this project');
    if (account && account.localId !== uid) fail('--uid and --email belong to DIFFERENT accounts — refusing');
    account = byUid;
  }
  if (!account) fail('no account selected (--email and/or --uid)');
  const providers = (account.providerUserInfo ?? []).map((p) => p.providerId);
  console.log(`• Account: uid ${account.localId}, e-mail ${mask(account.email)}, providers ${providers.join(', ') || '(none)'}, created ${account.createdAt ? new Date(Number(account.createdAt)).toISOString().slice(0, 10) : '?'}, last sign-in ${account.lastLoginAt ? new Date(Number(account.lastLoginAt)).toISOString().slice(0, 16).replace('T', ' ') : '?'}`);
  if (!emulator && !providers.includes('google.com')) fail('the account does not use Google sign-in — refusing');
  if (account.disabled) fail('the account is disabled — refusing');

  // ── 3. Non-destructive check ───────────────────────────────────────────────────────────────────
  const existing = await getDoc(account.localId, LIBRARY_META_ID);
  if (existing) {
    const same = existing.contentHash === library.meta.contentHash;
    fail(`this account already has a library (${same ? 'identical content' : `content ${String(existing.contentHash).slice(0, 16)}…`}) — nothing written; the import never overwrites`);
  }
  for (const id of Object.keys(library.chunks)) if (await getDoc(account.localId, id)) fail(`library/${id} already exists — nothing written`);
  console.log(`• Target: users/${account.localId}/library/* is empty (${Object.keys(library.chunks).length + 1} documents would be created).`);

  if (!confirm) {
    console.log(`\n✔ Dry run — nothing was written. To import (after the owner's approval):\n  node scripts/library-import.mjs ${emulator ? '--emulator ' : ''}--project ${project}${email ? ' --email <same e-mail>' : ''} --uid ${account.localId} --confirm ${account.localId}`);
    return;
  }

  // ── 4. Import: one atomic, create-only commit (meta last) ──────────────────────────────────────
  const name = (id) => `projects/${project}/databases/(default)/documents/users/${account.localId}/library/${id}`;
  const writes = [
    ...Object.entries(library.chunks).map(([id, json]) => ({ update: { name: name(id), fields: { json: enc(json) } }, currentDocument: { exists: false } })),
    { update: { name: name(LIBRARY_META_ID), fields: Object.fromEntries(Object.entries({ ...library.meta, importedAt: new Date().toISOString() }).map(([k, v]) => [k, enc(v)])) }, currentDocument: { exists: false } },
  ];
  const commit = await request('firestore', 'POST', `/v1/projects/${project}/databases/(default)/documents:commit`, { writes });
  if (commit.status !== 200) fail(`import failed, nothing was written (atomic commit, HTTP ${commit.status}): ${commit.body?.error?.message ?? ''}`);
  console.log(`• Written: ${writes.length} documents in one commit.`);

  // ── 5. Verification (read back) ────────────────────────────────────────────────────────────────
  const meta = await getDoc(account.localId, LIBRARY_META_ID);
  const chunks = {};
  for (const id of Object.keys(library.chunks)) chunks[id] = (await getDoc(account.localId, id))?.json;
  const { vocabulary } = await assembleLibrary(meta, chunks);
  const count = vocabulary.categories.reduce((n, c) => n + c.subtabs.reduce((m, s) => m + s.groups.reduce((k, g) => k + g.entries.length, 0), 0), 0);
  if (meta.contentHash !== library.meta.contentHash || count !== library.meta.entryCount) fail('verification FAILED — please report; the documents were written but do not match');
  console.log(`✔ Verified: ${count} entries, every chunk matches its checksum, content ${meta.contentHash.slice(0, 16)}….`);
}

try {
  await main();
} catch (e) {
  console.error(`✖ ${e instanceof Abort ? e.message : e?.stack ?? e}`);
  process.exitCode = 1;
}
