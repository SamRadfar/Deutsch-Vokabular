// Shadowing settings and session choice, remembered on this device (dv2.pref.shadowing.v1).
// Values read back from storage are sanitised: anything out of range falls back to the default.

import { CATEGORY_KEYS } from '../../models/vocabulary';
import { SUB_ID_PATTERN } from '../categories/practiceSubs';
import { PERSONAL_KEY, type PracticeCategoryKey, type ReviewMode } from '../review/deck';

const PRACTICE_KEYS: readonly PracticeCategoryKey[] = [...CATEGORY_KEYS, PERSONAL_KEY];

export interface ShadowingSettings {
  /** German word cycles (1–10); each cycle: German word → Persian meaning(s) → learner pause. */
  wordRepeats: number;
  /** Persian meaning after EACH German word (0–5; 0 = no Persian meaning). */
  faMeaningRepeats: number;
  /** How often the German example sentence is played (0–10; 0 = skip examples). */
  exampleRepeats: number;
  /** Read the Persian example translation after all German example repetitions. */
  faExample: boolean;
  /** How often (0–5). */
  faExampleRepeats: number;
  /** Delay between a German part and the Persian part that follows it (seconds). */
  deFaDelaySec: number;
  /** Pause for the learner after each cycle / example, in seconds (0 = no pauses). */
  pauseSec: number;
  /** German speech rate passed to the speech engine. */
  rate: number;
  /** Persian speech rate (on-device voice). */
  faRate: number;
  showTranslation: boolean;
  /**
   * 'speech': the browser speaks each step live (instant; stops when the screen locks).
   * 'audio': the session is rendered on this device into one audio file first, which keeps playing
   * with the screen locked (lock-screen controls via Media Session).
   */
  playback: PlaybackMode;
}

export type PlaybackMode = 'speech' | 'audio';

export interface ShadowingChoice {
  mode: ReviewMode;
  /** Selected categories; empty = none selected (start disabled). One = the active main category. */
  categories: PracticeCategoryKey[];
  /** Subcategory of the single selected main category; null = all of its subcategories. */
  subcategory: string | null;
  /** Items per session. */
  size: number;
}

export interface ShadowingPreferences extends ShadowingSettings, ShadowingChoice {}

export const WORD_REPEATS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const FA_MEANING_REPEATS = [0, 1, 2, 3, 4, 5] as const;
export const EXAMPLE_REPEATS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const FA_EXAMPLE_REPEATS = [0, 1, 2, 3, 4, 5] as const;
export const DE_FA_DELAYS = [0, 0.5, 1, 2, 3] as const;
export const PAUSE_RANGE = { min: 0, max: 8, step: 0.5 } as const;
export const RATES = [
  { value: 0.55, label: 'آهسته' },
  { value: 0.7, label: 'کمی آهسته' },
  { value: 0.85, label: 'متوسط' },
  { value: 1, label: 'عادی' },
  { value: 1.2, label: 'تند' },
] as const;
export const SHADOWING_SIZES = [5, 10, 20, 30, 50] as const;

export const DEFAULT_PREFERENCES: ShadowingPreferences = {
  wordRepeats: 2,
  faMeaningRepeats: 0,
  exampleRepeats: 1,
  faExample: false,
  faExampleRepeats: 1,
  deFaDelaySec: 1,
  pauseSec: 4,
  rate: 0.85,
  faRate: 1,
  showTranslation: true,
  playback: 'speech',
  mode: 'all',
  categories: [...PRACTICE_KEYS],
  subcategory: null,
  size: 30,
};

const oneOf = <T>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

export function sanitizePreferences(raw: unknown): ShadowingPreferences {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFERENCES;
  const pause = typeof v.pauseSec === 'number' && Number.isFinite(v.pauseSec)
    && v.pauseSec >= PAUSE_RANGE.min && v.pauseSec <= PAUSE_RANGE.max
    ? Math.round(v.pauseSec / PAUSE_RANGE.step) * PAUSE_RANGE.step : d.pauseSec;
  const categories = Array.isArray(v.categories)
    ? [...new Set(v.categories.filter((k): k is PracticeCategoryKey => (PRACTICE_KEYS as readonly unknown[]).includes(k)
      || (typeof k === 'string' && /^uc_[0-9a-f]{20}$/.test(k))))]
    : d.categories;
  return {
    wordRepeats: oneOf(WORD_REPEATS, v.wordRepeats, d.wordRepeats),
    faMeaningRepeats: oneOf(FA_MEANING_REPEATS, v.faMeaningRepeats, d.faMeaningRepeats),
    exampleRepeats: oneOf(EXAMPLE_REPEATS, v.exampleRepeats, d.exampleRepeats),
    faExample: typeof v.faExample === 'boolean' ? v.faExample : d.faExample,
    faExampleRepeats: oneOf(FA_EXAMPLE_REPEATS, v.faExampleRepeats, d.faExampleRepeats),
    deFaDelaySec: oneOf(DE_FA_DELAYS, v.deFaDelaySec, d.deFaDelaySec),
    faRate: oneOf(RATES.map((r) => r.value), v.faRate, d.faRate),
    pauseSec: pause,
    rate: oneOf(RATES.map((r) => r.value), v.rate, d.rate),
    showTranslation: typeof v.showTranslation === 'boolean' ? v.showTranslation : d.showTranslation,
    playback: oneOf(['speech', 'audio'] as const, v.playback, d.playback),
    mode: oneOf(['all', 'unlearned', 'learned', 'again'] as const, v.mode, d.mode),
    categories,
    subcategory: typeof v.subcategory === 'string' && SUB_ID_PATTERN.test(v.subcategory) ? v.subcategory : null,
    size: oneOf(SHADOWING_SIZES, v.size, d.size),
  };
}
