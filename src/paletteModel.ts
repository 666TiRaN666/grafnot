/** Palette/Quick Add result model (S2). Pure: grouping, capping and ranking
 * live here so unit tests cover them without a DOM. Rendering is Palette.tsx.
 * The match rule itself is the shared one (textMatch).
 */
import { matchesQuery, queryWords } from './textMatch';

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
/** Recent notes under the commands of an empty palette. */
export const PALETTE_RECENT = 3;

const GROUP_ORDER: PaletteGroup[] = ['notes', 'tasks', 'prompts', 'commands'];


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

/** Optimal string alignment distance (Levenshtein + adjacent swap), capped:
 * "nrom" -> "norm" is 1. Only short words are compared, so O(n·m) is fine. */
function osaDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** HE-1 (Lab 7): "Did you mean" for a query with no hits. A note is suggested
 * when every query word is within 1 typo (2 for words of 6+ letters) of the
 * start of some word in its title. Closest first, at most `max`. */
export function suggestNotes(query: string, notes: PaletteEntry[], max = 3): PaletteEntry[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const scored: { e: PaletteEntry; score: number }[] = [];
  for (const e of notes) {
    const titleWords = e.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    let score = 0;
    let ok = true;
    for (const w of words) {
      const limit = w.length >= 6 ? 2 : 1;
      let best = Infinity;
      for (const t of titleWords) best = Math.min(best, osaDistance(w, t.slice(0, w.length)), osaDistance(w, t));
      if (best > limit) { ok = false; break; }
      score += best;
    }
    if (ok) scored.push({ e, score });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, max).map((s) => s.e);
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
  // Empty query: the palette opens as Quick Add (commands first, so Enter still
  // makes a note), then the most recent notes to recognise instead of recall
  // (P4, Lab 7). The caller passes notes recent-first.
  if (words.length === 0) {
    return [...commands.slice(0, limits.commands ?? PALETTE_GROUP_CAP), ...notes.slice(0, PALETTE_RECENT)];
  }
  const byGroup: Record<PaletteGroup, PaletteEntry[]> = { notes, tasks, prompts, commands };
  const out: PaletteEntry[] = [];
  for (const g of GROUP_ORDER) {
    const hits = byGroup[g].filter((e) => matchesQuery([e.title, e.sub, e.searchText], query));
    out.push(...hits.slice(0, limits[g] ?? PALETTE_GROUP_CAP));
  }
  return out;
}
