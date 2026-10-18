import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './Dialog.css';

interface Props {
  title: string;
  onClose(): void;
  children: ReactNode;
  /** Prevent closing (e.g. while an import is running). */
  busy?: boolean;
  /** `md` (default): messages and confirmations. `lg`: forms (two-column on desktop). */
  size?: 'md' | 'lg';
  /** Short line under the title. */
  description?: string;
}

/** Accessible modal dialog: labelled, Escape closes, focus moves in and is restored on close, Tab is trapped. */
export function Dialog({ title, onClose, children, busy = false, size = 'md', description }: Props) {
  const titleId = useId();
  const descId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('button:not(.dialog__close), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (first ?? ref.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); }
    if (e.key !== 'Tab' || !ref.current) return;
    const focusable = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const firstEl = focusable[0]!;
    const lastEl = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
  };

  // Portal: above the sidebar and the frame masks whatever stacking context the caller lives in.
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} className={`dialog dialog--${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}
        {...(description ? { 'aria-describedby': descId } : {})} tabIndex={-1} onKeyDown={onKeyDown} lang="fa" dir="rtl">
        <div className="dialog__head">
          <h2 id={titleId} className="dialog__title">{title}</h2>
          {description ? <p id={descId} className="dialog__desc">{description}</p> : null}
        </div>
        <div className="dialog__body">{children}</div>
        {/* Last in the DOM: initial focus goes to the content, the corner position is visual only. */}
        <button type="button" className="dialog__close icon-btn icon-btn--ghost" onClick={onClose} disabled={busy} aria-label="بستن پنجره">
          <X />
        </button>
      </div>
    </div>,
    document.body,
  );
}
