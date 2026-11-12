/**
 * Where a page-level shortcut (`/`, `N`, week arrows, `T`, map Ctrl+A) may
 * run. Each section keeps its own keydown handler and its own keys; only the
 * rule «is this key for the page at all» lives here (2026-11: eight copies
 * of it disagreed, and none knew about open menus and popups — N in a note
 * menu created a note, arrows in the day popup moved the week under it).
 *
 * The rule follows the focus, not what is on screen: a pinned side panel
 * or an open task panel does not switch the page keys off; focus inside
 * one of them does.
 */

/** Typing happens here: a key is text, not a command. */
export const TYPING_SELECTOR = 'input, textarea, select, [contenteditable]';

/** An open layer owns its keys: menus, popups, dialogs, suggestion lists, the modal. */
export const LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .g-modal';

interface Closest {
  closest?: (selector: string) => unknown;
}

/** An event target, or anything with closest() (unit tests run without a DOM). */
export type KeyTarget = EventTarget | Closest | null;

const within = (target: KeyTarget, selector: string): boolean => {
  if (!target || !('closest' in target)) return false;
  const { closest } = target;
  return typeof closest === 'function' && !!closest.call(target, selector);
};

/** Focus is in a field or in the note text. */
export function isTypingTarget(target: KeyTarget): boolean {
  return within(target, TYPING_SELECTOR);
}

/** Focus is inside an open layer (menu, popup, dialog, listbox, modal). */
export function isInLayer(target: KeyTarget): boolean {
  return within(target, LAYER_SELECTOR);
}

/** A page shortcut may run: no IME composition, focus neither in a field nor in a layer.
 * Modifier keys are each shortcut's own business and stay in its handler. */
export function pageShortcutAllowed(e: { isComposing?: boolean; keyCode?: number; target: KeyTarget }): boolean {
  if (e.isComposing || e.keyCode === 229) return false;
  return !isTypingTarget(e.target) && !isInLayer(e.target);
}
