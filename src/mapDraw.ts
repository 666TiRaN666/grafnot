/** Pure drawing rules for the map canvas (MapView). */

/** Below this zoom idle labels are hidden: they would only overlap. */
export const LABEL_HIDE_K = 0.45;
const SHORT = 14;

/** Label of a node: full for the selected or hovered note, shortened
 * otherwise, hidden when zoomed far out (the focused one always shows). */
export function mapLabel(name: string, focused: boolean, k: number): string {
  const text = name || '—';
  if (focused) return text;
  if (k < LABEL_HIDE_K) return '';
  return text.length > SHORT ? text.slice(0, SHORT - 1) + '…' : text;
}

/** SVG path between two node rims. A one-way link is straight; a two-way
 * link bows to one side and carries arrows at both ends, so it no longer
 * hides one direction under a single line. Empty when the rims overlap. */
export function edgePath(a: { x: number; y: number }, b: { x: number; y: number }, ra: number, rb: number, mutual: boolean): string {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= ra + rb) return '';
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  if (!mutual) {
    return `M ${a.x + ux * ra} ${a.y + uy * ra} L ${b.x - ux * rb} ${b.y - uy * rb}`;
  }
  // Bow perpendicular to the segment; ends leave the rims toward the bend.
  const bow = Math.min(40, len * 0.18);
  const cx = (a.x + b.x) / 2 - uy * bow, cy = (a.y + b.y) / 2 + ux * bow;
  const toward = (px: number, py: number, r: number) => {
    const d = Math.hypot(cx - px, cy - py) || 1;
    return { x: px + ((cx - px) / d) * r, y: py + ((cy - py) / d) * r };
  };
  const s = toward(a.x, a.y, ra), e = toward(b.x, b.y, rb);
  return `M ${s.x} ${s.y} Q ${cx} ${cy} ${e.x} ${e.y}`;
}
