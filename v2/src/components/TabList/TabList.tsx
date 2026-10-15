import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  content: ReactNode;
  /** Extra attributes for styling, e.g. the category accent. */
  dataCategory?: string;
}

interface Props {
  items: readonly TabItem[];
  selectedId: string;
  onSelect(id: string): void;
  label: string;
  /** Prefix used for tab and panel element ids (tab: `${idPrefix}-tab-${id}`, panel: `${idPrefix}-panel-${id}`). */
  idPrefix: string;
  className: string;
  tabClassName: string;
}

export const tabElementId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelElementId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/**
 * WAI-ARIA tabs with roving tabindex: ←/→ move between tabs (activating them), Home/End jump.
 * Arrow direction follows the visual order of this LTR navigation.
 */
export function TabList({ items, selectedId, onSelect, label, idPrefix, className, tabClassName }: Props) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const focusAt = (index: number) => {
    const item = items[(index + items.length) % items.length];
    if (!item) return;
    onSelect(item.id);
    const el = refs.current.get(item.id);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); focusAt(index + 1); break;
      case 'ArrowLeft': e.preventDefault(); focusAt(index - 1); break;
      case 'Home': e.preventDefault(); focusAt(0); break;
      case 'End': e.preventDefault(); focusAt(items.length - 1); break;
      default:
    }
  };

  return (
    <div role="tablist" aria-label={label} className={className}>
      {items.map((item, index) => {
        const selected = item.id === selectedId;
        return (
          <button
            key={item.id}
            ref={(el) => { if (el) refs.current.set(item.id, el); else refs.current.delete(item.id); }}
            type="button"
            role="tab"
            id={tabElementId(idPrefix, item.id)}
            aria-selected={selected}
            aria-controls={panelElementId(idPrefix, item.id)}
            tabIndex={selected ? 0 : -1}
            className={`${tabClassName}${selected ? ' is-active' : ''}`}
            data-category={item.dataCategory}
            onClick={(e) => { onSelect(item.id); e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {item.content}
          </button>
        );
      })}
    </div>
  );
}
