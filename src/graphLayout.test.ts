import { describe, expect, it } from 'vitest';
import { layoutGraph } from './graphLayout';

const ids = ['a', 'b', 'c', 'solo'];
const edges: [string, string][] = [
  ['a', 'b'],
  ['b', 'c'],
  ['c', 'a'],
];

const rounded = (o: Record<string, { x: number; y: number }>) =>
  Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, { x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100 }]),
  );

describe('d3-force layout', () => {
  it('keeps every node inside the box', () => {
    const pos = layoutGraph(ids, edges);
    for (const id of ids) {
      expect(pos[id].x).toBeGreaterThanOrEqual(30);
      expect(pos[id].x).toBeLessThanOrEqual(770);
      expect(pos[id].y).toBeGreaterThanOrEqual(30);
      expect(pos[id].y).toBeLessThanOrEqual(470);
    }
  });

  it('separates nodes (collision)', () => {
    const pos = layoutGraph(ids, edges);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const dx = pos[ids[i]].x - pos[ids[j]].x;
        const dy = pos[ids[i]].y - pos[ids[j]].y;
        expect(Math.hypot(dx, dy)).toBeGreaterThan(40);
      }
    }
  });

  it('is deterministic for the same input', () => {
    expect(rounded(layoutGraph(ids, edges))).toEqual(rounded(layoutGraph(ids, edges)));
  });

  it('centers the connected triangle near canvas middle', () => {
    const pos = layoutGraph(ids, edges);
    const cx = (pos.a.x + pos.b.x + pos.c.x) / 3;
    const cy = (pos.a.y + pos.b.y + pos.c.y) / 3;
    expect(Math.abs(cx - 400)).toBeLessThan(120);
    expect(Math.abs(cy - 250)).toBeLessThan(120);
  });

  it('handles empty input', () => {
    expect(layoutGraph([], [])).toEqual({});
  });
});
