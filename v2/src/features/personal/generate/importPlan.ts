// From reviewed preview rows to personal words. Pure and idempotent:
//  - every row carries its final word id from the moment it was generated, so importing the same
//    preview twice (double click, retry after a failure, a second device) writes the SAME documents
//    and PersonalVocabulary.addMany never overwrites an existing word;
//  - rows are validated with the same rules as the word form (and the Firestore rules);
//  - the destination (features/categories) is resolved by the caller into a placement per row.

import type { GeneratedEntry } from '../../../../ai-worker/src/contract';
import { articleLooksWrong, suggestedArticle } from './articleHint';
import type { DuplicateIndex, DuplicateMatch } from '../duplicates';
import {
  isValidInput, isValidPersonalWord, newPersonalId, normalizeInput, validateInput,
  type FieldErrors, type PersonalWord, type PersonalWordInput,
} from '../model';

export interface DraftRow {
  /** The personal word id this row becomes (stable → idempotent import). */
  id: string;
  entry: GeneratedEntry;
  selected: boolean;
}

/** Where a row goes (resolved by the caller from the category destination at import time). */
export type PlacementFor = (row: DraftRow) => PersonalWord['placement'];

export function draftRows(entries: readonly GeneratedEntry[], duplicates: DuplicateIndex, newId: () => string = () => newPersonalId()): DraftRow[] {
  // Rows that duplicate a word the user already has start unselected (never imported silently).
  return entries.map((entry) => ({ id: newId(), entry, selected: duplicates.find(entry.lemma).length === 0 }));
}

export function rowInput(row: DraftRow, placementFor: PlacementFor = () => null): PersonalWordInput {
  const e = row.entry;
  const placement = placementFor(row);
  return {
    article: e.article, lemma: e.lemma, type: e.type, grammar: e.grammar, fa: e.fa,
    example: e.example, exampleFa: e.exampleFa, pronunciationFa: '', placement,
  };
}

/** Validation messages of a row (empty = importable). */
export function rowErrors(row: DraftRow): FieldErrors {
  return validateInput(normalizeInput(rowInput(row)));
}

export interface ImportPlan {
  words: PersonalWord[];
  /** Selected rows that cannot be imported as they are (shown to the user). */
  invalid: string[];
}

export function buildImport(rows: readonly DraftRow[], placementFor: PlacementFor, now: number): ImportPlan {
  const words: PersonalWord[] = [];
  const invalid: string[] = [];
  rows.filter((r) => r.selected).forEach((row, i) => {
    const input = normalizeInput(rowInput(row, placementFor));
    if (!isValidInput(validateInput(input))) { invalid.push(row.id); return; }
    // createdAt keeps the preview order (the list shows newest first).
    const at = now + (rows.length - i);
    const word: PersonalWord = {
      schemaVersion: 1, id: row.id, ...input, learned: false, createdAt: at, updatedAt: at, source: 'manual', legacyId: null,
    };
    if (isValidPersonalWord(word)) words.push(word); else invalid.push(row.id);
  });
  return { words, invalid };
}

export interface RowCheck {
  duplicates: DuplicateMatch[];
  errors: FieldErrors;
  /** The article contradicts a reliable noun ending — the expected article (a warning only). */
  articleHint: 'der' | 'die' | 'das' | null;
}

export function checkRow(row: DraftRow, duplicates: DuplicateIndex): RowCheck {
  const e = row.entry;
  const hint = e.type === 'n' && articleLooksWrong(e.article, e.lemma) ? suggestedArticle(e.lemma) : null;
  return { duplicates: duplicates.find(e.lemma), errors: rowErrors(row), articleHint: hint };
}
