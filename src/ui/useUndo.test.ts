import { describe, expect, it, vi } from 'vitest';
import { createUndoController } from './useUndo';

describe('useUndo controller', () => {
  it('undo within ttl calls revert once', () => {
    let now = 1000;
    const c = createUndoController({ now: () => now, ttl: 8000 });
    const apply = vi.fn();
    const revert = vi.fn();
    c.do('del', apply, revert);
    expect(apply).toHaveBeenCalledTimes(1);
    now += 1000;
    expect(c.undo()).toBe(true);
    expect(revert).toHaveBeenCalledTimes(1);
    expect(c.undo()).toBe(false);
  });

  it('expired entry cannot be undone', () => {
    let now = 0;
    const c = createUndoController({ now: () => now, ttl: 8000 });
    const revert = vi.fn();
    c.do('del', () => {}, revert);
    now += 8001;
    expect(c.undo()).toBe(false);
    expect(revert).not.toHaveBeenCalled();
  });

  it('new do() commits the previous entry (only latest is revertable)', () => {
    let now = 0;
    const c = createUndoController({ now: () => now, ttl: 8000 });
    const revertA = vi.fn();
    const revertB = vi.fn();
    c.do('a', () => {}, revertA);
    now += 100;
    c.do('b', () => {}, revertB);
    expect(c.undo()).toBe(true);
    expect(revertB).toHaveBeenCalledTimes(1);
    expect(revertA).not.toHaveBeenCalled();
    expect(c.undo()).toBe(false);
  });
});
