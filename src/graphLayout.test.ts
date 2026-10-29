import { describe, expect, it } from 'vitest';
import { layoutGraph, liveGraph } from './graphLayout';

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
const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

describe('d3-force layout', () => {
  it('has no walls: a large graph spreads out instead of piling on a border', () => {
    const many = Array.from({ length: 80 }, (_, i) => 'n' + i);
    const chain: [string, string][] = many.slice(1).map((id, i) => [many[i] ?? '', id]);
    const pos = layoutGraph(many, chain);
    // The old layout clamped into 800x500: a long chain piled up exactly on the edges.
    const clamped = many.filter((id) => {
      const p = pos[id];
      return !p || p.x === 30 || p.x === 770 || p.y === 30 || p.y === 470;
    });
    expect(clamped).toEqual([]);
  });

  it('separates nodes (collision)', () => {
    const pos = layoutGraph(ids, edges);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        expect(dist(pos[ids[i]], pos[ids[j]])).toBeGreaterThan(40);
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

describe('live graph physics', () => {
  const start = () => layoutGraph(ids, edges);

  it('a dragged note pulls its linked notes along', () => {
    const g = liveGraph(ids, edges, start(), {});
    const before = g.positions();
    const target = { x: before.a.x + 300, y: before.a.y };
    g.drag('a', target.x, target.y);
    g.step(120);
    const after = g.positions();
    expect(dist(after.a, target)).toBeLessThan(1);
    expect(after.b.x - before.b.x).toBeGreaterThan(60);
    expect(after.c.x - before.c.x).toBeGreaterThan(60);
    g.stop();
  });

  it('a pinned note stays put while another is dragged', () => {
    const s = start();
    const g = liveGraph(ids, edges, s, { b: s.b });
    g.drag('a', s.a.x + 300, s.a.y + 200);
    g.step(120);
    const after = g.positions();
    expect(dist(after.b, s.b)).toBeLessThan(0.001);
    expect(dist(after.c, s.c)).toBeGreaterThan(20);
    g.stop();
  });

  it('release frees an unpinned note and keeps a pinned one where it was dropped', () => {
    const s = start();
    const g = liveGraph(ids, edges, s, { b: s.b });
    g.drag('b', s.b.x + 150, s.b.y);
    g.release('b', true);
    g.drag('a', s.a.x - 200, s.a.y);
    g.release('a', false);
    g.step(200);
    const after = g.positions();
    expect(dist(after.b, { x: s.b.x + 150, y: s.b.y })).toBeLessThan(0.001);
    expect(dist(after.a, { x: s.a.x - 200, y: s.a.y })).toBeGreaterThan(5);
    g.stop();
  });
});
