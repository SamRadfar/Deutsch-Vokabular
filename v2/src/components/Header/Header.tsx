import type { ReactNode } from 'react';
import { ThemeToggle } from '../ThemeToggle/ThemeToggle';
import type { ThemePreference } from '../../services/preferences';
import './Header.css';

interface Props {
  totalEntries: number;
  theme: ThemePreference;
  onToggleTheme(): void;
  /** Main navigation, rendered inside the sticky header like the legacy app. */
  navigation: ReactNode;
}

export function Header({ totalEntries, theme, onToggleTheme, navigation }: Props) {
  return (
    <header className="hdr">
      <div className="hdr__top">
        <div className="brand">
          <img className="brand__icon" src={`${import.meta.env.BASE_URL}brand-icon.jpg`} alt="" width={42} height={42} />
          <div>
            <h1 className="brand__title">Deutsch Vokabular</h1>
            <p className="brand__sub" lang="fa" dir="rtl">واژه‌نامه تخصصی آلمانی — سطح B2/C1</p>
          </div>
        </div>
        <div className="hdr__actions">
          <span className="pill" lang="fa" dir="rtl" aria-label={`${totalEntries} واژه`}>{totalEntries} واژه</span>
          <span className="preview-badge" title="Development preview — not the production app">v2 preview</span>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      </div>
      {navigation}
    </header>
  );
}
