// Subcategory filter for practice (Shadowing, flashcards): the subcategories of ONE main category
// — the library's built-in subtabs and the account's own subcategories, from the same catalog the
// rest of the app uses — plus "directly in this category" when personal words sit there.

import type { DeckCard } from '../review/deck';
import type { CatalogMain } from './catalog';
import { DIRECT_SUBTAB } from './model';

export interface SubScope {
  id: string;
  label: string;
  /** An own subcategory (or the "directly in the category" group), not part of the library. */
  own: boolean;
}

export const DIRECT_SUB_LABEL = 'مستقیم در این دسته';

/**
 * The subcategories offered for a main category; [] = no selector (unknown key, "my words", or a
 * category without subcategories — then "all" is the only meaningful choice).
 */
export function subScopes(catalog: readonly CatalogMain[], mainKey: string | null, cards: readonly DeckCard[]): SubScope[] {
  const main = mainKey ? catalog.find((m) => m.id === mainKey) : undefined;
  if (!main || !main.subs.length) return [];
  const subs: SubScope[] = main.subs.map((s) => ({ id: s.id, label: s.name, own: !s.builtIn }));
  const direct = cards.some((c) => c.categoryKey === main.id && c.subtabId === DIRECT_SUBTAB);
  return direct ? [...subs, { id: DIRECT_SUBTAB, label: DIRECT_SUB_LABEL, own: true }] : subs;
}

/** A remembered subcategory that is still offered, otherwise null (= all subcategories). */
export function validSub(subs: readonly SubScope[], sub: string | null | undefined): string | null {
  return sub && subs.some((s) => s.id === sub) ? sub : null;
}

/** Stored subcategory ids: built-in subtab ids, own ids ("uc_…") or "_" (directly in the main). */
export const SUB_ID_PATTERN = /^[A-Za-z0-9_-]{1,60}$/;
