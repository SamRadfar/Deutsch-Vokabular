// Duplicate detection for personal words: same German word (folded: case, ß/ss, umlauts, accents;
// article ignored) as a built-in entry or another personal word. Duplicates are only REPORTED —
// nothing is merged or deleted automatically.

import type { DeckCard } from '../review/deck';
import { fold } from '../search/normalize';
import { displayWord, type PersonalWord } from './model';

const stripArticle = (word: string) => word.replace(/^\s*(der|die|das)\s+/i, '');
/** Both folded forms (ü→u and ü→ue), so "Übung", "Ubung" and "Uebung" meet. */
export const duplicateKeys = (word: string) => [...new Set([fold(stripArticle(word)).text, fold(stripArticle(word), true).text])].filter(Boolean);
export const duplicateKey = (word: string) => fold(stripArticle(word)).text;

export interface DuplicateMatch {
  kind: 'builtIn' | 'personal';
  id: string;
  word: string;
  fa: string;
  /** Where the match lives, e.g. "Architecture › Bau & Konstruktion". */
  where: string;
}

export interface DuplicateIndex {
  find(lemmaOrWord: string, exceptId?: string): DuplicateMatch[];
}

export function createDuplicateIndex(builtIn: readonly DeckCard[], personal: readonly PersonalWord[]): DuplicateIndex {
  const map = new Map<string, DuplicateMatch[]>();
  const add = (word: string, m: DuplicateMatch) => {
    for (const key of duplicateKeys(word)) (map.get(key) ?? map.set(key, []).get(key)!).push(m);
  };
  for (const c of builtIn) {
    add(c.entry.word, { kind: 'builtIn', id: c.entry.id, word: c.entry.word, fa: c.entry.fa, where: `${c.categoryLabel} › ${c.subtabLabel}` });
  }
  for (const w of personal) add(w.lemma, { kind: 'personal', id: w.id, word: displayWord(w), fa: w.fa, where: 'واژه‌های من' });
  return {
    find(word, exceptId) {
      const seen = new Set<string>();
      const out: DuplicateMatch[] = [];
      for (const key of duplicateKeys(word)) {
        for (const m of map.get(key) ?? []) if (m.id !== exceptId && !seen.has(m.id)) { seen.add(m.id); out.push(m); }
      }
      return out;
    },
  };
}
