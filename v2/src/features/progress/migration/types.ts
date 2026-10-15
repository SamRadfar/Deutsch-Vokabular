import type { LegacyCustomWord, LegacyPronSettings, LegacyProgressKey } from '../../../models/legacy';
import type { CategoryKey, WordId } from '../../../models/vocabulary';

export type LegacySource = 'dvok6' | 'dvok5';

export interface LearnedMark {
  id: WordId;
  sources: LegacySource[];
  /** Legacy keys that produced this mark. */
  legacyKeys: LegacyProgressKey[];
  /** True if a legacy key covered more than one entry (DQ-1 collision). */
  ambiguous: boolean;
}

export interface AmbiguousMapping {
  legacyKey: LegacyProgressKey;
  source: LegacySource;
  candidateIds: WordId[];
  /**
   * The legacy UI rendered every row sharing the key as ticked, so applying the mark to all
   * candidates reproduces what the user saw. It does not guess which row was intended; the
   * mapping is reported so the user can review it.
   */
  resolution: 'apply-to-all-candidates';
}

export interface OrphanedKey {
  legacyKey: LegacyProgressKey;
  source: LegacySource;
  /** Entries with the same word text in other categories. Reported only — never applied. */
  relocationCandidates: WordId[];
}

export type Dvok5Status =
  | { status: 'absent' }
  | { status: 'invalid'; reason: string }
  | { status: 'unrecognized'; entryCount: number; reason: string }
  | { status: 'no-checks'; checkboxCount: number }
  | { status: 'deferred-dvok6-has-checks'; checkboxCount: number; checkedCount: number; matchedCommits: string[] }
  | { status: 'imported'; checkboxCount: number; checkedCount: number; matchedCommits: string[] };

export interface PlannedCustomWord {
  legacy: LegacyCustomWord;
  /** null = the original category/subtab no longer exists → shown in an "Unsorted" bucket. */
  placement: { category: CategoryKey; subtab: string } | null;
}

export interface PronunciationSettings {
  repeat: LegacyPronSettings['repeat'];
  pauseSeconds: number;
  rate: number;
  shadowing: boolean;
}

export type IssueSeverity = 'info' | 'warning' | 'data-loss-risk';

export interface MigrationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  count?: number;
}

/** Complete, pure result of interpreting a legacy snapshot. Contains no API key. */
export interface MigrationPlan {
  schemaVersion: 1;
  contentVersion: string;
  learned: LearnedMark[];
  ambiguous: AmbiguousMapping[];
  orphans: OrphanedKey[];
  dvok5: Dvok5Status;
  customWords: PlannedCustomWord[];
  invalidCustomWordCount: number;
  pronunciation: PronunciationSettings | null;
  selectedCategories: { kept: CategoryKey[]; dropped: string[] } | null;
  /** Exposure counters keep their legacy semantics (keyed by word text). */
  exposureByText: Record<string, number>;
  theme: 'light' | 'dark' | null;
  syncCode: { present: boolean; valid: boolean };
  apiKey: { present: boolean; migrated: false };
  issues: MigrationIssue[];
}

/** Human-reviewable summary shown before any migration is executed. */
export interface MigrationPreview {
  learnedEntries: number;
  learnedFrom: Record<LegacySource, number>;
  ambiguousKeys: number;
  orphanedKeys: number;
  dvok5: Dvok5Status['status'];
  customWords: { total: number; unsorted: number; invalid: number; checked: number; pending: number };
  exposure: { words: number; matchingBuiltInEntries: number; withoutBuiltInEntry: number };
  apiKeyPresent: boolean;
  potentialDataLoss: MigrationIssue[];
  warnings: MigrationIssue[];
  info: MigrationIssue[];
  safeToMigrate: boolean;
}
