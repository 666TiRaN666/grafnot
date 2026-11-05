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

/** Numeric emphasis as A1111 and ComfyUI read it: (tag:1.2) / (tag:0.8).
 * Legacy ((tag)) and [tag] still count as high/low (stored templates). */
const NUM_WEIGHT = /^\((.+):\s*(\d+(?:\.\d+)?)\)$/;
export const WEIGHT_HIGH = 1.2;
export const WEIGHT_LOW = 0.8;

export function tagWeight(token: string): TagWeight {
  const t = token.trim();
  const m = NUM_WEIGHT.exec(t);
  if (m) {
    const w = Number(m[2]);
    return w > 1 ? "high" : w < 1 ? "low" : "normal";
  }
  if (t.startsWith("((") && t.endsWith("))")) return "high";
  if (t.startsWith("[") && t.endsWith("]")) return "low";
  return "normal";
}

/** Remove emphasis (numeric or brackets), repeatedly. */
export function stripWeight(token: string): string {
  let t = token.trim();
  for (;;) {
    const m = NUM_WEIGHT.exec(t);
    if (m) {
      t = (m[1] ?? "").trim();
      continue;
    }
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
  if (w === "high") return `(${base}:${WEIGHT_HIGH})`;
  if (w === "low") return `(${base}:${WEIGHT_LOW})`;
  return base;
}

/** Exact emphasis of a token: 1 for a plain tag, legacy brackets as high/low. */
export function weightValue(token: string): number {
  const m = NUM_WEIGHT.exec(token.trim());
  if (m) return Number(m[2]);
  const w = tagWeight(token);
  return w === "high" ? WEIGHT_HIGH : w === "low" ? WEIGHT_LOW : 1;
}

/** One 0.1 step up or down within 0.1..2 (focus group: three steps were too
 * coarse); exactly 1 writes the plain tag. */
export function stepWeight(token: string, dir: -1 | 1): string {
  const base = stripWeight(token);
  if (!base) return base;
  const v = Math.min(2, Math.max(0.1, Math.round((weightValue(token) + dir * 0.1) * 10) / 10));
  return v === 1 ? base : `(${base}:${v})`;
}

export type WeightModel = "Pony" | "SDXL" | "Flux" | "Midjourney";

/** Models that understand bracket emphasis (the chip menu shows weights only for these). */
export const hasWeights = (model: WeightModel): boolean => model === "Pony" || model === "SDXL";

/**
 * Per-model weight formatting (P3). Pony (danbooru emphasis) and SDXL
 * (native emphasis) understand bracket weights; Flux is natural language —
 * brackets would be copied as literal text it does not understand, so weight
 * is a no-op that strips. Stored tokens keep their brackets under Flux (the
 * chip menu only hides the controls), so switching back restores the look;
 * renderPrompt strips at render time for Flux for the same reason.
 */
export function formatWeight(model: WeightModel, tag: string, w: TagWeight): string {
  if (!hasWeights(model)) return stripWeight(tag);
  return applyWeight(tag, w);
}
