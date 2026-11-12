import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

const ITEMS = ['menuitem', 'menuitemcheckbox', 'menuitemradio'].map((r) => `[role="${r}"]:not(:disabled)`).join(', ');

/**
 * One dropdown model for every menu of the app (note «⋯» and «Insert»,
 * prompt menus, map menus, task rows, profile). Before 2026-11 each menu
 * had its own handlers and several never closed on an outside click.
 *
 * - opening focuses the chosen radio item or the first one (WAI-ARIA menu button);
 * - a pointer down outside closes (capture phase: a child that stops
 *   propagation cannot keep a menu open), so does focus leaving by Tab;
 * - Esc closes and returns focus to the button;
 * - choosing a plain item closes; checkbox/radio items keep the menu open;
 * - arrows, Home and End move between items; ArrowDown on the button opens.
 *
 * `rootRef` wraps the button and the popup; `triggerRef` is the button
 * (pass it as `ref` next to `{...triggerProps}`).
 */
export function useMenu<R extends HTMLElement = HTMLElement>(options?: {
  /** 'none': the popup focuses its own field (a search box) on open. */
  focus?: 'item' | 'none';
}) {
  const focusItem = options?.focus !== 'none';
  const [open, setOpen] = useState(false);
  const root = useRef<R | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  /** Close; focus returns to the button only if it was still in the menu
   * (an action that moved focus elsewhere — the text, a field — keeps it). */
  const close = useCallback(() => {
    const keep = !!root.current && root.current.contains(document.activeElement);
    setOpen(false);
    if (keep) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const r = root.current;
    if (focusItem) (r?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not(:disabled)') ?? r?.querySelector<HTMLElement>(ITEMS))?.focus();
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && r && !r.contains(e.target)) setOpen(false);
    };
    const leave = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && r && !r.contains(e.relatedTarget)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc);
    r?.addEventListener('focusout', leave);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc);
      r?.removeEventListener('focusout', leave);
    };
  }, [open, focusItem]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  const triggerProps = {
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    onClick: toggle,
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
        e.preventDefault();
        setOpen(true);
      }
    },
  };

  const menuProps = {
    role: 'menu' as const,
    onKeyDown: (e: React.KeyboardEvent) => {
      const list = [...(root.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
      const at = list.indexOf(document.activeElement as HTMLElement);
      const go = (i: number) => {
        e.preventDefault();
        list[(i + list.length) % list.length]?.focus();
      };
      if (e.key === 'Escape') {
        // Handled here so section-level Esc handlers (map, selection) stay idle.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      } else if (e.key === 'ArrowDown') go(at + 1);
      else if (e.key === 'ArrowUp') go(at < 0 ? list.length - 1 : at - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(list.length - 1);
    },
    onClick: (e: React.MouseEvent) => {
      // Item handlers run first (they are deeper); a plain item then closes.
      const item = (e.target as HTMLElement).closest?.('[role^="menuitem"]');
      if (item && item.getAttribute('role') === 'menuitem' && !item.hasAttribute('disabled')) close();
    },
  };

  // Refs apart from the props objects: call sites destructure, so render never reads an object holding refs.
  return { open, setOpen, close, rootRef: root, triggerRef: trigger, triggerProps, menuProps };
}
