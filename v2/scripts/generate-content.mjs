#!/usr/bin/env node
// ONE-TIME migration tool: converts the legacy DATA / BAUTECHNIK_INFO objects of the
// root index.html into versioned v2 content and mints permanent word ids.
//
// Safety:
// - Aborts unless the legacy vocabulary is byte-identical (SHA-256 over ordered JSON) to
//   the Phase 1 baseline (tests/fixtures/baseline/meta.json).
// - Never overwrites existing outputs without --force. With --force, ids are taken from
//   the existing id registry and NEVER re-minted, so a re-run cannot change any id.
// - Text is copied verbatim; nothing is corrected, trimmed or deduplicated.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readSource, extractData, extractBautechnikInfo, listRows, sha256,
} from '../../scripts/lib/legacy-source.mjs';

const v2 = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(v2, '..');
const force = process.argv.includes('--force');

const out = {
  vocabulary: join(v2, 'src/data/vocabulary/vocabulary.v1.json'),
  technicalInfo: join(v2, 'src/data/vocabulary/technical-info.v1.json'),
  registry: join(v2, 'src/data/vocabulary/id-registry.v1.json'),
  dvok5Maps: join(v2, 'src/data/legacy/dvok5-index-maps.v1.json'),
};

const LEGACY_COMMIT = '6763003';
export const ID_ALGORITHM =
  "'dv_' + sha256('deutsch-vokabular/word/v1|' + baselineIndex + '|' + legacyKey).hex.slice(0, 10) — applied once at minting";

export function mintId(baselineIndex, legacyKey) {
  const h = createHash('sha256').update(`deutsch-vokabular/word/v1|${baselineIndex}|${legacyKey}`, 'utf8').digest('hex');
  return `dv_${h.slice(0, 10)}`;
}

const KIND = { sym: 'symbol', fa: 'persian', '': 'plain' };

function main() {
  const meta = JSON.parse(readFileSync(join(repo, 'tests/fixtures/baseline/meta.json'), 'utf8'));
  const src = readSource(join(repo, 'index.html'));
  const data = extractData(src);
  const info = extractBautechnikInfo(src);
  if (sha256(data) !== meta.sha256.vocabulary) throw new Error('Legacy DATA differs from the Phase 1 baseline — aborting.');
  if (sha256(info) !== meta.sha256.bautechnikInfo) throw new Error('Legacy BAUTECHNIK_INFO differs from the Phase 1 baseline — aborting.');

  const existing = Object.values(out).filter((p) => existsSync(p));
  if (existing.length && !force) {
    console.log('Outputs already exist; nothing written (use --force to regenerate with the existing ids):');
    existing.forEach((p) => console.log('  ' + p));
    return;
  }

  // Ids: reuse the registry if it exists, otherwise mint once.
  const rows = listRows(data);
  let registry;
  if (existsSync(out.registry)) {
    registry = JSON.parse(readFileSync(out.registry, 'utf8'));
    if (registry.entries.length !== rows.length) throw new Error('Registry size does not match the baseline.');
  } else {
    registry = {
      schemaVersion: 1,
      description:
        'Immutable id registry. Each built-in entry received a permanent id when v2 content was created. ' +
        'Never regenerate or edit ids; new entries get new ids. legacyKey = mainKey::word (not unique).',
      algorithm: ID_ALGORITHM,
      mintedFrom: { legacyCommit: LEGACY_COMMIT, legacyDataSha256: meta.sha256.vocabulary },
      entries: rows.map((r) => ({
        id: mintId(r.domIndex, r.progressKey),
        legacyKey: r.progressKey,
        legacyWord: r.word,
        baselineIndex: r.domIndex,
        baselineLocation: { category: r.mainKey, subtab: r.tabId, group: r.groupIndex, row: r.rowIndex },
      })),
    };
  }
  const ids = new Set(registry.entries.map((e) => e.id));
  if (ids.size !== registry.entries.length) throw new Error('Id collision — aborting.');

  let i = 0;
  const vocabulary = {
    schemaVersion: 1,
    contentVersion: '1.0.0',
    source: { legacyCommit: LEGACY_COMMIT, legacyDataSha256: meta.sha256.vocabulary },
    categories: Object.entries(data).map(([key, section]) => ({
      key,
      label: section.label,
      theme: section.theme,
      subtabs: section.tabs.map((tab) => ({
        id: tab.id,
        icon: tab.icon,
        label: tab.label,
        fa: tab.fa,
        groups: tab.groups.map((g) => ({
          label: g.label,
          entries: g.rows.map(([word, type, fa, example, exampleFa, pronunciationFa]) => {
            const reg = registry.entries[i++];
            if (reg.legacyWord !== word || !reg.legacyKey.startsWith(key + '::')) {
              throw new Error(`Registry mismatch at baseline index ${i - 1}`);
            }
            return { id: reg.id, word, type, fa, example, exampleFa, pronunciationFa };
          }),
        })),
      })),
    })),
  };

  const technicalInfo = {
    schemaVersion: 1,
    entries: Object.entries(info).map(([legacyWord, v]) => ({
      legacyWord,
      entryIds: registry.entries
        .filter((e) => e.baselineLocation.category === 'bautechnik' && e.legacyWord === legacyWord)
        .map((e) => e.id),
      formula: v.formula ? { label: v.formula.lbl, value: v.formula.val } : null,
      rows: v.kv.map((r) => {
        if (!(r.cls in KIND)) throw new Error(`Unknown technical-info class "${r.cls}"`);
        return { key: r.key, value: r.val, kind: KIND[r.cls] };
      }),
    })),
  };

  const legacyMaps = JSON.parse(readFileSync(join(repo, 'tests/fixtures/legacy/dvok5-index-maps.json'), 'utf8'));
  const dvok5Maps = {
    schemaVersion: 1,
    description: legacyMaps.description,
    versions: legacyMaps.versions.map(({ checkboxCount, dataSha256, commits, keys }) => ({ checkboxCount, dataSha256, commits, keys })),
  };

  const write = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
    console.log('wrote', path.slice(v2.length + 1));
  };
  write(out.registry, registry);
  write(out.vocabulary, vocabulary);
  write(out.technicalInfo, technicalInfo);
  write(out.dvok5Maps, dvok5Maps);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
