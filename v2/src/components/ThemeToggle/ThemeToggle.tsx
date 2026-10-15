import type { ThemePreference } from '../../services/preferences';

export function ThemeToggle({ theme, onToggle }: { theme: ThemePreference; onToggle(): void }) {
  const label = theme === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تیره';
  return (
    <button type="button" className="icon-btn" onClick={onToggle} aria-label={label} title={label} data-testid="theme-toggle">
      <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
    </button>
  );
}
