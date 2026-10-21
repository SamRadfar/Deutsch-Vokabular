// One catalog of every category the account can use — built-in library categories (read-only) and
// the account's own categories — and the single way vocabulary workflows choose and resolve a
// destination. Used by the word form, the AI generator, category management and navigation.

import type { Category, Subtab, VocabularyEntry } from '../../models/vocabulary';
import { categoryName } from '../../models/vocabulary';
import { toEntry, type PersonalWord } from '../personal/model';
import type { CategoryStore } from './categoryStore';
import { DIRECT_SUBTAB, isCategoryId, NAME_ERROR_TEXT, validateName, type UserCategory } from './model';

export interface CatalogSub { id: string; name: string; builtIn: boolean }
export interface CatalogMain { id: string; name: string; builtIn: boolean; theme: string; subs: CatalogSub[] }
export type Placement = PersonalWord['placement'];

export function buildCatalog(builtIn: readonly Category[], user: readonly UserCategory[]): CatalogMain[] {
  const childrenOf = (parent: string) => user.filter((c) => c.parentId === parent).map((c) => ({ id: c.id, name: c.name, builtIn: false }));
  return [
    ...builtIn.map((c) => ({
      id: c.key, name: categoryName(c.label), builtIn: true, theme: c.theme,
      subs: [...c.subtabs.map((s) => ({ id: s.id, name: s.label, builtIn: true })), ...childrenOf(c.key)],
    })),
    ...user.filter((c) => c.parentId === null).map((c) => ({ id: c.id, name: c.name, builtIn: false, theme: 'mine', subs: childrenOf(c.id) })),
  ];
}

export function placementOf(mainId: string, subId: string | null): NonNullable<Placement> {
  return { category: mainId, subtab: subId ?? DIRECT_SUBTAB };
}

/** Where a word's placement points to (null: no category, or a category that no longer exists). */
export function resolvePlacement(placement: Placement, catalog: readonly CatalogMain[]): { main: CatalogMain; sub: CatalogSub | null } | null {
  if (!placement) return null;
  const main = catalog.find((m) => m.id === placement.category);
  if (!main) return null;
  if (placement.subtab === DIRECT_SUBTAB) return { main, sub: null };
  const sub = main.subs.find((s) => s.id === placement.subtab);
  return sub ? { main, sub } : { main, sub: null };
}

export function placementLabel(placement: Placement, catalog: readonly CatalogMain[]): string | null {
  const r = resolvePlacement(placement, catalog);
  return r ? (r.sub ? `${r.main.name} › ${r.sub.name}` : r.main.name) : null;
}

// ── Destinations (shared by every vocabulary workflow) ─────────────────────────────────────────

export type Destination =
  | { kind: 'none' }
  /** subId null = directly in the main category. */
  | { kind: 'existing'; mainId: string; subId: string | null }
  /** subName '' = no initial subcategory. */
  | { kind: 'newMain'; name: string; subName: string }
  | { kind: 'newSub'; mainId: string; name: string };

export const NO_DESTINATION: Destination = { kind: 'none' };

export function destinationOf(placement: Placement, catalog: readonly CatalogMain[]): Destination {
  const r = resolvePlacement(placement, catalog);
  return r ? { kind: 'existing', mainId: r.main.id, subId: r.sub?.id ?? null } : NO_DESTINATION;
}

/** Validation without writing anything (forms show it while typing; nothing is created on preview). */
export function destinationError(d: Destination, catalog: readonly CatalogMain[]): string | null {
  if (d.kind === 'none') return null;
  if (d.kind === 'existing') {
    const main = catalog.find((m) => m.id === d.mainId);
    if (!main) return 'یک دستهٔ اصلی انتخاب کنید.';
    if (d.subId && !main.subs.some((s) => s.id === d.subId)) return 'این زیرمجموعه دیگر وجود ندارد.';
    return null;
  }
  if (d.kind === 'newMain') {
    const err = validateName(d.name, catalog.map((m) => ({ id: m.id, name: m.name })));
    if (err === 'duplicate') return 'دسته‌ای با همین نام وجود دارد؛ «افزودن به دسته موجود» را انتخاب کنید.';
    if (err) return NAME_ERROR_TEXT[err];
    if (d.subName.trim()) {
      const subErr = validateName(d.subName, []);
      if (subErr) return NAME_ERROR_TEXT[subErr];
    }
    return null;
  }
  const main = catalog.find((m) => m.id === d.mainId);
  if (!main) return 'یک دستهٔ اصلی انتخاب کنید.';
  const err = validateName(d.name, main.subs.map((s) => ({ id: s.id, name: s.name })));
  if (err === 'duplicate') return 'این زیرمجموعه در این دسته وجود دارد؛ آن را از «افزودن به دسته موجود» انتخاب کنید.';
  return err ? NAME_ERROR_TEXT[err] : null;
}

/**
 * Commits a destination: creates the new category/subcategory (only now — never during a preview)
 * and returns the word placement. Idempotent: a retry finds the categories created before.
 */
