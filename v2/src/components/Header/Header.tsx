import type { ReactNode } from 'react';
import { ThemeToggle } from '../ThemeToggle/ThemeToggle';
import type { ThemePreference } from '../../services/preferences';
import './Header.css';

interface Props {
  totalEntries: number;
  /** Learned count of the signed-in user; null when progress is not available. */
  learnedCount: number | null;
  theme: ThemePreference;
  onToggleTheme(): void;
  /** Sync status + account control. */
  account: ReactNode;
  /** Main navigation, rendered inside the sticky header like the legacy app. */
  navigation: ReactNode;
}

export function Header({ totalEntries, learnedCount, theme, onToggleTheme, account, navigation }: Props) {
  const pct = learnedCount !== null && totalEntries ? Math.round((learnedCount / totalEntries) * 100) : 0;
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
          {learnedCount !== null ? (
            <span className="pill pill--progress" lang="fa" dir="rtl" data-testid="header-progress"
              role="progressbar" aria-valuemin={0} aria-valuemax={totalEntries} aria-valuenow={learnedCount}
              aria-label={`${learnedCount} از ${totalEntries} واژه یادگرفته`}>
              <span>{learnedCount}/{totalEntries} واژه</span>
              <span className="pill__bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
            </span>
          ) : (
            <span className="pill" lang="fa" dir="rtl" aria-label={`${totalEntries} واژه`}>{totalEntries} واژه</span>
          )}
          <span className="preview-badge" title="Development preview — not the production app">v2 preview</span>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          {account}
        </div>
      </div>
      {navigation}
    </header>
  );
}
