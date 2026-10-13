/** Palette/Quick Add result model (S2). Pure: grouping, capping and ranking
 * live here so unit tests cover them without a DOM. Rendering is Palette.tsx.
 */
export type PaletteGroup = 'notes' | 'tasks' | 'prompts' | 'commands';

export interface PaletteEntry {
  id: string;
  group: PaletteGroup;
  title: string;
  sub: string;
  refId?: string;
  cmd?: string;
}

/** Max rows per group: the palette shows groups of 3-4, never a common top-7. */
export const PALETTE_GROUP_CAP = 4;

const GROUP_ORDER: PaletteGroup[] = ['notes', 'tasks', 'prompts', 'commands'];

export function filterPalette(
  query: string,
  notes: PaletteEntry[],
  tasks: PaletteEntry[],
  prompts: PaletteEntry[],
  commands: PaletteEntry[],
): PaletteEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  const byGroup: Record<PaletteGroup, PaletteEntry[]> = { notes, tasks, prompts, commands };
  const out: PaletteEntry[] = [];
  for (const g of GROUP_ORDER) {
    const hits = words.length === 0 && g === 'commands'
      ? byGroup[g]
      : byGroup[g].filter((e) => {
          const s = `${e.title} ${e.sub}`.toLowerCase();
          return words.every((w) => s.includes(w));
        });
    // Empty query shows commands only: the palette opens as Quick Add.
    if (words.length === 0 && g !== 'commands') continue;
    out.push(...hits.slice(0, PALETTE_GROUP_CAP));
  }
  return out;
}
