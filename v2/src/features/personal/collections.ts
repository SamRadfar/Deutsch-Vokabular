// User-created categories ("collections") for personal words, e.g. an AI-generated topic list.
// Stored in the existing `placement` field — { category: "my:<name>", subtab: "<subcategory>" } —
// which the deployed Firestore rules already allow (bounded strings), so no rules change is needed.
// Built-in category keys never contain ":", so the two can never be confused.

import { cleanText, type PersonalWord } from './model';

export const COLLECTION_PREFIX = 'my:';
/** placement.category is limited to 40 characters (firestore.rules). */
export const COLLECTION_NAME_MAX = 40 - COLLECTION_PREFIX.length;
export const SUBCATEGORY_MAX = 60;
export const DEFAULT_SUBCATEGORY = 'Allgemein';

export type Placement = PersonalWord['placement'];

export const isCollectionKey = (key: string) => key.startsWith(COLLECTION_PREFIX);
export const collectionKey = (name: string) => `${COLLECTION_PREFIX}${name}`;
export const collectionNameOf = (key: string) => key.slice(COLLECTION_PREFIX.length);

export function cleanCollectionName(name: string): string {
  return cleanText(name).slice(0, COLLECTION_NAME_MAX).trim();
}

export function cleanSubcategory(name: string): string {
  return cleanText(name).slice(0, SUBCATEGORY_MAX).trim() || DEFAULT_SUBCATEGORY;
}

export function collectionPlacement(name: string, subcategory: string): NonNullable<Placement> {
  return { category: collectionKey(cleanCollectionName(name)), subtab: cleanSubcategory(subcategory) };
}

/** The collection of a word (null = built-in placement or none). */
export function wordCollection(w: Pick<PersonalWord, 'placement'>): { name: string; subcategory: string } | null {
  if (!w.placement || !isCollectionKey(w.placement.category)) return null;
  return { name: collectionNameOf(w.placement.category), subcategory: w.placement.subtab };
}

export interface CollectionSummary {
  key: string;
  name: string;
  count: number;
  subcategories: Array<{ name: string; count: number }>;
}

/** All collections of the user's words, alphabetical, with subcategory counts. */
export function listCollections(words: readonly PersonalWord[]): CollectionSummary[] {
  const map = new Map<string, Map<string, number>>();
  for (const w of words) {
    const c = wordCollection(w);
    if (!c) continue;
    const subs = map.get(c.name) ?? map.set(c.name, new Map()).get(c.name)!;
    subs.set(c.subcategory, (subs.get(c.subcategory) ?? 0) + 1);
  }
  return [...map].map(([name, subs]) => ({
    key: collectionKey(name),
    name,
    count: [...subs.values()].reduce((a, b) => a + b, 0),
    subcategories: [...subs].map(([n, count]) => ({ name: n, count })).sort((a, b) => a.name.localeCompare(b.name, 'de')),
  })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
