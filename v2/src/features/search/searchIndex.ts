// Vocabulary search over the bundled content (999 entries). Folding is done once per entry when the
// index is built; a search is a linear scan of pre-folded strings (well under a millisecond-range
// cost per keystroke for this dataset), so no worker or external index is needed.

import type { WordId } from '../../models/vocabulary';
import type { DeckCard, PracticeCategoryKey } from '../review/deck';
import { fold, originalRange, queryTerms, type Folded } from './normalize';

export type SearchField = 'word' | 'fa' | 'example' | 'exampleFa';
export const SEARCH_FIELDS: readonly SearchField[] = ['word', 'fa', 'example', 'exampleFa'];

export type StatusFilter = 'all' | 'learned' | 'unlearned';

export interface SearchFilters {
  category: 'all' | PracticeCategoryKey;
  /** Subcategory id within the chosen category, or 'all'. */
  subtab: string;
  status: StatusFilter;
}

export const NO_FILTERS: SearchFilters = { category: 'all', subtab: 'all', status: 'all' };

export const filtersActive = (f: SearchFilters) => f.category !== 'all' || f.subtab !== 'all' || f.status !== 'all';

export type Range = readonly [start: number, end: number];

export interface SearchHit {
  card: DeckCard;
  /** Lower is better (see `rank`). */
  score: number;
  /** Matched ranges in the ORIGINAL field text, merged and sorted. */
  ranges: Readonly<Partial<Record<SearchField, readonly Range[]>>>;
}

interface IndexedField {
  original: string;
  plain: Folded;
  /** German fields only: the ä→ae form. */
  translit?: Folded;
}

interface IndexedEntry {
  card: DeckCard;
  fields: Record<SearchField, IndexedField>;
  /** Folded word without its article (for "exact word" ranking). */
  bareWord: string;
}

const ARTICLE = /^(der|die|das|ein|eine) /;

function indexField(original: string, german: boolean): IndexedField {
  const plain = fold(original);
  return german ? { original, plain, translit: fold(original, true) } : { original, plain };
}

export interface SearchIndex {
  readonly size: number;
  search(query: string, filters: SearchFilters, learned: ReadonlySet<WordId> | null, keep?: ReadonlySet<WordId>): SearchHit[];
}

export function createSearchIndex(cards: readonly DeckCard[]): SearchIndex {
  const entries: IndexedEntry[] = cards.map((card) => {
    const fields = {
      word: indexField(card.entry.word, true),
      fa: indexField(card.entry.fa, false),
      example: indexField(card.entry.example, true),
      exampleFa: indexField(card.entry.exampleFa, false),
    };
    return { card, fields, bareWord: fields.word.plain.text.replace(ARTICLE, '') };
  });

  return {
    size: entries.length,
    search(query, filters, learned, keep) {
      const terms = queryTerms(query);
      const hits: SearchHit[] = [];
      for (const e of entries) {
        const { card } = e;
        if (filters.category !== 'all' && card.categoryKey !== filters.category) continue;
        if (filters.subtab !== 'all' && card.subtabId !== filters.subtab) continue;
        // Status filter; `keep` holds words toggled in the current result view so they do not vanish under the cursor.
        if (filters.status !== 'all' && learned && !keep?.has(card.entry.id)) {
          if (learned.has(card.entry.id) !== (filters.status === 'learned')) continue;
        }
        if (!terms.length) { hits.push({ card, score: 0, ranges: {} }); continue; }
        const hit = matchEntry(e, terms);
        if (hit) hits.push(hit);
      }
      return terms.length ? hits.sort((a, b) => a.score - b.score || a.card.order - b.card.order) : hits;
    },
  };
}

function findAll(f: Folded, original: string, term: string, out: Range[]): boolean {
  let found = false;
  let from = f.text.indexOf(term);
  while (from !== -1) {
    out.push(originalRange(f, original, from, term.length));
    found = true;
    from = f.text.indexOf(term, from + term.length);
  }
  return found;
}

/** Field rank of one term: word exact 0 · word prefix 1 · word 2 · Persian meaning 3 · example 4 · example translation 5. */
function rank(e: IndexedEntry, field: SearchField, term: string, query: string): number {
  if (field === 'word') {
    if (e.bareWord === query || e.fields.word.plain.text === query) return 0;
    if (e.bareWord.startsWith(term) || e.fields.word.plain.text.startsWith(term)) return 1;
    return 2;
  }
  if (field === 'fa') return e.fields.fa.plain.text === query ? 1 : 3;
  return field === 'example' ? 4 : 5;
}

function matchEntry(e: IndexedEntry, terms: string[]): SearchHit | null {
  const ranges: Partial<Record<SearchField, Range[]>> = {};
  const query = terms.join(' ');
  let worst = 0;
  let sum = 0;
  for (const term of terms) {
    let best = Infinity;
    for (const field of SEARCH_FIELDS) {
      const f = e.fields[field];
      const out: Range[] = [];
      let found = findAll(f.plain, f.original, term, out);
      if (f.translit) found = findAll(f.translit, f.original, term, out) || found;
      if (!found) continue;
      (ranges[field] ??= []).push(...out);
      best = Math.min(best, rank(e, field, term, query));
    }
    if (best === Infinity) return null; // every term must match somewhere
    worst = Math.max(worst, best);
    sum += best;
  }
  for (const field of SEARCH_FIELDS) if (ranges[field]) ranges[field] = mergeRanges(ranges[field]!);
  return { card: e.card, score: worst * 100 + sum, ranges };
}

export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
