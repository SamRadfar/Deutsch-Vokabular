import { useCallback, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

export type SwipeDirection = 'left' | 'right';

/** Horizontal distance (px) that counts as a swipe; shorter drags snap back. */
export const SWIPE_THRESHOLD = 80;
const DRAG_START = 10;

/**
 * Pointer-based horizontal swipe (touch, pen and mouse). Vertical movement is left to the page
 * (CSS `touch-action: pan-y`), so scrolling still works on phones. A swipe may start anywhere on
 * the card, also on its 🔊 buttons: the click that ends a drag is swallowed (capture phase), so a
 * swipe never also flips the card or plays audio, while a plain tap on a button still works.
 */
export function useSwipe(onSwipe: (direction: SwipeDirection) => void, enabled = true) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);

  const reset = useCallback(() => {
    start.current = null;
    dragging.current = false;
    setOffset(0);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    suppressClick.current = false; // a drag that produced no click must not swallow this press
    if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as Element).closest('input, select, textarea')) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragging.current = false;
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!dragging.current) {
      if (Math.abs(dy) > DRAG_START && Math.abs(dy) > Math.abs(dx)) { start.current = null; return; } // vertical: scrolling
      if (Math.abs(dx) <= DRAG_START) return;
      dragging.current = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    }
    setOffset(dx);
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const wasDragging = dragging.current;
    reset();
    if (!wasDragging) return; // a tap: the click handler flips the card
    suppressClick.current = true;
    if (Math.abs(dx) >= SWIPE_THRESHOLD) onSwipe(dx > 0 ? 'right' : 'left');
  };

  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  return {
    offset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset, onClickCapture },
  };
}
