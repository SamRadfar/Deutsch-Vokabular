import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (one level above v2/). */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Read a Phase 1 fixture from the repository root (tests/fixtures/…). Read-only. */
export function phase1Fixture<T = unknown>(relPath: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, 'tests/fixtures', relPath), 'utf8')) as T;
}

/** Same fingerprint as Phase 1: SHA-256 over JSON.stringify (key order matters). */
export const sha256Json = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

export const sha256Text = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export interface Phase1Meta {
  sha256: { vocabulary: string; bautechnikInfo: string };
}
export interface Phase1ProgressKey {
  domIndex: number;
  progressKey: string;
  mainKey: string;
  tabId: string;
  groupIndex: number;
  rowIndex: number;
}
export interface Phase1Stats {
  totals: { categories: number; subtabs: number; groups: number; words: number; uniqueProgressKeys: number };
  progressKeyCollisions: Array<{ key: string; locations: string[] }>;
}
