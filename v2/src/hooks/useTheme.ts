import { useCallback, useEffect, useState } from 'react';
import { readThemePreference, writeThemePreference, type ThemePreference } from '../services/preferences';
import { useMediaQuery } from './useMediaQuery';

const THEME_COLOR: Record<ThemePreference, string> = { light: '#f0f4fb', dark: '#12141c' };

/**
 * Light/dark theme. Without a stored preference the system setting is followed live;
 * toggling stores an explicit preference (dv2.pref.theme.v1).
 */
export function useTheme() {
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [preference, setPreference] = useState<ThemePreference | null>(() => readThemePreference());
  const theme: ThemePreference = preference ?? (systemDark ? 'dark' : 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  }, [theme]);

  const toggle = useCallback(() => {
    const next: ThemePreference = theme === 'dark' ? 'light' : 'dark';
    writeThemePreference(next);
    setPreference(next);
  }, [theme]);

  return { theme, isExplicit: preference !== null, toggle };
}
