/** Palette/Quick Add result model (S2). Pure: grouping, capping and ranking
 * live here so unit tests cover them without a DOM. Rendering is Palette.tsx.
 */
export type PaletteGroup = 'notes' | 'tasks' | 'prompts' | 'commands';

export interface PaletteEntry {
  id: string;
  group: PaletteGroup;
  title: string;
  sub: string;
  accessibleName?: string;
  derived?: boolean;
  searchText?: string;
  refId?: string;
  cmd?: string;
}

/** Max rows per group: the palette shows groups of 3-4, never a common top-7. */
export const PALETTE_GROUP_CAP = 4;

const GROUP_ORDER: PaletteGroup[] = ['notes', 'tasks', 'prompts', 'commands'];

/** AND words of a query; lower-cased only, so Kazakh letters stay distinct. */
const queryWords = (query: string): string[] => query.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);

/** Where a palette pick puts the caret (Stage2 §7.5): the earliest word in the
 * first text block holding every query word, else in the first block holding
 * any. `pos` is the position of a block's first character; null = no match. */
export function firstMatchPos(blocks: { pos: number; text: string }[], query: string): number | null {
  const words = queryWords(query);
  if (words.length === 0) return null;
  // A case mapping that changes length would shift offsets: such blocks are skipped.
  const hits = blocks.map((b) => {
    const lower = b.text.toLowerCase();
    const at = lower.length === b.text.length ? words.map((w) => lower.indexOf(w)) : [];
    const found = at.filter((i) => i >= 0);
    return { pos: b.pos, all: found.length === words.length, first: found.length ? Math.min(...found) : -1 };
  });
  const hit = hits.find((h) => h.all) ?? hits.find((h) => h.first >= 0);
  return hit ? hit.pos + hit.first : null;
}

export function filterPalette(
  query: string,
  notes: PaletteEntry[],
  tasks: PaletteEntry[],
  prompts: PaletteEntry[],
  commands: PaletteEntry[],
  limits: Partial<Record<PaletteGroup, number>> = {},
): PaletteEntry[] {
  const words = queryWords(query);
  const byGroup: Record<PaletteGroup, PaletteEntry[]> = { notes, tasks, prompts, commands };
  const out: PaletteEntry[] = [];
  for (const g of GROUP_ORDER) {
    const hits = words.length === 0 && g === 'commands'
      ? byGroup[g]
      : byGroup[g].filter((e) => {
          const s = `${e.title} ${e.sub} ${e.searchText ?? ""}`.toLowerCase();
          return words.every((w) => s.includes(w));
        });
    // Empty query shows commands only: the palette opens as Quick Add.
    if (words.length === 0 && g !== 'commands') continue;
    out.push(...hits.slice(0, limits[g] ?? PALETTE_GROUP_CAP));
  }
  return out;
}
