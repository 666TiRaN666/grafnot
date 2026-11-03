import { useLayoutEffect, useRef } from 'react';

const MARGIN = 8;

/** Keep an open popup (menu, list) inside the visible screen: after each
 * render it is shifted back by the overflow, never past the top-left. Works
 * for absolute and fixed popups alike (focus group: menus left the phone
 * screen on the left and the tablet screen at the bottom). */
export function useFitInViewport<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    el.style.translate = '';
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    let dx = 0;
    if (r.right > vw - MARGIN) dx = vw - MARGIN - r.right;
    if (r.left + dx < MARGIN) dx = MARGIN - r.left;
    let dy = 0;
    if (r.bottom > vh - MARGIN) dy = vh - MARGIN - r.bottom;
    if (r.top + dy < MARGIN) dy = MARGIN - r.top;
    if (dx || dy) el.style.translate = `${dx}px ${dy}px`;
  });
  return ref;
}
