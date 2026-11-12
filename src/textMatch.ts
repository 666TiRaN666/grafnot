/**
 * One search rule for every place that finds records by typed text: the
 * notes, tasks and trash lists, the map (search, link, members, graph
 * switcher), `[[` suggestions, «To note», prompt insert, the library and
 * the palette. Highlighting lives here too, so a row never matches on words
 * it does not mark (2026-11: three rules disagreed — a template body word
 * after the 70-character card snippet was found by Ctrl+K only, and
 * «отчёт март» found «Отчёт за март» in the palette but not in the list).
 *
 * Rule: case-insensitive, every word of the query, in any order, anywhere
 * in one of the fields. It is a superset of the old «the whole query as one
 * substring»: switching to it only adds results.
 * Tag completion (imageTags) is not a search and keeps its own prefix rule.
 */

/** Words of a query; lower-cased only, so Kazakh letters stay distinct. */
export function queryWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);
}

/** Every query word occurs in one of the fields (fields are not glued together). */
export function matchesQuery(fields: ReadonlyArray<string | undefined>, query: string): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  const lower = fields.map((f) => (f ?? '').toLowerCase());
  return words.every((w) => lower.some((f) => f.includes(w)));
}

export interface HiPart {
  text: string;
  hit: boolean;
}

/** Split text for <mark> highlighting: every occurrence of every query word,
 * overlaps merged. A case mapping that changes the length would shift the
 * offsets, so such a text is returned unmarked. */
export function splitHighlight(text: string, q: string): HiPart[] {
  const words = queryWords(q);
  const low = text.toLowerCase();
  if (words.length === 0 || low.length !== text.length) return [{ text, hit: false }];
  const marked = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let j = low.indexOf(w); j >= 0; j = low.indexOf(w, j + 1)) marked.fill(true, j, j + w.length);
  }
  const out: HiPart[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marked[i] !== marked[start]) {
      out.push({ text: text.slice(start, i), hit: marked[start] === true });
      start = i;
    }
  }
  return out.filter((p) => p.text);
}

/**
 * Cut AFTER highlighting: walk highlighted parts and stop at max chars, but
 * never split a matched fragment — a hit always survives whole (the margin).
 */
export function cutHiParts(parts: HiPart[], max: number): HiPart[] {
  const out: HiPart[] = [];
  let n = 0;
  let extended = false;
  for (const p of parts) {
    if (n >= max) {
      if (p.hit && !extended) {
        out.push(p);
        n += p.text.length;
        extended = true;
        continue;
      }
      break;
    }
    if (!p.hit && n + p.text.length > max) {
      if (n === 0) out.push({ text: p.text.slice(0, max), hit: false });
      break;
    }
    out.push(p);
    n += p.text.length;
  }
  return out;
}
