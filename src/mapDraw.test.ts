import { describe, expect, it } from 'vitest';
import { edgePath, LABEL_HIDE_K, mapLabel } from './mapDraw';

describe('mapLabel', () => {
  const long = 'Конспект лекции по взаимодействию человека и компьютера';
  it('shortens an idle label and shows the full name for the focused note', () => {
    expect(mapLabel(long, false, 1)).toBe('Конспект лекц…');
    expect(mapLabel(long, true, 1)).toBe(long);
  });
  it('hides idle labels when zoomed far out, never the focused one', () => {
    expect(mapLabel('Alpha', false, LABEL_HIDE_K - 0.01)).toBe('');
    expect(mapLabel('Alpha', true, LABEL_HIDE_K - 0.01)).toBe('Alpha');
    expect(mapLabel('Alpha', false, LABEL_HIDE_K)).toBe('Alpha');
  });
});

describe('edgePath', () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
  const ends = (d: string) => d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  it('a one-way link is a straight segment between the node rims', () => {
    const d = edgePath(a, b, 10, 12, false);
    expect(d).toMatch(/^M .* L /);
    const [x1, , x2] = ends(d);
    expect(x1).toBeCloseTo(10);
    expect(x2).toBeCloseTo(88);
  });
  it('a two-way link bows to one side so it reads as its own relation', () => {
    const d = edgePath(a, b, 10, 12, true);
    expect(d).toMatch(/^M .* Q /);
    const [, , , cy] = ends(d);
    expect(Math.abs(cy)).toBeGreaterThan(8);
  });
  it('returns nothing when the rims overlap', () => {
    expect(edgePath(a, { x: 15, y: 0 }, 10, 12, false)).toBe('');
  });
});