export function applyDestination(d: Destination, store: CategoryStore, builtInKeys: ReadonlySet<string>): { ok: true; placement: Placement; mainId: string | null } | { ok: false; error: string } {
  if (d.kind === 'none') return { ok: true, placement: null, mainId: null };
  if (d.kind === 'existing') return { ok: true, placement: placementOf(d.mainId, d.subId), mainId: d.mainId };
  if (d.kind === 'newMain') {
    const main = store.ensure(d.name, null, builtInKeys);
    if (!main.ok) return { ok: false, error: main.error in NAME_ERROR_TEXT ? NAME_ERROR_TEXT[main.error as keyof typeof NAME_ERROR_TEXT] : 'ساخت دسته ناموفق بود.' };
    if (!d.subName.trim()) return { ok: true, placement: placementOf(main.category.id, null), mainId: main.category.id };
    const sub = store.ensure(d.subName, main.category.id, builtInKeys);
    if (!sub.ok) return { ok: false, error: 'ساخت زیرمجموعه ناموفق بود.' };
    return { ok: true, placement: placementOf(main.category.id, sub.category.id), mainId: main.category.id };
  }
  const sub = store.ensure(d.name, d.mainId, builtInKeys);
  if (!sub.ok) return { ok: false, error: sub.error === 'invalid-parent' ? 'زیرمجموعه فقط در یک دستهٔ اصلی ساخته می‌شود.' : 'ساخت زیرمجموعه ناموفق بود.' };
  return { ok: true, placement: placementOf(d.mainId, sub.category.id), mainId: d.mainId };
}

// ── Browsing (category tabs) ───────────────────────────────────────────────────────────────────

export const DIRECT_LABEL = 'Meine Wörter';
/** Group label of personal words inside a built-in subcategory table. */
export const PERSONAL_GROUP_LABEL = 'Meine Wörter · واژه‌های من';
const byCreated = (a: PersonalWord, b: PersonalWord) => a.createdAt - b.createdAt;
const entries = (ws: PersonalWord[]): VocabularyEntry[] => ws.sort(byCreated).map(toEntry);

/**
 * The category list of the words page: built-in categories with the user's words and own
 * subcategories added as tabs, then the user's own main categories. Built-in content objects are
 * never modified (new objects are returned).
 */
export function browseCategories(builtIn: readonly Category[], user: readonly UserCategory[], words: readonly PersonalWord[]): Category[] {
  const placed = new Map<string, PersonalWord[]>(); // "main|sub" → words
  for (const w of words) {
    if (!w.placement) continue;
    const k = `${w.placement.category}|${w.placement.subtab}`;
    (placed.get(k) ?? placed.set(k, []).get(k)!).push(w);
  }
  const take = (main: string, sub: string) => placed.get(`${main}|${sub}`) ?? [];
  const userSubtabs = (parent: string): Subtab[] => user.filter((c) => c.parentId === parent).map((c) => ({
    id: c.id, icon: '', label: c.name, fa: '', groups: take(parent, c.id).length ? [{ label: c.name, entries: entries(take(parent, c.id)) }] : [],
  }));
  const direct = (main: string, always: boolean): Subtab[] => {
    const ws = take(main, DIRECT_SUBTAB);
    return ws.length || always ? [{ id: DIRECT_SUBTAB, icon: '', label: DIRECT_LABEL, fa: 'بدون زیرمجموعه', groups: ws.length ? [{ label: DIRECT_LABEL, entries: entries(ws) }] : [] }] : [];
  };

  const builtInList = builtIn.map((c): Category => {
    const own = userSubtabs(c.key);
    const directTab = direct(c.key, false);
    const subtabs = c.subtabs.map((s) => {
      const mine = take(c.key, s.id);
      return mine.length ? { ...s, groups: [...s.groups, { label: PERSONAL_GROUP_LABEL, entries: entries(mine) }] } : s;
    });
    return own.length || directTab.length || subtabs.some((s, i) => s !== c.subtabs[i]) ? { ...c, subtabs: [...subtabs, ...own, ...directTab] } : c;
  });
  const userMains = user.filter((c) => c.parentId === null).map((c): Category => {
    const subs = userSubtabs(c.id);
    return { key: c.id as Category['key'], label: c.name, theme: 'mine', subtabs: [...subs, ...direct(c.id, subs.length === 0)] };
  });
  return [...builtInList, ...userMains];
}

/** Personal words per category (management view). */
export function countWords(words: readonly PersonalWord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of words) {
    if (!w.placement) continue;
    counts.set(w.placement.category, (counts.get(w.placement.category) ?? 0) + 1);
    if (w.placement.subtab !== DIRECT_SUBTAB) counts.set(`${w.placement.category}|${w.placement.subtab}`, (counts.get(`${w.placement.category}|${w.placement.subtab}`) ?? 0) + 1);
  }
  return counts;
}

export const isUserMain = (id: string) => isCategoryId(id);
