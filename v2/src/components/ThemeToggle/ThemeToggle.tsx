import { Moon, Sun } from 'lucide-react';
import type { ThemePreference } from '../../services/preferences';

interface Props {
  theme: ThemePreference;
  onToggle(): void;
  /** `icon`: square button (app bar). `row`: labelled row in the sidebar. */
  variant?: 'icon' | 'row';
}

export function ThemeToggle({ theme, onToggle, variant = 'icon' }: Props) {
  const label = theme === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تیره';
  const Icon = theme === 'dark' ? Sun : Moon;
  if (variant === 'row') {
    return (
      <button type="button" className="sb-row" onClick={onToggle} aria-label={label} data-testid="theme-toggle">
        <Icon />
        <span className="sb-row__label" aria-hidden="true">{theme === 'dark' ? 'حالت روشن' : 'حالت تیره'}</span>
        <span className="tip" aria-hidden="true">{label}</span>
      </button>
    );
  }
  return (
    <button type="button" className="icon-btn" onClick={onToggle} aria-label={label} title={label} data-testid="theme-toggle">
      <Icon />
    </button>
  );
}
