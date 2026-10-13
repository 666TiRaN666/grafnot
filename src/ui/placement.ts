/** Anchor-relative popover placement with edge flip and viewport clamping.
 * Pure function (no DOM): all geometry is passed in as plain rects.
 */
export interface AnchorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PopSize {
  w: number;
  h: number;
}
export interface Viewport {
  w: number;
  h: number;
}
export interface Placement {
  x: number;
  y: number;
  flippedX: boolean;
  flippedY: boolean;
}

export const POP_GAP = 8;

export function computePlacement(
  anchor: AnchorRect,
  pop: PopSize,
  view: Viewport,
  gap: number = POP_GAP,
): Placement {
  // Vertical: prefer below the anchor, flip above when it would overflow.
  let y = anchor.y + anchor.h + gap;
  let flippedY = false;
  if (y + pop.h > view.h - gap) {
    y = anchor.y - pop.h - gap;
    flippedY = true;
  }
  // Horizontal: prefer left-aligned, right-align when it would overflow.
  let x = anchor.x;
  let flippedX = false;
  if (x + pop.w > view.w - gap) {
    x = anchor.x + anchor.w - pop.w;
    flippedX = true;
  }
  // Clamp into the viewport (popover larger than the viewport lands at gap).
  if (x < gap) x = gap;
  if (y < gap) y = gap;
  const maxX = view.w - pop.w - gap;
  const maxY = view.h - pop.h - gap;
  if (x > maxX) x = Math.max(gap, maxX);
  if (y > maxY) y = Math.max(gap, maxY);
  return { x: Math.round(x), y: Math.round(y), flippedX, flippedY };
}
