// Personal vocabulary (schema version 1). A user's own words, stored per account and kept
// strictly separate from the 999 built-in entries (which are never modified).
//
// Ids: `pw_` + 20 lowercase hex (80 random bits). Built-in ids are `dv_` + 10 hex, so the two
// can never collide, and every place that accepts "a word id" can tell them apart by prefix.

import { WORD_ID_PATTERN, WORD_TYPES, type VocabularyEntry, type WordType } from '../../models/vocabulary';

export const PERSONAL_ID_PATTERN = /^pw_[0-9a-f]{20}$/;
export const isPersonalId = (id: string) => PERSONAL_ID_PATTERN.test(id);
/** Any id a learner can practise: built-in (`dv_`) or personal (`pw_`). */
export const isPracticeWordId = (id: string) => WORD_ID_PATTERN.test(id) || PERSONAL_ID_PATTERN.test(id);

export function newPersonalId(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(new ArrayBuffer(10)));
  return `pw_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export const ARTICLES = ['der', 'die', 'das'] as const;
export type Article = (typeof ARTICLES)[number];

export interface PersonalWord {
  schemaVersion: 1;
  id: string;
  /** Article for nouns (null for other word types or when unknown). */
  article: Article | null;
  /** The German word or phrase without article. */
  lemma: string;
  type: WordType;
  /** Free grammatical notes, e.g. plural "die Wände" or "ging, gegangen". */
  grammar: string;
  /** Persian meaning (may be empty only for incomplete legacy imports). */
  fa: string;
  example: string;
  exampleFa: string;
  pronunciationFa: string;
  /** Optional place inside the built-in categories (legacy "main/tab"); also shown there. */
  placement: { category: string; subtab: string } | null;
  learned: boolean;
  createdAt: number;
  updatedAt: number;
  source: 'manual' | 'legacy-import';
  /** Legacy `dvok5_custom` id of an imported word (idempotent migration). */
  legacyId: string | null;
}

/** What the form edits. */
export interface PersonalWordInput {
  article: Article | null;
  lemma: string;
  type: WordType;
  grammar: string;
  fa: string;
  example: string;
  exampleFa: string;
  pronunciationFa: string;
  placement: { category: string; subtab: string } | null;
}

export const LIMITS = { lemma: 120, grammar: 200, fa: 200, example: 400, exampleFa: 400, pronunciationFa: 200 } as const;

/** German word as displayed and spoken, including its article (like the built-in entries). */
export const displayWord = (w: Pick<PersonalWord, 'article' | 'lemma'>) => (w.article ? `${w.article} ${w.lemma}` : w.lemma);

/** Trim, collapse whitespace and drop control characters. Text is stored raw and rendered as React text. */
export function cleanText(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
}

export type FieldErrors = Partial<Record<keyof PersonalWordInput, string>>;

export function normalizeInput(input: PersonalWordInput): PersonalWordInput {
  let article = input.article;
  let lemma = cleanText(input.lemma);
  // A noun typed with its article ("die Wand") and no article chosen: take the article from the text.
  const m = /^(der|die|das)\s+(.+)$/i.exec(lemma);
  if (m && !article && input.type === 'n') { article = m[1]!.toLowerCase() as Article; lemma = m[2]!; }
  return {
    article: input.type === 'n' ? article : null,
    lemma,
    type: input.type,
    grammar: cleanText(input.grammar),
    fa: cleanText(input.fa),
    example: cleanText(input.example),
    exampleFa: cleanText(input.exampleFa),
    pronunciationFa: cleanText(input.pronunciationFa),
    // Legacy own categories ("my:…", migrated by features/categories/migration.ts): never an empty subcategory.
    placement: input.placement && input.placement.category.startsWith('my:')
      ? { category: input.placement.category, subtab: cleanText(input.placement.subtab).slice(0, 60) || 'Allgemein' }
      : input.placement,
  };
}

/** Persian validation messages per field; empty object = valid. */
export function validateInput(input: PersonalWordInput, opts: { allowEmptyFa?: boolean } = {}): FieldErrors {
  const e: FieldErrors = {};
  if (!input.lemma) e.lemma = 'واژهٔ آلمانی را وارد کنید.';
  else if (!/\p{L}/u.test(input.lemma)) e.lemma = 'واژهٔ آلمانی باید دست‌کم یک حرف داشته باشد.';
  else if (/[؀-ۿ]/.test(input.lemma)) e.lemma = 'در این فیلد واژهٔ آلمانی را بنویسید (معنی فارسی در فیلد بعدی).';
  if (!input.fa && !opts.allowEmptyFa) e.fa = 'معنی فارسی را وارد کنید.';
  if (!(WORD_TYPES as readonly string[]).includes(input.type)) e.type = 'نوع واژه نامعتبر است.';
  for (const [field, max] of Object.entries(LIMITS) as Array<[keyof typeof LIMITS, number]>) {
    if (input[field].length > max) e[field] = `حداکثر ${max} نویسه.`;
  }
  return e;
}

export const isValidInput = (e: FieldErrors) => Object.keys(e).length === 0;

/** Built-in-compatible view of a personal word (search, flashcards, shadowing, tables). */
export function toEntry(w: PersonalWord): VocabularyEntry {
  return { id: w.id, word: displayWord(w), type: w.type, fa: w.fa, example: w.example, exampleFa: w.exampleFa, pronunciationFa: w.pronunciationFa };
}

/** Guards records read back from storage. */
export function isValidPersonalWord(r: unknown): r is PersonalWord {
  if (typeof r !== 'object' || r === null) return false;
  const x = r as Record<string, unknown>;
  const str = (k: string, max: number) => typeof x[k] === 'string' && (x[k] as string).length <= max;
  return x.schemaVersion === 1 && typeof x.id === 'string' && PERSONAL_ID_PATTERN.test(x.id)
    && (x.article === null || (ARTICLES as readonly unknown[]).includes(x.article))
    && str('lemma', LIMITS.lemma) && (x.lemma as string).length > 0
    && (WORD_TYPES as readonly unknown[]).includes(x.type)
    && str('grammar', LIMITS.grammar) && str('fa', LIMITS.fa) && str('example', LIMITS.example)
    && str('exampleFa', LIMITS.exampleFa) && str('pronunciationFa', LIMITS.pronunciationFa)
    && (x.placement === null || (typeof x.placement === 'object' && x.placement !== null
      && typeof (x.placement as Record<string, unknown>).category === 'string' && typeof (x.placement as Record<string, unknown>).subtab === 'string'))
    && typeof x.learned === 'boolean' && typeof x.createdAt === 'number' && typeof x.updatedAt === 'number'
    && (x.source === 'manual' || x.source === 'legacy-import')
    && (x.legacyId === null || typeof x.legacyId === 'string');
}
