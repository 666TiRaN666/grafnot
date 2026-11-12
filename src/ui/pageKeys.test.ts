import { describe, expect, it } from 'vitest';
import { isInLayer, isTypingTarget, pageShortcutAllowed } from './pageKeys';
import type { KeyTarget } from './pageKeys';

/** A fake event target inside the given ancestors (selector parts it matches). */
function at(...ancestors: string[]): KeyTarget {
  return {
    closest: (sel: string) => (sel.split(',').map((s) => s.trim()).some((s) => ancestors.includes(s)) ? {} : null),
  };
}
const key = (target: KeyTarget, extra: { isComposing?: boolean; keyCode?: number } = {}) => ({ key: 'n', target, ...extra });

describe('page shortcut guard', () => {
  it('runs on the page itself: body, a list row, a toolbar button', () => {
    expect(pageShortcutAllowed(key(at()))).toBe(true);
    expect(pageShortcutAllowed(key(at('[role="toolbar"]')))).toBe(true);
    expect(pageShortcutAllowed(key(null))).toBe(true);
    // window/document targets have no closest()
    expect(pageShortcutAllowed(key({}))).toBe(true);
  });

  it('stays idle while typing: fields and the editor', () => {
    for (const t of ['input', 'textarea', 'select', '[contenteditable]']) {
      expect(isTypingTarget(at(t))).toBe(true);
      expect(pageShortcutAllowed(key(at(t)))).toBe(false);
    }
  });

  it('leaves the keys to an open layer that has the focus: menu, popup, dialog, listbox, modal', () => {
    for (const t of ['[role="menu"]', '[role="dialog"]', '[role="alertdialog"]', '[role="listbox"]', '.g-modal']) {
      expect(isInLayer(at(t))).toBe(true);
      expect(pageShortcutAllowed(key(at(t)))).toBe(false);
    }
    expect(isInLayer(at('[role="toolbar"]'))).toBe(false);
  });

  it('never fires during IME composition', () => {
    expect(pageShortcutAllowed(key(at(), { isComposing: true }))).toBe(false);
    expect(pageShortcutAllowed(key(at(), { keyCode: 229 }))).toBe(false);
  });
});
