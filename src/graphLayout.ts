import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';

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

/**
 * Deterministic force-directed layout: manual ticks, no timer, no RNG
 * (initial positions are fixed on a circle, so Math.random is never hit).
 * Same input => same output. Only this module knows about d3-force.
 * Results are memoized by input value: repeated calls with identical
 * ids/edges/params return the cached positions instead of re-running the
 * 300 synchronous ticks. Callers must treat the result as read-only.
 */
let lastKey = "";
let lastOut: Record<string, GPos> = {};
export function layoutGraph(
  ids: string[],
  edges: [string, string][],
  width = LAYOUT_W,
  height = LAYOUT_H,
  ticks = 300,
): Record<string, GPos> {
  const key = JSON.stringify([ids, edges, width, height, ticks]);
  if (key === lastKey) return lastOut;
  const nodes: GNode[] = ids.map((id, i) => {
    const a = (2 * Math.PI * i) / Math.max(ids.length, 1);
    return {
      id,
      x: width / 2 + Math.cos(a) * width * 0.32,
      y: height / 2 + Math.sin(a) * height * 0.32,
    };
  });
  const byId = new Set(ids);
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const links: GLink[] = [];
  const seen = new Set<string>();
  for (const [a, b] of edges) {
    if (a === b || !byId.has(a) || !byId.has(b)) continue;
    const k = [a, b].sort().join('>');
    if (seen.has(k)) continue;
    seen.add(k);
    const source = byNode.get(a);
    const target = byNode.get(b);
    if (source && target) links.push({ source, target });
  }
  const sim = forceSimulation<GNode>(nodes)
    .force('charge', forceManyBody().strength(-260).distanceMax(320))
    .force('link', forceLink<GNode, GLink>(links).distance(110).strength(0.6))
    .force('collide', forceCollide(30).strength(0.9))
    .force('center', forceCenter(width / 2, height / 2))
    .stop();
  for (let i = 0; i < ticks; i++) sim.tick();
  const out: Record<string, GPos> = {};
  for (const n of nodes) {
    out[n.id] = {
      x: Math.min(width - 30, Math.max(30, n.x ?? width / 2)),
      y: Math.min(height - 30, Math.max(30, n.y ?? height / 2)),
    };
  }
  lastKey = key;
  lastOut = out;
  return out;
}
