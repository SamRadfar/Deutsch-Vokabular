import { afterEach, describe, expect, it } from 'vitest';
import { backupToSnapshot, createBackup, hashSnapshot, parseBackup } from '../../../src/features/progress/migration/backup';
import { analyzeImport, engineLookup, runImport } from '../../../src/features/progress/migration/importer';
import { planMigration } from '../../../src/features/progress/migration/plan';
import { ProgressSyncEngine } from '../../../src/features/progress/syncEngine';
import { createMemoryStore } from '../../../src/features/progress/localStore';
import { buildLegacyKeyIndex } from '../../../src/services/content/idRegistry';
import { createFakeCloud, until } from '../../helpers/fakeCloud';
import { createFakeAccountRemote } from '../../helpers/fakeServices';
import { FAKE_API_KEY, dvok5, dvok6, snapshot } from './legacy-snapshots';
import { bundledIdRegistry as idRegistry, bundledMigrationContext } from '../../../src/services/content/bundled';

const migrationCtx = bundledMigrationContext();

const keyIndex = buildLegacyKeyIndex(idRegistry);
const idOf = (k: string) => keyIndex.get(k)![0]!;
const engines: ProgressSyncEngine[] = [];
afterEach(() => { for (const e of engines.splice(0)) e.stop(); });

async function setup() {
  const cloud = createFakeCloud();
  const account = createFakeAccountRemote();
  const engine = new ProgressSyncEngine({ uid: 'alice', local: createMemoryStore(), remote: cloud.device('d'), deviceId: 'd', knownIds: new Set([...keyIndex.values()].flat()), retryBaseMs: 5, firstSnapshotTimeoutMs: 20 });
  engines.push(engine);
  await engine.start();
  return { cloud, account, engine };
}
const ctx = async (env: Awaited<ReturnType<typeof setup>>, s = snapshot({ dvok6: dvok6('arch::die Außenwand', 'acad::rendern', 'bautechnik::der Wärmeschutz') })) => ({
  uid: 'alice', engine: env.engine, account: env.account, source: 'backup-file' as const, contentVersion: '1.0.0',
  plan: planMigration(s, migrationCtx), inputHash: await hashSnapshot(s), settleTimeoutMs: 3000,
});

