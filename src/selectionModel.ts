/**
 * One selection model for lists and the map (pure, unit-tested).
 *
 * - plain click: the item alone (the caller decides whether a plain click
 *   opens instead, e.g. the notes list outside selection mode);
 * - Ctrl/Cmd+click: add or remove one item;
 * - Shift+click: a range from the anchor in list order; where there is no
 *   order (the map) Shift adds the item, never removes;
 * - select all / clear.
 */
export interface Selection {
  ids: string[];
  /** Where a Shift range starts: the last item clicked without Shift. */
  anchor: string | null;
}

export const NO_SELECTION: Selection = { ids: [], anchor: null };

export interface SelectMods {
  /** Ctrl (Windows, Linux) or Cmd (macOS). */
  toggle: boolean;
  range: boolean;
}

export function selectMods(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): SelectMods {
  return { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey };
}

const uniq = (ids: string[]) => [...new Set(ids)];

/**
 * @param order list order for Shift ranges; null where items have no order.
 * @param base an item that counts as already selected when a selection
 *   starts (the open note: Ctrl+click on another one selects both).
 */
export function clickSelect(sel: Selection, id: string, mods: SelectMods, order: string[] | null, base: string | null = null): Selection {
  const start = sel.ids.length === 0 && base && base !== id && (!order || order.includes(base)) ? [base] : sel.ids;
  if (mods.range && order) {
    const anchor = sel.anchor ?? (start[0] ?? id);
    const a = order.indexOf(anchor), b = order.indexOf(id);
    if (a < 0 || b < 0) return { ids: uniq([...start, id]), anchor: id };
    const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    return { ids: mods.toggle ? uniq([...start, ...span]) : span, anchor };
  }
  if (mods.range) return { ids: uniq([...start, id]), anchor: id };
  if (mods.toggle) {
    return { ids: start.includes(id) ? start.filter((x) => x !== id) : [...start, id], anchor: id };
  }
  return { ids: [id], anchor: id };
}

export function selectAll(order: string[]): Selection {
  return { ids: [...order], anchor: order[0] ?? null };
}

/** Items that no longer exist (deleted, filtered out of scope) leave the selection. */
export function pruneSelection(sel: Selection, present: ReadonlySet<string>): Selection {
  if (sel.ids.every((id) => present.has(id))) return sel;
  const ids = sel.ids.filter((id) => present.has(id));
  return { ids, anchor: sel.anchor && present.has(sel.anchor) ? sel.anchor : (ids[0] ?? null) };
}

/** Ids whose point lies inside the rectangle spanned by two corners. */
export function idsInRect(points: Record<string, { x: number; y: number }>, a: { x: number; y: number }, b: { x: number; y: number }): string[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return Object.entries(points).filter(([, p]) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map(([id]) => id);
}
