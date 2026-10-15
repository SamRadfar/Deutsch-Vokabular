import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import './Dialog.css';

interface Props {
  title: string;
  onClose(): void;
  children: ReactNode;
  /** Prevent closing (e.g. while an import is running). */
  busy?: boolean;
}

/** Accessible modal dialog: labelled, Escape closes, focus moves in and is restored on close, Tab is trapped. */
export function Dialog({ title, onClose, children, busy = false }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (first ?? ref.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); }
    if (e.key !== 'Tab' || !ref.current) return;
    const focusable = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const firstEl = focusable[0]!;
    const lastEl = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown} lang="fa" dir="rtl">
        <h2 id={titleId} className="dialog__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