describe('backup format', () => {
  it('never contains the API key or the sync code', () => {
    const s = snapshot({ dvok6: dvok6('arch::die Außenwand'), dvok_sync_code: '123456', dvok5_apikey_present: true });
    const json = JSON.stringify(createBackup(s, 'same-origin'));
    expect(json).not.toContain('123456');
    expect(json).not.toContain('apikey');
    expect(json).not.toContain('sync_code');
  });

  it('round-trips and strips forbidden keys from foreign files with a warning', () => {
    const backup = createBackup(snapshot({ dvok6: dvok6('arch::die Außenwand') }), 'console-export');
    const withSecrets = JSON.stringify({ ...backup, keys: { ...backup.keys, dvok5_apikey: FAKE_API_KEY, dvok_sync_code: '654321' } });
    const parsed = parseBackup(withSecrets);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toHaveLength(1);
    expect(JSON.stringify(parsed.backup)).not.toContain(FAKE_API_KEY);
    expect(backupToSnapshot(parsed.backup)).toMatchObject({ dvok6: backup.keys.dvok6, dvok_sync_code: null, dvok5_apikey_present: false });
  });

  it.each([
    ['{not json', 'JSON'],
    ['[]', 'ساختار'],
    [JSON.stringify({ format: 'other', version: 1, keys: {} }), 'پشتیبان Deutsch Vokabular نیست'],
    [JSON.stringify({ format: 'deutsch-vokabular/legacy-backup', version: 9, keys: {} }), 'نسخه'],
    [JSON.stringify({ format: 'deutsch-vokabular/legacy-backup', version: 1, keys: { dvok6: 42 } }), 'dvok6'],
  ])('rejects invalid input %#', (text, fragment) => {
    const r = parseBackup(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(fragment);
  });

  it('hash is stable and changes with the content', async () => {
    const a = snapshot({ dvok6: dvok6('arch::die Außenwand') });
    expect(await hashSnapshot(a)).toBe(await hashSnapshot({ ...a, dvok_sync_code: '999999' })); // secrets not part of the input
    expect(await hashSnapshot(a)).not.toBe(await hashSnapshot(snapshot({ dvok6: dvok6('arch::die Innenwand') })));
    expect(await hashSnapshot(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('import analysis and execution', () => {
  it('imports matched entries (both entries of a duplicate key), skips orphans, verifies and records', async () => {
    const env = await setup();
    const c = await ctx(env);
    const [r1, r2] = keyIndex.get('acad::rendern')!;
    expect(analyzeImport(c.plan, engineLookup(env.engine)).toImport.sort()).toEqual([idOf('arch::die Außenwand'), r1, r2].sort());
    const outcome = await runImport(c);
    expect(outcome).toMatchObject({ status: 'completed', imported: 3, verified: 3 });
    expect(env.account.records.get(`alice/${c.inputHash}`)?.counts).toEqual({
      matchedEntries: 3, imported: 3, alreadyLearned: 0, conflictsSkipped: 0, ambiguousKeys: 1, orphanedKeys: 1,
    });
    expect(env.cloud.writeLog.every((w) => w.write.origin === 'migration')).toBe(true);
    expect(env.cloud.serverState('alice').get(idOf('arch::die Außenwand'))).toBe(true);
  });

  it('a dataset is imported only once per account', async () => {
    const env = await setup();
    const c = await ctx(env);
    await runImport(c);
    const writes = env.cloud.writeLog.length;
    expect(await runImport(c)).toEqual({ status: 'already-imported' });
    expect(env.cloud.writeLog.length).toBe(writes);
  });

  it('never overwrites existing account values: explicit "not learned" is a reported conflict', async () => {
    const env = await setup();
    const wand = idOf('arch::die Außenwand');
    await env.engine.setLearned(wand, true);
    await env.engine.setLearned(wand, false); // account says: not learned
    const [r1] = keyIndex.get('acad::rendern')!;
    await env.engine.setLearned(r1!, true); // already learned
    await until(() => env.engine.getView().status.pendingCount === 0);
    const c = await ctx(env);
    const a = analyzeImport(c.plan, engineLookup(env.engine));
    expect(a.conflicts).toEqual([wand]);
    expect(a.alreadyLearned).toEqual([r1]);
    const outcome = await runImport(c);
    expect(outcome).toMatchObject({ status: 'completed', imported: 1 });
    expect(env.cloud.serverState('alice').get(wand)).toBe(false); // untouched
    expect(env.account.records.get(`alice/${c.inputHash}`)?.counts).toMatchObject({ conflictsSkipped: 1, alreadyLearned: 1 });
  });

  it('offline: changes are queued, no completion is recorded until the server confirms', async () => {
    const env = await setup();
    const dev = env.cloud.device('offline-dev');
    const engine = new ProgressSyncEngine({ uid: 'bob', local: createMemoryStore(), remote: dev, deviceId: 'x', knownIds: new Set(), online: false, retryBaseMs: 5, firstSnapshotTimeoutMs: 20 });
    engines.push(engine);
    dev.setOnline(false);
    await engine.start();
    const s = snapshot({ dvok5: dvok5(490, [0]) });
    const c = { ...(await ctx(env, s)), uid: 'bob', engine, settleTimeoutMs: 100 };
    expect(await runImport(c)).toEqual({ status: 'queued', queued: 1, reason: 'offline-or-slow' });
    expect(env.account.records.size).toBe(0);
    dev.setOnline(true);
    engine.setOnline(true);
    expect(await runImport({ ...c, settleTimeoutMs: 3000 })).toMatchObject({ status: 'completed', imported: 1 });
    expect(env.cloud.writeLog.filter((w) => w.uid === 'bob')).toHaveLength(1); // resumed, not duplicated
  });
});
