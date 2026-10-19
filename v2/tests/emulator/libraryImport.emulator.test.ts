// The owner import script against the emulators: account verification, dry run (no writes),
// refusal of a mismatched uid/email, atomic create-only import, verification, no second import.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT = 'demo-deutsch-vokabular';
const host = (process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099').split(':')[0]!;
const AUTH = `http://${host}:9099/identitytoolkit.googleapis.com/v1`;
const FS = `http://${host}:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const owner = { authorization: 'Bearer owner' };

async function createUser(email: string): Promise<string> {
  const res = await fetch(`${AUTH}/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'pw-123456', returnSecureToken: true }),
  });
  return ((await res.json()) as { localId: string }).localId;
}
const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, [resolve(__dirname, '../../scripts/library-import.mjs'), '--emulator', '--project', PROJECT, '--host', host, ...args], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const libraryDocs = async (uid: string) => {
  const res = await fetch(`${FS}/users/${uid}/library?pageSize=50`, { headers: owner });
  return (((await res.json()) as { documents?: Array<{ name: string }> }).documents ?? []).map((d) => d.name.split('/').pop());
};

describe('library import script (emulator)', () => {
  it('dry run → verified import → refuses to import again; mismatched accounts are refused', async () => {
    const stamp = Date.now();
    const ownerEmail = `owner-${stamp}@example.test`;
    const ownerUid = await createUser(ownerEmail);
    const otherUid = await createUser(`other-${stamp}@example.test`);

    const dry = run('--email', ownerEmail);
    expect(dry.status, dry.out).toBe(0);
    expect(dry.out).toContain('999 entries in 7 categories');
    expect(dry.out).toContain(`uid ${ownerUid}`);
    expect(dry.out).toContain('Dry run — nothing was written');
    expect(dry.out).not.toContain(ownerEmail); // e-mail is masked
    expect(await libraryDocs(ownerUid)).toEqual([]);

    const mismatch = run('--email', ownerEmail, '--uid', otherUid, '--confirm', otherUid);
    expect(mismatch.status).toBe(1);
    expect(mismatch.out).toContain('DIFFERENT accounts');
    expect(run('--email', ownerEmail, '--uid', ownerUid, '--confirm', 'wrong').out).toContain('--confirm must repeat');
    expect(await libraryDocs(otherUid)).toEqual([]);

    const imported = run('--email', ownerEmail, '--uid', ownerUid, '--confirm', ownerUid);
    expect(imported.status, imported.out).toBe(0);
    expect(imported.out).toContain('Verified: 999 entries');
    expect((await libraryDocs(ownerUid)).sort()).toEqual([
      'category-acad', 'category-anatomie', 'category-arch', 'category-bauphysik', 'category-bautechnik', 'category-dreame', 'category-fitness',
      'dvok5-maps', 'id-registry', 'meta', 'technical-info',
    ]);

    const again = run('--email', ownerEmail, '--uid', ownerUid, '--confirm', ownerUid);
    expect(again.status).toBe(1);
    expect(again.out).toContain('already has a library (identical content)');
    expect(await libraryDocs(otherUid)).toEqual([]); // nobody else got anything
  }, 60_000);

  it('refuses the legacy and the development project outright', () => {
    expect(spawnSync(process.execPath, [resolve(__dirname, '../../scripts/library-import.mjs'), '--project', 'deutsch-wortschatz-c7a11', '--email', 'x@y.z'], { encoding: 'utf8' }).stderr).toContain('not the production project');
    expect(spawnSync(process.execPath, [resolve(__dirname, '../../scripts/library-import.mjs'), '--project', 'deutsch-vokabular-v2-dev', '--email', 'x@y.z'], { encoding: 'utf8' }).stderr).toContain('not the production project');
  });
});
