import './Sidebar.css';
import type { ReactNode } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

interface Props {
  collapsed: boolean;
  onToggleCollapsed(): void;
  /** Grouped primary navigation. */
  nav: ReactNode;
  /** Learned-progress card. */
  meter: ReactNode;
  /** Sync status, environment badge. */
  status: ReactNode;
  /** Theme toggle (row variant). */
  theme: ReactNode;
  /** Account control (profile row / sign-in). */
  account: ReactNode;
}

/**
 * Desktop navigation (≥ 1024px): brand, grouped sections, progress, status and account. It sits on
 * the right (Persian RTL) and collapses to an icon rail; collapsed items show their name as a
 * tooltip and keep it as their accessible name.
 */
export function Sidebar({ collapsed, onToggleCollapsed, nav, meter, status, theme, account }: Props) {
  const toggleLabel = collapsed ? 'باز کردن نوار کناری' : 'جمع کردن نوار کناری';
  const ToggleIcon = collapsed ? PanelRightOpen : PanelRightClose;
  return (
    <aside className={`sb${collapsed ? ' is-collapsed has-tooltips' : ''}`} aria-label="نوار کناری" lang="fa" dir="rtl" data-testid="sidebar">
      <div className="sb__brand">
        <img className="sb__logo" src={`${import.meta.env.BASE_URL}brand-icon.jpg`} alt="" width={40} height={40} />
        <div className="sb__brand-text">
          <h1 className="sb__title" lang="de" dir="ltr">Deutsch Vokabular</h1>
          <p className="sb__sub">واژه‌نامهٔ تخصصی · B2/C1</p>
        </div>
      </div>
      <div className="sb__scroll">
        {nav}
      </div>
      <div className="sb__foot">
        <div className="sb__meter">{meter}</div>
        <div className="sb__status">{status}</div>
        {theme}
        <button type="button" className="sb-row" onClick={onToggleCollapsed} aria-label={toggleLabel} aria-expanded={!collapsed}
          data-testid="sidebar-toggle">
          <ToggleIcon />
          <span className="sb-row__label" aria-hidden="true">{collapsed ? 'باز کردن' : 'جمع کردن نوار کناری'}</span>
          <span className="tip" aria-hidden="true">{toggleLabel}</span>
        </button>
        <div className="sb__account">{account}</div>
      </div>
    </aside>
  );
}
