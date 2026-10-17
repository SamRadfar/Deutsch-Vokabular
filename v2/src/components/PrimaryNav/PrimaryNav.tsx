import './PrimaryNav.css';
import type { MouseEvent } from 'react';
import { SECTIONS, SECTION_META, sectionHref, type Section } from '../../app/sections';

interface Props {
  active: Section;
  onNavigate(section: Section): void;
  /** `top`: inside the desktop header. `bottom`: fixed tab bar on phones. */
  variant: 'top' | 'bottom';
}

/** Main sections as real links (hash URLs): keyboard, middle-click and screen readers work as usual. */
export function PrimaryNav({ active, onNavigate, variant }: Props) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>, s: Section) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // let the browser open new tabs
    e.preventDefault();
    onNavigate(s);
  };
  return (
    <nav className={`pnav pnav--${variant}`} aria-label="بخش‌های اصلی" lang="fa" dir="rtl">
      <ul className="pnav__list">
        {SECTIONS.map((s) => (
          <li key={s}>
            <a href={sectionHref(s)} className={`pnav__link${s === active ? ' is-active' : ''}`} aria-current={s === active ? 'page' : undefined}
              onClick={(e) => onClick(e, s)} data-testid={`nav-${s}`}>
              <span className="pnav__icon" aria-hidden="true">{SECTION_META[s].icon}</span>
              <span className="pnav__label">{SECTION_META[s].label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
