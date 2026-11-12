import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

const MARGIN = 8;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Shift that brings `r` inside `area`: by the right/bottom overflow, but
 * never past the top-left (a popup larger than the area starts at its corner). Pure. */
export function fitOffset(r: Box, area: Box): { dx: number; dy: number } {
  let dx = 0;
  if (r.right > area.right) dx = area.right - r.right;
  if (r.left + dx < area.left) dx = area.left - r.left;
  let dy = 0;
  if (r.bottom > area.bottom) dy = area.bottom - r.bottom;
  if (r.top + dy < area.top) dy = area.top - r.top;
  return { dx, dy };
}

/** The part of the screen a popup may use: the visual viewport minus the
 * fixed bars marked `data-viewport-edge="bottom"` (the phone tab bar; it is
 * hidden while the keyboard is open and then does not count). */
function visibleArea(): Box {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  let bottom = window.visualViewport?.height ?? window.innerHeight;
  for (const bar of document.querySelectorAll<HTMLElement>('[data-viewport-edge="bottom"]')) {
    if (bar.getClientRects().length > 0) bottom = Math.min(bottom, bar.getBoundingClientRect().top);
  }
  return { left: MARGIN, top: MARGIN, right: vw - MARGIN, bottom: bottom - MARGIN };
}

function fit(el: HTMLElement | null): void {
  if (!el) return;
  el.style.translate = '';
  const { dx, dy } = fitOffset(el.getBoundingClientRect(), visibleArea());
  if (dx || dy) el.style.translate = `${dx}px ${dy}px`;
}

/** Keep an open popup (menu, list) inside the visible screen: after each
 * render, and again when the screen changes size (the phone keyboard), it is
 * shifted back by the overflow. Works for absolute and fixed popups alike
 * (focus group: menus left the phone screen on the left and the tablet screen
 * at the bottom; 2026-11: «To note» on a phone went under the tab bar). Pass
 * `shared` when the element already has a ref (a popup's dismissal ref). */
export function useFitInViewport<T extends HTMLElement>(open: boolean, shared?: RefObject<T | null>) {
  const own = useRef<T>(null);
  const ref = shared ?? own;
  useLayoutEffect(() => {
    if (open) fit(ref.current);
  });
  useEffect(() => {
    if (!open) return;
    const again = () => fit(ref.current);
    const vv = window.visualViewport;
    window.addEventListener('resize', again);
    vv?.addEventListener('resize', again);
    return () => {
      window.removeEventListener('resize', again);
      vv?.removeEventListener('resize', again);
    };
  }, [open, ref]);
  return ref;
}
