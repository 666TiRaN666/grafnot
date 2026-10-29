export const MAP_W = 800;
export const MAP_H = 500;
/** Zoom range: the canvas has no walls, so a big graph needs to fit far out. */
export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 2.5;

export interface ViewT {
  k: number;
  x: number;
  y: number;
}

/** View that maps a content point onto the viewBox center. */
export function centerView(px: number, py: number, k = 1, w = MAP_W, h = MAP_H): ViewT {
  return { k, x: w / 2 - px * k, y: h / 2 - py * k };
}

interface Box { left: number; right: number; top: number; bottom: number; width: number }
const REVEAL_M = 32;

/** Screen shift (px) that takes a note out from under the note card: a
 * bottom sheet (most of the canvas width) moves it up, a side card moves
 * it to the left. Zero when the note is already clear of the card. */
export function revealShift(pt: { x: number; y: number }, cover: Box, canvas: { width: number }): { dx: number; dy: number } {
  const m = REVEAL_M;
  if (pt.x < cover.left - m || pt.x > cover.right + m || pt.y < cover.top - m || pt.y > cover.bottom + m) return { dx: 0, dy: 0 };
  if (cover.width > canvas.width * 0.7) return { dx: 0, dy: Math.min(0, cover.top - m - pt.y - 24) };
  return { dx: Math.min(0, cover.left - m - pt.x - 24), dy: 0 };
}

/** viewBox height for a canvas of this size: the width stays MAP_W units and
 * the box takes the element's proportions, so a tall canvas is not letterboxed. */
export function boxHeight(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return MAP_H;
  return Math.round((MAP_W * height) / width);
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
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(w / Math.max(x1 - x0 + 120, 1), h / Math.max(y1 - y0 + 120, 1))));
  return { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
}
