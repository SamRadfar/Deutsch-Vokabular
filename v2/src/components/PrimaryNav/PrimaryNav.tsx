import './PrimaryNav.css';
import type { MouseEvent } from 'react';
import { SECTIONS, SECTION_GROUPS, SECTION_META, sectionHref, type Section } from '../../app/sections';

interface Props {
  active: Section;
  onNavigate(section: Section): void;
  /** `sidebar`: grouped list in the desktop sidebar. `bottom`: fixed tab bar on phones and tablets. */
  variant: 'sidebar' | 'bottom';
  /** Optional counters shown next to a section (decorative; not part of the link name). */
  counts?: Partial<Record<Section, number>>;
}

/** Main sections as real links (hash URLs): keyboard, middle-click and screen readers work as usual. */
export function PrimaryNav({ active, onNavigate, variant, counts = {} }: Props) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>, s: Section) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // let the browser open new tabs
    e.preventDefault();
    onNavigate(s);
  };
  const link = (s: Section) => {
    const { icon: Icon, label } = SECTION_META[s];
    const n = counts[s];
    return (
      <li key={s}>
        <a href={sectionHref(s)} className={`pnav__link${s === active ? ' is-active' : ''}`} aria-current={s === active ? 'page' : undefined}
          onClick={(e) => onClick(e, s)} data-testid={`nav-${s}`}>
          <Icon className="pnav__icon" />
          <span className="pnav__label">{label}</span>
          {variant === 'sidebar' && n ? <span className="pnav__count" aria-hidden="true">{n.toLocaleString('fa-IR')}</span> : null}
          {variant === 'sidebar' ? <span className="tip" aria-hidden="true">{label}</span> : null}
        </a>
      </li>
    );
  };

  if (variant === 'bottom') {
    return (
      <nav className="pnav pnav--bottom" aria-label="بخش‌های اصلی" lang="fa" dir="rtl">
        <ul className="pnav__list">{SECTIONS.map(link)}</ul>
      </nav>
    );
  }
  return (
    <nav className="pnav pnav--sidebar" aria-label="بخش‌های اصلی" lang="fa" dir="rtl">
      {SECTION_GROUPS.map((g) => (
        <div key={g.id} className="pnav__group">
          <p className="pnav__heading" id={`pnav-${g.id}`}>{g.label}</p>
          <ul className="pnav__list" aria-labelledby={`pnav-${g.id}`}>{g.sections.map(link)}</ul>
        </div>
      ))}
    </nav>
  );
}
