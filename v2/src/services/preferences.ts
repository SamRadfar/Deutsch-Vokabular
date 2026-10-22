/**
 * Device-level UI preferences of v2. Uses its own versioned keys — legacy keys
 * (dvok_theme, …) are never read or written here.
 */
export const PREFERENCE_KEYS = {
  theme: 'dv2.pref.theme.v1',
  review: 'dv2.pref.review.v1',
  shadowing: 'dv2.pref.shadowing.v1',
  sidebar: 'dv2.pref.sidebar.v1',
  voice: 'dv2.pref.voice.v1',
} as const;

export type ThemePreference = 'light' | 'dark';

/** localStorage can throw (private mode, blocked storage); preferences are best-effort. */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readThemePreference(): ThemePreference | null {
  try {
    const v = safeStorage()?.getItem(PREFERENCE_KEYS.theme);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function writeThemePreference(theme: ThemePreference): void {
  try {
    safeStorage()?.setItem(PREFERENCE_KEYS.theme, theme);
  } catch {
    /* ignore: the theme still applies for this session */
  }
}

/** Flashcard setup remembered on this device (not personal progress; no account data). */
export interface ReviewPreferences {
  mode: 'all' | 'unlearned' | 'learned' | 'again';
  /** `all` or a category key (validated against the content by the caller). */
  scope: string;
  /** Cards per session; null = all selected words. */
  size: number | null;
  /** Speak the German word when a card is turned (legacy behaviour). */
  autoSpeak: boolean;
  /** Subcategory within `scope` (validated against the categories by the caller); null = all. */
  subtab?: string | null;
}

export function readReviewPreferences(): Partial<ReviewPreferences> {
  try {
    const raw = safeStorage()?.getItem(PREFERENCE_KEYS.review);
    if (!raw) return {};
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<ReviewPreferences> = {};
    if (v.mode === 'all' || v.mode === 'unlearned' || v.mode === 'learned' || v.mode === 'again') out.mode = v.mode;
    if (typeof v.scope === 'string' && v.scope.length <= 40) out.scope = v.scope;
    if (v.size === null || (typeof v.size === 'number' && Number.isInteger(v.size) && v.size > 0 && v.size <= 1000)) out.size = v.size;
    if (typeof v.autoSpeak === 'boolean') out.autoSpeak = v.autoSpeak;
    if (typeof v.subtab === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(v.subtab)) out.subtab = v.subtab;
    return out;
  } catch {
    return {};
  }
}

export function writeReviewPreferences(prefs: ReviewPreferences): void {
  try {
    safeStorage()?.setItem(PREFERENCE_KEYS.review, JSON.stringify(prefs));
  } catch {
    /* ignore: the choice still applies for this session */
  }
}

/** Raw JSON preference (the feature sanitises it); null when absent or unreadable. */
export function readJsonPreference(key: string): unknown {
  try {
    const raw = safeStorage()?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function writeJsonPreference(key: string, value: unknown): void {
  try {
    safeStorage()?.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore: the choice still applies for this session */
  }
}
