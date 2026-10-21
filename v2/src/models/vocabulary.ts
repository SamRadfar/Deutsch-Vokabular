/**
 * Built-in vocabulary content model (schema version 1).
 *
 * Content is versioned, read-only data shipped with the app. It is converted 1:1
 * from the legacy `DATA` object (index.html @ 6763003). Text is never corrected
 * during conversion; see docs/DATA_QUALITY.md for known issues.
 */

export const CATEGORY_KEYS = ['arch', 'acad', 'bautechnik', 'bauphysik', 'fitness', 'anatomie', 'dreame'] as const;
/** The library's built-in categories. */
export type BuiltInCategoryKey = (typeof CATEGORY_KEYS)[number];
/** A category of the words page: built-in, or one of the account's own main categories ("uc_…", features/categories). */
export type CategoryKey = BuiltInCategoryKey | `uc_${string}`;

/** Legacy word-type codes. `x` has no legacy badge (DQ-2) but is preserved as-is. */
export const WORD_TYPES = ['n', 'v', 'a', 'au', 'x'] as const;
export type WordType = (typeof WORD_TYPES)[number];

/**
 * Permanent, opaque identifier of a built-in vocabulary entry: `dv_` + 10 lowercase hex.
 * Minted once (see id-registry.v1.json) and stored with the entry. Never derived from
 * position or spelling at runtime.
 */
export type WordId = string;
export const WORD_ID_PATTERN = /^dv_[0-9a-f]{10}$/;

export interface VocabularyEntry {
  id: WordId;
  /** German word, including its article for nouns ("die Außenwand"). */
  word: string;
  type: WordType;
  /** Persian meaning. */
  fa: string;
  /** German example sentence. */
  example: string;
  /** Persian translation of the example. */
  exampleFa: string;
  /** Pronunciation written in Persian script. */
  pronunciationFa: string;
}

export interface VocabularyGroup {
  label: string;
  entries: VocabularyEntry[];
}

export interface Subtab {
  id: string;
  icon: string;
  label: string;
  /** Persian subtitle; may be empty (all Bauphysik subtabs, DQ-4). */
  fa: string;
  groups: VocabularyGroup[];
}

export interface Category {
  key: CategoryKey;
  label: string;
  /** Accent theme name (equals the key in the legacy data). */
  theme: string;
  subtabs: Subtab[];
}

export interface VocabularyDataset {
  schemaVersion: 1;
  contentVersion: string;
  source: { legacyCommit: string; legacyDataSha256: string };
  categories: Category[];
}

export type TechnicalValueKind = 'symbol' | 'persian' | 'plain';

export interface TechnicalInfo {
  /** Key of the legacy BAUTECHNIK_INFO entry (the word it was written for). */
  legacyWord: string;
  /**
   * Entries that display this info. Resolved once from the legacy rule (word match inside
   * the `bautechnik` category). Empty for the 14 entries the legacy app never displays.
   */
  entryIds: WordId[];
  formula: { label: string; value: string } | null;
  rows: Array<{ key: string; value: string; kind: TechnicalValueKind }>;
}

export interface TechnicalInfoDataset {
  schemaVersion: 1;
  entries: TechnicalInfo[];
}

/**
 * Category name for display: the content labels start with a decorative emoji ("🏛 Architecture"),
 * which the UI replaces with a line icon. The content itself (and its legacy fixture) is unchanged.
 */
export function categoryName(label: string): string {
  return label.replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}\u{200D}\u{20E3}\s]+/u, '').trim() || label;
}
