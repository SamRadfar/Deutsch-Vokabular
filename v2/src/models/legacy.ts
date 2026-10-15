/**
 * Types of the legacy single-file app's persisted data (docs/DATA_CONTRACTS.md).
 * Used only for read-only migration preparation; v2 never writes these formats.
 */
import type { CategoryKey, WordId } from './vocabulary';

/** `mainKey + '::' + word` — the legacy progress identity. Not unique (5 collisions). */
export type LegacyProgressKey = string;

/** Raw legacy `DATA` row: [word, type, fa, example, exampleFa, pronunciationFa]. */
export type LegacyRow = [string, string, string, string, string, string];

export interface LegacyData {
  [mainKey: string]: {
    label: string;
    theme: string;
    tabs: Array<{
      id: string;
      icon: string;
      label: string;
      fa: string;
      groups: Array<{ label: string; rows: LegacyRow[] }>;
    }>;
  };
}

export interface LegacyTechnicalInfo {
  [word: string]: {
    formula: { lbl: string; val: string } | null;
    kv: Array<{ key: string; val: string; cls: string }>;
  };
}

export interface IdRegistryEntry {
  id: WordId;
  legacyKey: LegacyProgressKey;
  legacyWord: string;
  baselineIndex: number;
  baselineLocation: { category: CategoryKey; subtab: string; group: number; row: number };
}

export interface IdRegistry {
  schemaVersion: 1;
  description: string;
  algorithm: string;
  mintedFrom: { legacyCommit: string; legacyDataSha256: string };
  entries: IdRegistryEntry[];
}

export interface Dvok5IndexMap {
  checkboxCount: number;
  dataSha256: string;
  commits: string[];
  /** keys[i] = legacy progress key of the i-th built-in checkbox in that version. */
  keys: LegacyProgressKey[];
}

/** Legacy custom word (`dvok5_custom` element). */
export interface LegacyCustomWord {
  id: string;
  main: string;
  tab: string;
  word: string;
  sentence: string;
  type: string;
  fa: string;
  ex: string;
  exFa: string;
  pr: string;
  status: 'pending' | 'ready';
  checked: boolean;
}

export interface LegacyPronSettings {
  repeat: 'once' | 'twice' | 'twotwo';
  pause: number;
  rate: number;
  shadow: boolean;
}

/** Raw string values read from localStorage (null = key absent). Never contains the API key value. */
export interface LegacyStorageSnapshot {
  dvok6: string | null;
  dvok5: string | null;
  dvok5_custom: string | null;
  dvok5_pron_settings: string | null;
  dvok5_pron_exposure: string | null;
  dvok5_pron_selected_tabs: string | null;
  dvok_sync_code: string | null;
  dvok_theme: string | null;
  /** Only whether the key exists — the value is deliberately never read into v2. */
  dvok5_apikey_present: boolean;
}
