// Shadowing settings and session choice, remembered on this device (dv2.pref.shadowing.v1).
// Values read back from storage are sanitised: anything out of range falls back to the default.

import { CATEGORY_KEYS } from '../../models/vocabulary';
import { PERSONAL_KEY, type PracticeCategoryKey, type ReviewMode } from '../review/deck';

const PRACTICE_KEYS: readonly PracticeCategoryKey[] = [...CATEGORY_KEYS, PERSONAL_KEY];

export interface ShadowingSettings {
  /** How often the German word is played; each play is followed by a pause to repeat it. */
  wordRepeats: number;
  /** How often the example sentence is played (0 = words only). */
  exampleRepeats: number;
  /** Pause for the learner after each play, in seconds (legacy range 1–8). */
  pauseSec: number;
  /** Speech rate passed to the browser (it may clamp or ignore it). */
  rate: number;
  showTranslation: boolean;
}

export interface ShadowingChoice {
  mode: ReviewMode;
  /** Selected categories; empty = none selected (start disabled). */
  categories: PracticeCategoryKey[];
  /** Items per session. */
  size: number;
}

export interface ShadowingPreferences extends ShadowingSettings, ShadowingChoice {}

export const WORD_REPEATS = [1, 2, 3, 4] as const;
export const EXAMPLE_REPEATS = [0, 1, 2, 3] as const;
export const PAUSE_RANGE = { min: 1, max: 8, step: 0.5 } as const;
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
  exampleRepeats: 1,
  pauseSec: 4,
  rate: 0.85,
  showTranslation: true,
  mode: 'all',
  categories: [...PRACTICE_KEYS],
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
    ? [...new Set(v.categories.filter((k): k is PracticeCategoryKey => (PRACTICE_KEYS as readonly unknown[]).includes(k)))]
    : d.categories;
  return {
    wordRepeats: oneOf(WORD_REPEATS, v.wordRepeats, d.wordRepeats),
    exampleRepeats: oneOf(EXAMPLE_REPEATS, v.exampleRepeats, d.exampleRepeats),
    pauseSec: pause,
    rate: oneOf(RATES.map((r) => r.value), v.rate, d.rate),
    showTranslation: typeof v.showTranslation === 'boolean' ? v.showTranslation : d.showTranslation,
    mode: oneOf(['all', 'unlearned', 'learned', 'again'] as const, v.mode, d.mode),
    categories,
    size: oneOf(SHADOWING_SIZES, v.size, d.size),
  };
}
