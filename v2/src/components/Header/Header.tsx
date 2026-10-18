import type { ReactNode } from 'react';
import './Header.css';

interface Props {
  /** Learned-progress pill. */
  meter: ReactNode;
  /** Theme toggle (icon variant). */
  theme: ReactNode;
  /** Sync status + account control. */
  account: ReactNode;
}

/** Compact app bar for phones and tablets (< 1024px); the desktop uses the sidebar instead. */
export function Header({ meter, theme, account }: Props) {
  return (
    <header className="appbar" lang="fa" dir="rtl">
      <div className="appbar__brand">
        <img className="appbar__logo" src={`${import.meta.env.BASE_URL}brand-icon.jpg`} alt="" width={34} height={34} />
        <h1 className="appbar__title" lang="de" dir="ltr">Deutsch Vokabular</h1>
      </div>
      <div className="appbar__actions">
        {meter}
        {theme}
        {account}
      </div>
    </header>
  );
}
