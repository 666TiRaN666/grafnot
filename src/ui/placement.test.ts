import { describe, expect, it } from 'vitest';
import { computePlacement } from './placement';

describe('computePlacement', () => {
  it('places below-left when it fits', () => {
    const r = computePlacement(
      { x: 100, y: 100, w: 80, h: 32 },
      { w: 200, h: 120 },
      { w: 1440, h: 900 },
    );
    expect(r.flippedY).toBe(false);
    expect(r.y).toBe(100 + 32 + 8);
    expect(r.x).toBe(100);
  });

  it('flips above when there is no space below', () => {
    const r = computePlacement(
      { x: 100, y: 800, w: 80, h: 32 },
      { w: 200, h: 120 },
      { w: 1440, h: 900 },
    );
    expect(r.flippedY).toBe(true);
    expect(r.y).toBe(800 - 120 - 8);
  });

  it('clamps to the viewport when the anchor is near the right edge', () => {
    const r = computePlacement(
      { x: 1350, y: 100, w: 80, h: 32 },
      { w: 200, h: 120 },
      { w: 1440, h: 900 },
    );
    expect(r.x + 200).toBeLessThanOrEqual(1440 - 8);
    expect(r.x).toBeGreaterThanOrEqual(8);
  });

  it('clamps to the viewport edge when the popover overflows on the right', () => {
    const r = computePlacement(
      { x: 100, y: 100, w: 40, h: 32 },
      { w: 1400, h: 100 },
      { w: 1440, h: 900 },
    );
    expect(r.x).toBe(8);
    expect(r.flippedX).toBe(true);
  });
});
