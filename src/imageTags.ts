export type TagWeight = "low" | "normal" | "high";

/** Dictionary lookup by substring, dictionary order kept. */
export function filterTags<T extends { tag: string }>(dict: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return dict.filter((t) => t.tag.toLowerCase().includes(needle));
}

/** Split a typed line on commas (Enter adds the whole line instead). */
export function parseTagInput(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Clamped reorder; out-of-range moves are no-ops. */
export function moveTag<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** SDXL-style emphasis: [weak], raw, ((strong)). */
export function tagWeight(token: string): TagWeight {
  const t = token.trim();
  if (t.startsWith("((") && t.endsWith("))")) return "high";
  if (t.startsWith("[") && t.endsWith("]")) return "low";
  return "normal";
}

/** Remove one layer of emphasis brackets, repeatedly. */
export function stripWeight(token: string): string {
  let t = token.trim();
  for (;;) {
    if (t.startsWith("((") && t.endsWith("))")) {
      t = t.slice(2, -2).trim();
      continue;
    }
    if (t.startsWith("[") && t.endsWith("]")) {
      t = t.slice(1, -1).trim();
      continue;
    }
    if (t.startsWith("(") && t.endsWith(")")) {
      t = t.slice(1, -1).trim();
      continue;
    }
    return t;
  }
}

export function applyWeight(tag: string, w: TagWeight): string {
  const base = stripWeight(tag);
  if (!base) return base;
  if (w === "high") return `((${base}))`;
  if (w === "low") return `[${base}]`;
  return base;
}

export type WeightModel = "Pony" | "SDXL" | "Flux";

/**
 * Per-model weight formatting (P3). Pony (danbooru emphasis) and SDXL
 * (native emphasis) understand bracket weights; Flux is natural language —
 * brackets would be copied as literal text it does not understand, so weight
 * is a no-op that strips. Stored tokens keep their brackets under Flux (the
 * chip menu only hides the controls), so switching back restores the look;
 * renderPrompt strips at render time for Flux for the same reason.
 */
export function formatWeight(model: WeightModel, tag: string, w: TagWeight): string {
  if (model === "Flux") return stripWeight(tag);
  return applyWeight(tag, w);
}
