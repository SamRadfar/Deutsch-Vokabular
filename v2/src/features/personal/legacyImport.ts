// Preview-first import of legacy custom words (`dvok5_custom`) into the personal vocabulary.
//  - Idempotent: a legacy word whose id was imported before (`legacyId`) is skipped.
//  - Nothing silent: duplicates of existing personal or built-in words are listed and skipped
//    unless the user explicitly includes them.
//  - Non-destructive: the legacy data in localStorage / the backup file is only read.

import type { Category } from '../../models/vocabulary';
import type { LegacyCustomWord } from '../../models/legacy';
import { parseCustomWords } from '../progress/migration/parse';
import type { DeckCard } from '../review/deck';
import { createDuplicateIndex, type DuplicateMatch } from './duplicates';
import {
  isValidInput, newPersonalId, normalizeInput, validateInput,
  type PersonalWord, type PersonalWordInput,
} from './model';

export type ImportStatus =
  | 'new'                // will be imported
  | 'incomplete'         // will be imported, but the legacy app never filled in the meaning (AI "pending")
  | 'already-imported'   // imported before (same legacy id) — skipped
  | 'duplicate-personal' // same word already in "my words" — skipped
  | 'duplicate-builtin'  // same word in the built-in list — skipped unless included
  | 'invalid';           // cannot be imported (reason given)

export interface ImportItem {
  legacy: LegacyCustomWord;
  status: ImportStatus;
  /** Prepared record (absent for skipped/invalid items). */
  word: PersonalWord | null;
  duplicates: DuplicateMatch[];
  /** Original category/subtab no longer exists → kept without placement. */
  unsorted: boolean;
  reason: string | null;
}

export interface ImportPlan {
  items: ImportItem[];
  /** Elements of dvok5_custom that are not valid custom words at all. */
  malformed: number;
  /** dvok5_custom exists but is not readable JSON / not an array. */
  unreadable: string | null;
}

/** Legacy custom words used n/v/a/x where x meant "Ausdruck" (built-in data uses "au"). */
function mapType(t: string): PersonalWordInput['type'] {
  if (t === 'n' || t === 'v' || t === 'a') return t;
  if (t === 'x' || t === 'au') return 'au';
  return 'x';
}

/** "cw1712345678901" → its creation time, if plausible. */
function legacyTime(id: string, fallback: number): number {
  const ms = Number(/^cw(\d{12,14})$/.exec(id)?.[1]);
  return Number.isFinite(ms) && ms > 1_500_000_000_000 && ms <= fallback ? ms : fallback;
}

export interface ImportContext {
  categories: readonly Category[];
  builtIn: readonly DeckCard[];
  existing: readonly PersonalWord[];
  now: number;
  newId?: () => string;
}

export function planLegacyImport(rawCustom: string | null, ctx: ImportContext): ImportPlan {
  const parsed = parseCustomWords(rawCustom);
  if (parsed.status === 'invalid') return { items: [], malformed: 0, unreadable: parsed.reason };
  if (parsed.status === 'absent') return { items: [], malformed: 0, unreadable: null };
  const importedLegacyIds = new Set(ctx.existing.map((w) => w.legacyId).filter((x): x is string => !!x));
  const dupes = createDuplicateIndex(ctx.builtIn, ctx.existing);
  const seenInBatch = new Map<string, string>(); // duplicate key → first legacy id in this file
  const seenIds = new Set<string>();
  const items: ImportItem[] = [];

  for (const legacy of parsed.value.words) {
    const base = { legacy, word: null, duplicates: [] as DuplicateMatch[], unsorted: false, reason: null };
    if (seenIds.has(legacy.id)) { items.push({ ...base, status: 'invalid', reason: 'شناسهٔ تکراری در دادهٔ قدیمی' }); continue; }
    seenIds.add(legacy.id);
    if (importedLegacyIds.has(legacy.id)) { items.push({ ...base, status: 'already-imported' }); continue; }

    const category = ctx.categories.find((c) => c.key === legacy.main);
    const placement = category?.subtabs.some((s) => s.id === legacy.tab) ? { category: category.key, subtab: legacy.tab } : null;
    const incomplete = legacy.status === 'pending' || !legacy.fa.trim();
    const input = normalizeInput({
      article: null,
      lemma: legacy.word,
      type: mapType(legacy.type),
      grammar: '',
      fa: legacy.fa,
      example: legacy.ex || legacy.sentence,
      exampleFa: legacy.exFa,
      pronunciationFa: legacy.pr,
      placement,
    });
    const errors = validateInput(input, { allowEmptyFa: true });
    if (!isValidInput(errors)) {
      items.push({ ...base, status: 'invalid', reason: Object.values(errors).join(' ') });
      continue;
    }
    const at = legacyTime(legacy.id, ctx.now);
    const word: PersonalWord = {
      schemaVersion: 1, id: (ctx.newId ?? newPersonalId)(), ...input, learned: legacy.checked,
      createdAt: at, updatedAt: ctx.now, source: 'legacy-import', legacyId: legacy.id,
    };
    const duplicates = dupes.find(input.lemma);
    const key = duplicates.length ? '' : `${input.article ?? ''} ${input.lemma}`.toLowerCase();
    let status: ImportStatus = incomplete ? 'incomplete' : 'new';
    if (duplicates.some((d) => d.kind === 'personal')) status = 'duplicate-personal';
    else if (duplicates.length) status = 'duplicate-builtin';
    else if (seenInBatch.has(key)) status = 'duplicate-personal'; // twice in the legacy data itself
    if (key) seenInBatch.set(key, legacy.id);
    items.push({ ...base, status, word, duplicates, unsorted: !placement });
  }
  return { items, malformed: parsed.value.invalid, unreadable: null };
}

/** The words a confirmed import adds. */
export function wordsToImport(plan: ImportPlan, opts: { includeBuiltInDuplicates: boolean }): PersonalWord[] {
  return plan.items
    .filter((i) => i.word && (i.status === 'new' || i.status === 'incomplete' || (opts.includeBuiltInDuplicates && i.status === 'duplicate-builtin')))
    .map((i) => i.word!);
}

export function countImport(plan: ImportPlan) {
  const c: Record<ImportStatus, number> = { new: 0, incomplete: 0, 'already-imported': 0, 'duplicate-personal': 0, 'duplicate-builtin': 0, invalid: 0 };
  for (const i of plan.items) c[i.status]++;
  return c;
}
