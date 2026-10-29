import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';

export interface GPos {
  x: number;
  y: number;
}

interface GNode extends SimulationNodeDatum {
  id: string;
}

interface GLink extends SimulationLinkDatum<GNode> {}

export const LAYOUT_W = 800;
export const LAYOUT_H = 500;

/** Seeded source for d3's jiggle (coincident points): same input, same run. */
function lcg(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** One physics model for the settled layout and the live map. Links are
 * springs, notes repel and keep a gap, and a weak pull toward the middle
 * stands in for walls: nothing is clamped to a box, the camera fits instead. */
function buildSim(ids: string[], edges: [string, string][], start: (id: string, i: number) => GPos, pinned: Record<string, GPos>): { sim: Simulation<GNode, GLink>; nodes: GNode[]; byId: Map<string, GNode> } {
  const nodes: GNode[] = ids.map((id, i) => {
    const p = start(id, i);
    const pin = pinned[id];
    return pin ? { id, x: pin.x, y: pin.y, fx: pin.x, fy: pin.y } : { id, x: p.x, y: p.y };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: GLink[] = [];
  const seen = new Set<string>();
  for (const [a, b] of edges) {
    const source = byId.get(a);
    const target = byId.get(b);
    if (a === b || !source || !target) continue;
    const k = [a, b].sort().join('>');
    if (seen.has(k)) continue;
    seen.add(k);
    links.push({ source, target });
  }
  const sim = forceSimulation<GNode>(nodes)
    .randomSource(lcg())
    .velocityDecay(0.32)
    .force('charge', forceManyBody().strength(-300).distanceMax(600))
    .force('link', forceLink<GNode, GLink>(links).distance(110).strength(0.5))
    .force('collide', forceCollide(32).strength(0.9))
    .force('x', forceX(LAYOUT_W / 2).strength(0.05))
    .force('y', forceY(LAYOUT_H / 2).strength(0.05))
    .stop();
  return { sim, nodes, byId };
}

/** Initial ring: deterministic, grows with the node count so big graphs start spread. */
function ring(count: number): (id: string, i: number) => GPos {
  const r = Math.max(160, Math.sqrt(count) * 45);
  return (_id, i) => {
    const a = (2 * Math.PI * i) / Math.max(count, 1);
    return { x: LAYOUT_W / 2 + Math.cos(a) * r, y: LAYOUT_H / 2 + Math.sin(a) * r * 0.62 };
  };
}

const snapshot = (nodes: GNode[]): Record<string, GPos> => {
  const out: Record<string, GPos> = {};
  for (const n of nodes) out[n.id] = { x: n.x ?? LAYOUT_W / 2, y: n.y ?? LAYOUT_H / 2 };
  return out;
};

/**
 * Settled force-directed layout: manual ticks, no timer, seeded jiggle, so
 * the same input gives the same output. Results are memoized by input
 * value; callers must treat the result as read-only.
 */
let lastKey = "";
let lastOut: Record<string, GPos> = {};
export function layoutGraph(ids: string[], edges: [string, string][], ticks = 300): Record<string, GPos> {
  const key = JSON.stringify([ids, edges, ticks]);
  if (key === lastKey) return lastOut;
  const { sim, nodes } = buildSim(ids, edges, ring(ids.length), {});
  for (let i = 0; i < ticks; i++) sim.tick();
  lastKey = key;
  lastOut = snapshot(nodes);
  return lastOut;
}

/** Live map physics (MapView): the dragged note is held at the pointer and
 * its springs pull neighbours along; pinned notes never move unless dragged
 * themselves. `onTick` fires per animation frame while the graph moves;
 * `step` advances by hand (reduced motion, tests) without the timer. */
export interface LiveGraph {
  positions: () => Record<string, GPos>;
  drag: (id: string, x: number, y: number) => void;
  /** End a drag: keep the note fixed where it was dropped (pinned) or let it go. */
  release: (id: string, keepFixed: boolean) => void;
  pin: (id: string, at: GPos | null) => void;
  /** Let new or removed springs settle (animated, or at once without a timer). */
  wake: () => void;
  step: (ticks: number) => void;
  stop: () => void;
}

export function liveGraph(
  ids: string[],
  edges: [string, string][],
  start: Record<string, GPos>,
  pinned: Record<string, GPos>,
  onTick?: () => void,
): LiveGraph {
  const fallback = ring(ids.length);
  const { sim, nodes, byId } = buildSim(ids, edges, (id, i) => start[id] ?? fallback(id, i), pinned);
  const animate = onTick !== undefined;
  if (onTick) sim.on('tick', onTick);
  let holding = false;
  return {
    positions: () => snapshot(nodes),
    drag: (id, x, y) => {
      const n = byId.get(id);
      if (!n) return;
      n.fx = x;
      n.fy = y;
      if (!holding) {
        holding = true;
        sim.alphaTarget(0.3);
        if (animate) sim.restart();
        else sim.alpha(Math.max(sim.alpha(), 0.3));
      }
    },
    release: (id, keepFixed) => {
      const n = byId.get(id);
      holding = false;
      sim.alphaTarget(0);
      if (!n) return;
      if (!keepFixed) {
        n.fx = null;
        n.fy = null;
      }
    },
    pin: (id, at) => {
      const n = byId.get(id);
      if (!n) return;
      n.fx = at ? at.x : null;
      n.fy = at ? at.y : null;
      if (at) {
        n.x = at.x;
        n.y = at.y;
      } else if (animate) sim.alpha(0.3).restart();
    },
    wake: () => {
      sim.alpha(0.3);
      if (animate) sim.restart();
      else for (let i = 0; i < 200; i++) sim.tick();
    },
    step: (ticks) => {
      for (let i = 0; i < ticks; i++) sim.tick();
    },
    stop: () => {
      sim.on('tick', null);
      sim.stop();
    },
  };
}
