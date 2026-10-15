/**
 * Device-level UI preferences of v2. Uses its own versioned keys — legacy keys
 * (dvok_theme, …) are never read or written here.
 */
export const PREFERENCE_KEYS = {
  theme: 'dv2.pref.theme.v1',
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
