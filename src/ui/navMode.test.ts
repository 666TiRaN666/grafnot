import { describe, expect, it } from 'vitest';
import { NAV_AUTO_MIN, navOpen, parseNavMode } from './navMode';

describe('navigation rail mode (W5)', () => {
  it('reads only explicit choices, anything else is auto', () => {
    expect(parseNavMode('open')).toBe('open');
    expect(parseNavMode('closed')).toBe('closed');
    for (const v of [null, undefined, '', '1', '0', 'auto', 'OPEN']) expect(parseNavMode(v)).toBe('auto');
  });
  it('auto is labelled in a wide window and collapsed in a narrow one', () => {
    expect(navOpen('auto', true)).toBe(true);
    expect(navOpen('auto', false)).toBe(false);
  });
  it('an explicit choice wins over the window width', () => {
    expect(navOpen('open', false)).toBe(true);
    expect(navOpen('closed', true)).toBe(false);
  });
  it('switches at 1200 px', () => {
    expect(NAV_AUTO_MIN).toBe(1200);
  });
});
