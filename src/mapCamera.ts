export const MAP_W = 800;
export const MAP_H = 500;

export interface ViewT {
  k: number;
  x: number;
  y: number;
}

/** View that maps a content point onto the viewBox center. */
export function centerView(px: number, py: number, k = 1): ViewT {
  return { k, x: MAP_W / 2 - px * k, y: MAP_H / 2 - py * k };
}

/** View fitting all points with padding (clamped like the wheel zoom). */
export function fitView(pts: { x: number; y: number }[], w = MAP_W, h = MAP_H): ViewT {
  if (pts.length === 0) return { k: 1, x: 0, y: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const k = Math.min(2.5, Math.max(0.4, Math.min(w / Math.max(x1 - x0 + 120, 1), h / Math.max(y1 - y0 + 120, 1))));
  return { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
}
