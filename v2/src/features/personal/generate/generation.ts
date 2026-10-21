// Builds a topic vocabulary list of 25–200 entries from several small AI batches (≤ 15 each):
//  - the first batch establishes subcategories; later batches reuse them (and run two at a time,
//    each focused on another subcategory, so they rarely overlap);
//  - every batch gets the German words already collected as `avoid` (only words of THIS list —
//    the user's saved vocabulary is never sent to the AI service);
//  - duplicates inside the list are dropped (folded spelling, article ignored);
//  - transient failures are retried; limits, sign-in or configuration problems stop the run and
//    keep what was collected (the user sees the reason and may continue later).

import type { AiClient, AiFailure, GeneratedBatch } from '../../ai/aiClient';
import type { AiLevel, GeneratedEntry, GenerateRequest } from '../../../../ai-worker/src/contract';
import { GENERATE_LIMITS } from '../../../../ai-worker/src/contract';
import { duplicateKeys } from '../duplicates';

export const GENERATE_COUNTS = [25, 50, 100, 200] as const;
export type GenerateCount = (typeof GENERATE_COUNTS)[number];
export const GENERATE_LEVELS: ReadonlyArray<{ value: AiLevel; label: string }> = [
  { value: 'A1-A2', label: 'A1–A2' }, { value: 'B1-B2', label: 'B1–B2' }, { value: 'C1-C2', label: 'C1–C2' }, { value: 'all', label: 'همهٔ سطح‌ها' },
];

export interface GenerateOptions {
  topic: string;
  level: AiLevel;
  count: number;
  instructions?: string;
}

export interface GenerationProgress {
  collected: number;
  target: number;
  /** Batches finished (successful or not). */
  batches: number;
}

export interface GenerationResult {
  entries: GeneratedEntry[];
  /** Model entries that failed validation or were duplicates. */
  rejected: number;
  /** Placeholder data from the local development provider (not real AI). */
  mock: boolean;
  model: string;
  remainingToday: number | null;
  /** Set when the run stopped before reaching the target. */
  stoppedBy: AiFailure | null;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (p: GenerationProgress) => void;
  /** Batches running at the same time after the first one. */
  parallel?: number;
  /** Waits between retries (tests use 0). */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  /** Words to avoid from the start (e.g. "regenerate": the rows already in the table). */
  avoid?: readonly string[];
  /** Subcategories to keep using (e.g. "regenerate"). */
  subcategories?: readonly string[];
}

const TRANSIENT = new Set(['upstream-error', 'timeout', 'network', 'bad-response']);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The German word as the model and the list know it (for `avoid`). */
export const entryWord = (e: Pick<GeneratedEntry, 'article' | 'lemma'>) => (e.article ? `${e.article} ${e.lemma}` : e.lemma);

export async function runGeneration(client: AiClient, opts: GenerateOptions, run: RunOptions = {}): Promise<GenerationResult> {
  const { signal, onProgress, parallel = 2, retryDelaysMs = [2000, 6000], sleep = defaultSleep } = run;
  const target = Math.max(1, Math.min(opts.count, 200));
  const entries: GeneratedEntry[] = [];
  const keys = new Set<string>();
  const avoidWords: string[] = [...(run.avoid ?? [])];
  for (const w of avoidWords) for (const k of duplicateKeys(w)) keys.add(k);
  const subcategories: string[] = [...(run.subcategories ?? [])];
  let rejected = 0;
  let batches = 0;
  let mock = false;
  let model = '';
  let remainingToday: number | null = null;
  let stoppedBy: AiFailure | null = null;
  let stale = 0;

  const accept = (batch: GeneratedBatch) => {
    mock ||= batch.mock;
    model = batch.model || model;
    remainingToday = batch.remainingToday;
    rejected += batch.rejected;
    let added = 0;
    for (const e of batch.entries) {
      const ks = duplicateKeys(e.lemma);
      if (entries.length >= target || ks.some((k) => keys.has(k))) { rejected++; continue; }
      ks.forEach((k) => keys.add(k));
      entries.push(e);
      avoidWords.push(entryWord(e));
      added++;
      if (e.subcategory && !subcategories.includes(e.subcategory) && subcategories.length < GENERATE_LIMITS.subcategories) subcategories.push(e.subcategory);
    }
    return added;
  };

  const request = (count: number, focus?: string): GenerateRequest => ({
    topic: opts.topic,
    level: opts.level,
    count,
    ...(opts.instructions ? { instructions: opts.instructions } : {}),
    ...(subcategories.length ? { subcategories: subcategories.slice(0, GENERATE_LIMITS.subcategories) } : {}),
    ...(focus ? { focus } : {}),
    ...(avoidWords.length ? { avoid: avoidWords.slice(-GENERATE_LIMITS.avoid) } : {}),
  });

  /** One batch with retries; a non-transient failure stops the whole run. */
  const batch = async (count: number, focus?: string): Promise<number> => {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted || stoppedBy) return 0;
      const r = await client.generate(request(count, focus), signal);
      if (r.ok) return accept(r.batch);
      if (r.code === 'aborted') return 0;
      if (TRANSIENT.has(r.code) && attempt < retryDelaysMs.length) { await sleep(retryDelaysMs[attempt]!); continue; }
      stoppedBy = r;
      return 0;
    }
  };

  const report = () => onProgress?.({ collected: entries.length, target, batches });
  report();
  let turn = 0;
  while (entries.length < target && !stoppedBy && !signal?.aborted) {
    const remaining = target - entries.length;
    // First batch alone (it names the subcategories), then `parallel` batches at a time.
    const lanes = batches === 0 && !subcategories.length ? 1 : Math.min(parallel, Math.ceil(remaining / GENERATE_LIMITS.batch));
    const sizes = Array.from({ length: lanes }, () => Math.min(GENERATE_LIMITS.batch, Math.max(1, Math.ceil(remaining / lanes))));
    const added = await Promise.all(sizes.map((n) => {
      const focus = subcategories.length ? subcategories[turn++ % subcategories.length] : undefined;
      return batch(n, focus).finally(() => { batches++; report(); });
    }));
    // Stop when the model keeps repeating itself (nothing new in several rounds).
    stale = added.some((n) => n > 0) ? 0 : stale + 1;
    if (stale >= 3) break;
  }
  report();
  return { entries, rejected, mock, model, remainingToday, stoppedBy };
}
