import { useRef } from 'react';
import type { PointerEvent } from 'react';

/** Pull past this distance (px) closes the sheet; less snaps it back. */
export const SHEET_CLOSE_PX = 80;

/** W7: drag a phone bottom sheet down by its grip to close it. The sheet
 * (nearest `[data-sheet]` ancestor) follows the pointer; the close button
 * stays the keyboard and screen-reader path. */
export function useSheetSwipe(onClose: () => void) {
  const drag = useRef<{ y: number; sheet: HTMLElement } | null>(null);
  const end = (e: PointerEvent<HTMLElement>, close: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    d.sheet.style.transform = '';
    if (close && e.clientY - d.y > SHEET_CLOSE_PX) onClose();
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      const sheet = e.currentTarget.closest<HTMLElement>('[data-sheet]');
      if (!sheet) return;
      drag.current = { y: e.clientY, sheet };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const dy = Math.max(0, e.clientY - d.y);
      d.sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, true),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, false),
  };
}
