import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * How an open layer closes: a press outside it and Esc. One implementation
 * for menus (`useMenu`) and anchored popups (`usePopover`); before 2026-11
 * popups did it by hand and differently — some never closed on an outside
 * click, none gave the focus back after Esc.
 *
 * - The press is caught in the capture phase: a child that stops
 *   propagation cannot keep a layer open.
 * - Esc is skipped when an inner handler already used it (defaultPrevented)
 *   or during IME composition; otherwise it is used up (preventDefault), so
 *   section-level Esc handlers that check defaultPrevented stay idle.
 */
export function bindDismiss(
  doc: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  inside: (target: EventTarget) => boolean,
  on: { outside: () => void; escape: () => void },
): () => void {
  const press = (e: Event) => {
    if (e.target && !inside(e.target)) on.outside();
  };
  const key = (e: Event) => {
    if (!('key' in e) || e.key !== 'Escape' || e.defaultPrevented) return;
    if ('isComposing' in e && e.isComposing) return;
    e.preventDefault();
    on.escape();
  };
  doc.addEventListener('pointerdown', press, true);
  doc.addEventListener('keydown', key);
  return () => {
    doc.removeEventListener('pointerdown', press, true);
    doc.removeEventListener('keydown', key);
  };
}

const contains = (el: Element | null | undefined, t: EventTarget): boolean => !!el && t instanceof Node && el.contains(t);

/**
 * An anchored popup (not a menu): closes on a press outside it and its
 * trigger, and on Esc. Esc and `close()` give the focus back — to the
 * trigger, or through `returnFocus` (the link editor returns to the text) —
 * when the focus was inside the popup; a press outside leaves the focus
 * where the press put it. `trigger` counts as inside, so its own toggle
 * click is not seen as «outside».
 */
export function usePopover<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  opts: { trigger?: RefObject<HTMLElement | null>; returnFocus?: () => void } = {},
): { ref: RefObject<T | null>; close: () => void } {
  const ref = useRef<T | null>(null);
  const latest = useRef({ onClose, opts });
  useEffect(() => {
    latest.current = { onClose, opts };
  });

  const close = useCallback(() => {
    const { onClose: done, opts: o } = latest.current;
    const active = document.activeElement;
    const hadFocus = !!active && (active === document.body || contains(ref.current, active));
    done();
    if (!hadFocus) return;
    if (o.returnFocus) o.returnFocus();
    else o.trigger?.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    return bindDismiss(document, (t) => contains(ref.current, t) || contains(latest.current.opts.trigger?.current, t), {
      outside: () => latest.current.onClose(),
      escape: close,
    });
  }, [open, close]);

  return { ref, close };
}
