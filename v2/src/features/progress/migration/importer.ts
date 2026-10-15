// Turns a MigrationPlan into a non-destructive import against the signed-in user's
// current progress, executes it through the sync engine, verifies the result and records
// completion. Rules (docs/MIGRATION_SPEC.md §4, §8):
//  - only ADDS "learned" for entries the account has no record for;
//  - never overwrites an existing cloud/local value (explicit "not learned" is a conflict);
//  - the legacy data is never modified or deleted;
//  - a dataset (identified by its SHA-256) is imported at most once per account.

import type { WordId } from '../../../models/vocabulary';
import type { AccountRemote, MigrationRecord } from '../accountRemote';
import type { ProgressSyncEngine } from '../syncEngine';
import type { MigrationPlan } from './types';

export interface ProgressLookup {
  isLearned(id: WordId): boolean;
  hasRecord(id: WordId): boolean;
}

export interface ImportAnalysis {
  /** Will be marked learned. */
  toImport: WordId[];
  /** Already learned in the account — nothing to do. */
  alreadyLearned: WordId[];
  /** The account explicitly has "not learned" (cloud or pending) — skipped, never overwritten. */
  conflicts: WordId[];
}

export function analyzeImport(plan: MigrationPlan, current: ProgressLookup): ImportAnalysis {
  const out: ImportAnalysis = { toImport: [], alreadyLearned: [], conflicts: [] };
  for (const mark of plan.learned) {
    if (current.isLearned(mark.id)) out.alreadyLearned.push(mark.id);
    else if (current.hasRecord(mark.id)) out.conflicts.push(mark.id);
    else out.toImport.push(mark.id);
  }
  return out;
}

export const engineLookup = (engine: ProgressSyncEngine): ProgressLookup => ({
  isLearned: (id) => engine.getView().learned.has(id),
  hasRecord: (id) => engine.hasPending(id) || engine.confirmedOf(id) !== undefined,
});

export type ImportOutcome =
  | { status: 'already-imported' }
  | { status: 'completed'; imported: number; verified: number; record: MigrationRecord }
  | { status: 'queued'; queued: number; reason: string }
  | { status: 'incomplete'; queued: number; verified: number };

export interface ImportContext {
  uid: string;
  engine: ProgressSyncEngine;
  account: AccountRemote;
  inputHash: string;
  source: MigrationRecord['source'];
  contentVersion: string;
  plan: MigrationPlan;
  settleTimeoutMs?: number;
}

const markerKey = (hash: string) => `migration:${hash}`;

export interface LocalMarker { status: 'queued' | 'completed'; ids: WordId[]; at: number }

/** Has this dataset already been imported into this account (cloud record or local marker)? */
export async function findPreviousImport(ctx: Pick<ImportContext, 'uid' | 'engine' | 'account' | 'inputHash'>): Promise<'completed' | 'queued' | null> {
  const local = await ctx.engine.readMeta<LocalMarker>(markerKey(ctx.inputHash));
  try {
    if (await ctx.account.getMigrationRecord(ctx.uid, ctx.inputHash)) return 'completed';
  } catch {
    // Offline or rules not deployed: fall back to the local marker.
  }
  return local?.status ?? null;
}

export async function runImport(ctx: ImportContext): Promise<ImportOutcome> {
  const previous = await findPreviousImport(ctx);
  if (previous === 'completed') return { status: 'already-imported' };

  const lookup = engineLookup(ctx.engine);
  const marker = await ctx.engine.readMeta<LocalMarker>(markerKey(ctx.inputHash));
  const analysis = analyzeImport(ctx.plan, lookup);
  // Re-check right before writing: a value that appeared meanwhile is never overwritten.
  const queued = previous === 'queued' && marker ? marker.ids : analysis.toImport.filter((id) => !lookup.hasRecord(id));
  if (previous !== 'queued') {
    await ctx.engine.writeMeta(markerKey(ctx.inputHash), { status: 'queued', ids: queued, at: Date.now() } satisfies LocalMarker);
    for (const id of queued) void ctx.engine.setLearned(id, true, 'migration');
  }

  const settled = await ctx.engine.waitForSettled(queued, ctx.settleTimeoutMs ?? 30_000);
  if (!settled) return { status: 'queued', queued: queued.length, reason: 'offline-or-slow' };

  // Verify against server-confirmed state, not against the optimistic view.
  const verified = queued.filter((id) => ctx.engine.confirmedOf(id)?.learned === true).length;
  if (verified !== queued.length) return { status: 'incomplete', queued: queued.length, verified };

  const record: MigrationRecord = {
    schemaVersion: 1,
    inputHash: ctx.inputHash,
    source: ctx.source,
    legacyContentCommit: '6763003',
    contentVersion: ctx.contentVersion,
    status: 'completed',
    counts: {
      matchedEntries: ctx.plan.learned.length,
      imported: queued.length,
      // On a resumed import the queued ids now look "already learned"; do not count them twice.
      alreadyLearned: analysis.alreadyLearned.filter((id) => !queued.includes(id)).length,
      conflictsSkipped: analysis.conflicts.length,
      ambiguousKeys: ctx.plan.ambiguous.length,
      orphanedKeys: ctx.plan.orphans.length,
    },
  };
  await ctx.account.createMigrationRecord(ctx.uid, record);
  await ctx.engine.writeMeta(markerKey(ctx.inputHash), { status: 'completed', ids: queued, at: Date.now() } satisfies LocalMarker);
  return { status: 'completed', imported: queued.length, verified, record };
}
