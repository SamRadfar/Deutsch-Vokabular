import './ProgressMeter.css';

interface Props {
  totalEntries: number;
  /** Learned count of the signed-in user; null when progress is not available. */
  learnedCount: number | null;
  /** `card`: sidebar block with label and bar. `pill`: compact app-bar pill. */
  variant: 'card' | 'pill';
}

/** Learned words of the built-in vocabulary (or the vocabulary size while signed out). */
export function ProgressMeter({ totalEntries, learnedCount, variant }: Props) {
  if (learnedCount === null) {
    return (
      <span className={`pmeter pmeter--${variant} is-idle`} lang="fa" dir="rtl" aria-label={`${totalEntries} واژه`}>
        <span className="pmeter__nums"><bdi>{totalEntries}</bdi><span className="pmeter__unit"> واژه</span></span>
        {variant === 'card' ? <span className="pmeter__label">واژه‌نامهٔ تخصصی</span> : null}
      </span>
    );
  }
  const pct = totalEntries ? Math.round((learnedCount / totalEntries) * 100) : 0;
  return (
    <span className={`pmeter pmeter--${variant}`} lang="fa" dir="rtl" data-testid="header-progress"
      role="progressbar" aria-valuemin={0} aria-valuemax={totalEntries} aria-valuenow={learnedCount}
      aria-label={`${learnedCount} از ${totalEntries} واژه یادگرفته`}>
      {variant === 'card' ? <span className="pmeter__label">یادگرفته</span> : null}
      <span className="pmeter__nums"><bdi>{learnedCount}/{totalEntries}</bdi><span className="pmeter__unit"> واژه</span></span>
      <span className="pmeter__bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      {variant === 'card' ? <span className="pmeter__pct" aria-hidden="true">{pct}٪</span> : null}
    </span>
  );
}
