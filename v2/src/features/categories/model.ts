// Account-owned categories (users/{uid}/categories/{id}): a two-level hierarchy next to the built-in
// library categories.
//
//   main category      parentId = null
//   subcategory        parentId = a user main category ("uc_…") OR a built-in category key ("arch")
//
// Words refer to categories by STABLE ids through their existing `placement` field (which the
// deployed customWords rules already allow):
//
//   placement.category = built-in key ("arch")  | user main id ("uc_…")
//   placement.subtab   = built-in subtab id      | user subcategory id ("uc_…") | "_" (directly in the main)
//
// Built-in categories are never written: a user subcategory below a built-in category is a user
// document whose parentId is the built-in key.

import { cleanText } from '../personal/model';

export const CATEGORY_ID_PATTERN = /^uc_[0-9a-f]{20}$/;
export const isCategoryId = (id: string) => CATEGORY_ID_PATTERN.test(id);
/** Built-in category keys (library): lowercase letters, never "uc_…". */
export const BUILTIN_KEY_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
/** placement.subtab of a word that belongs directly to a main category. */
export const DIRECT_SUBTAB = '_';
export const CATEGORY_NAME_MAX = 60;

export interface UserCategory {
  id: string;
  name: string;
  /** null = main category; otherwise a user main id or a built-in category key. */
  parentId: string | null;
  sort: number;
  createdAt: number;
  updatedAt: number;
}

/** What is synchronised for one category (the document id is the category id). */
export interface CategoryValue {
  name: string;
  parentId: string | null;
  sort: number;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export const CATEGORY_SCHEMA_VERSION = 1;

export function newCategoryId(random: (b: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(new ArrayBuffer(10)));
  return `uc_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Deterministic id (legacy migration: two devices create the SAME category, never two). */
export async function stableCategoryId(seed: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`dv2-category:${seed}`)));
  return `uc_${[...hash.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function cleanCategoryName(name: string): string {
  return cleanText(name).slice(0, CATEGORY_NAME_MAX).trim();
}

/** Duplicate key: case, whitespace and German folding (ß/ss, umlauts) ignored. */
export function nameKey(name: string): string {
  return cleanText(name).toLocaleLowerCase('de').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/\s+/g, ' ');
}

export type NameError = 'empty' | 'too-long' | 'duplicate' | 'reserved';

export function validateName(name: string, siblings: readonly { id: string; name: string }[], exceptId?: string): NameError | null {
  const clean = cleanText(name);
  if (!clean) return 'empty';
  if (clean.length > CATEGORY_NAME_MAX) return 'too-long';
  if (clean === DIRECT_SUBTAB) return 'reserved';
  const key = nameKey(clean);
  if (siblings.some((s) => s.id !== exceptId && nameKey(s.name) === key)) return 'duplicate';
  return null;
}

export const NAME_ERROR_TEXT: Record<NameError, string> = {
  empty: 'نام دسته را بنویسید.',
  'too-long': `نام دسته حداکثر ${CATEGORY_NAME_MAX} نویسه است.`,
  duplicate: 'دسته‌ای با همین نام اینجا وجود دارد.',
  reserved: 'این نام مجاز نیست.',
};

const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
const ms = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e13;

/** Mirrors validCategory() in firestore.rules (guard for local and remote data). */
export function isCategoryValue(v: unknown): v is CategoryValue {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as Record<string, unknown>;
  return str(x.name, CATEGORY_NAME_MAX)
    && (x.parentId === null || (typeof x.parentId === 'string' && (CATEGORY_ID_PATTERN.test(x.parentId) || BUILTIN_KEY_PATTERN.test(x.parentId))))
    && typeof x.sort === 'number' && Number.isInteger(x.sort) && x.sort >= 0 && x.sort <= 1_000_000
    && typeof x.deleted === 'boolean' && ms(x.createdAt) && ms(x.updatedAt);
}

export function toCategory(id: string, v: CategoryValue): UserCategory {
  return { id, name: v.name, parentId: v.parentId, sort: v.sort, createdAt: v.createdAt, updatedAt: v.updatedAt };
}
