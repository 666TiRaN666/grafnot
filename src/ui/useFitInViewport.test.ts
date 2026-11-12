import { describe, expect, it } from 'vitest';
import { fitOffset } from './useFitInViewport';

/** Visible area of a 390×844 phone whose tab bar starts at y = 770 (margins already applied). */
const PHONE = { left: 8, top: 8, right: 382, bottom: 762 };
const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

describe('fitOffset: how far a popup moves to stay visible', () => {
  it('leaves a popup that fits where it is', () => {
    expect(fitOffset(box(20, 100, 200, 100), PHONE)).toEqual({ dx: 0, dy: 0 });
  });
  it('moves left by the right overflow, up by the bottom overflow', () => {
    expect(fitOffset(box(211, 100, 330, 100), PHONE)).toEqual({ dx: -159, dy: 0 });
    expect(fitOffset(box(52, 734, 330, 102), PHONE)).toEqual({ dx: 0, dy: -74 });
  });
  it('a popup opened above the tab bar ends above it, not under it', () => {
    const { dy } = fitOffset(box(52, 734, 330, 102), PHONE);
    expect(734 + 102 + dy).toBeLessThanOrEqual(PHONE.bottom);
  });
  it('never goes past the top-left when it is larger than the area', () => {
    expect(fitOffset(box(0, 0, 500, 900), PHONE)).toEqual({ dx: 8, dy: 8 });
  });
});
