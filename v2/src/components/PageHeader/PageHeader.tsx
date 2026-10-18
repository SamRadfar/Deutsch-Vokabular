import type { ReactNode } from 'react';

interface Props {
  /** Small context line above the title (rendered with a brand dot), e.g. ["واژه‌نامه", "B2 / C1"]. */
  eyebrow?: readonly string[];
  title: ReactNode;
  titleId?: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Phones/tablets: smaller title, no description. */
  compact?: boolean;
}

/** Large page title of a section (NEXORA "Good morning" header): eyebrow, title, description, actions. */
export function PageHeader({ eyebrow, title, titleId, description, actions, compact = false }: Props) {
  return (
    <div className={`page-head${compact ? ' page-head--compact' : ''}`} lang="fa" dir="rtl">
      <div className="page-head__text">
        {eyebrow?.length ? <p className="page-head__eyebrow">{eyebrow.map((e) => <span key={e}>{e}</span>)}</p> : null}
        <h2 className="page-head__title" {...(titleId ? { id: titleId } : {})}>{title}</h2>
        {description && !compact ? <p className="page-head__sub">{description}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </div>
  );
}
