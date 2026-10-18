// What is synchronised for one personal word (users/{uid}/customWords/{id}). The document id is
// the word id; `deleted: true` is a tombstone (documents are never removed — see firestore.rules).

import { WORD_TYPES } from '../../models/vocabulary';
import { ARTICLES, LIMITS, PERSONAL_ID_PATTERN, type PersonalWord } from './model';

export type CustomWordValue = Omit<PersonalWord, 'schemaVersion' | 'id'> & { deleted: boolean };

export const CUSTOM_WORD_SCHEMA_VERSION = 1;

export const isCustomWordId = (id: string) => PERSONAL_ID_PATTERN.test(id);

const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const ms = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e13;

/** Mirrors validCustomWord() in v2/firestore.rules (client-side guard for local and remote data). */
export function isCustomWordValue(v: unknown): v is CustomWordValue {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as Record<string, unknown>;
  const placement = x.placement as Record<string, unknown> | null;
  return (x.article === null || (ARTICLES as readonly unknown[]).includes(x.article))
    && str(x.lemma, LIMITS.lemma) && (x.lemma as string).length > 0
    && (WORD_TYPES as readonly unknown[]).includes(x.type)
    && str(x.grammar, LIMITS.grammar) && str(x.fa, LIMITS.fa) && str(x.example, LIMITS.example)
    && str(x.exampleFa, LIMITS.exampleFa) && str(x.pronunciationFa, LIMITS.pronunciationFa)
    && (placement === null || (typeof placement === 'object' && Object.keys(placement).length === 2
      && str(placement.category, 40) && (placement.category as string).length > 0
      && str(placement.subtab, 60) && (placement.subtab as string).length > 0))
    && typeof x.learned === 'boolean' && typeof x.deleted === 'boolean'
    && (x.source === 'manual' || x.source === 'legacy-import')
    && (x.legacyId === null || (str(x.legacyId, 40) && (x.legacyId as string).length > 0))
    && ms(x.createdAt) && ms(x.updatedAt);
}

export function toValue(w: PersonalWord, deleted = false): CustomWordValue {
  const { schemaVersion: _s, id: _id, ...rest } = w;
  return { ...rest, deleted };
}

export function fromValue(id: string, v: CustomWordValue): PersonalWord {
  const { deleted: _d, ...rest } = v;
  return { schemaVersion: 1, id, ...rest };
}

/**
 * Deterministic id for an imported legacy word: two devices importing the same legacy data write
 * the SAME document instead of creating duplicates.
 */
export async function legacyImportId(legacyId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`dvok5_custom:${legacyId}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `pw_${[...hash.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
