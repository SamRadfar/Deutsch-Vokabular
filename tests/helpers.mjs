import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from '../scripts/lib/legacy-source.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const fixture = (relPath) =>
  JSON.parse(readFileSync(join(root, 'tests', 'fixtures', relPath), 'utf8'));

// LEGACY_SOURCE lets the suite run against another copy of the app (e.g. a mutation check).
export const legacySource = () => readSource(process.env.LEGACY_SOURCE || join(root, 'index.html'));

export const repoFile = (relPath) => readSource(join(root, relPath));
