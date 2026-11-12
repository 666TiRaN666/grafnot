import { describe, expect, it } from 'vitest';
import { bindDismiss } from './dismiss';

/** A document stand-in: Node has EventTarget, not the DOM. */
function setup() {
  const doc = new EventTarget();
  const inside = new EventTarget();
  const outside = new EventTarget();
  const log: string[] = [];
  const off = bindDismiss(doc, (t) => t === inside, { outside: () => log.push('outside'), escape: () => log.push('escape') });
  const press = (target: EventTarget) => {
    const e = new Event('pointerdown');
    Object.defineProperty(e, 'target', { value: target });
    doc.dispatchEvent(e);
  };
  const key = (k: string, extra: { isComposing?: boolean; prevented?: boolean } = {}) => {
    const e = new Event('keydown', { cancelable: true });
    Object.defineProperty(e, 'key', { value: k });
    Object.defineProperty(e, 'isComposing', { value: !!extra.isComposing });
    if (extra.prevented) e.preventDefault();
    doc.dispatchEvent(e);
    return e;
  };
  return { log, off, press, key, inside, outside };
}

describe('bindDismiss: how an open menu or popup closes', () => {
  it('a press outside closes, a press inside (the layer or its trigger) does not', () => {
    const s = setup();
    s.press(s.inside);
    expect(s.log).toEqual([]);
    s.press(s.outside);
    expect(s.log).toEqual(['outside']);
  });

  it('Esc closes and is used up, so section handlers stay idle', () => {
    const s = setup();
    const e = s.key('Escape');
    expect(s.log).toEqual(['escape']);
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores Esc an inner handler already used, IME composition and other keys', () => {
    const s = setup();
    s.key('Escape', { prevented: true });
    s.key('Escape', { isComposing: true });
    s.key('Enter');
    expect(s.log).toEqual([]);
  });

  it('stops listening once the layer is gone', () => {
    const s = setup();
    s.off();
    s.press(s.outside);
    s.key('Escape');
    expect(s.log).toEqual([]);
  });
});
