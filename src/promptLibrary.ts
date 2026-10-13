import type { LlmTpl } from "./data";
import type { PromptSave } from "./store";
import { getTplKind, makeSnippet, promptPreview } from "./promptUtils";

export type LibOrigin = "builtin" | "custom" | "save";
export type LibType = "image" | "text";

export interface LibEntry {
  id: string;
  title: string;
  snippet: string;
  type: LibType;
  origin: LibOrigin;
  /** Saves carry created; templates have no timestamps (0). */
  ts: number;
}

export type LibSeg = "all" | "image" | "text" | "mine" | "recent";

/** One list over everything: built-in templates, customs, saved prompts. */
export function buildLibrary(builtin: LlmTpl[], custom: LlmTpl[], saves: PromptSave[]): LibEntry[] {
  return [
    ...builtin.map((t): LibEntry => ({
      id: t.id,
      title: t.name,
      snippet: makeSnippet(t.body),
      type: getTplKind(t) === "image" ? "image" : "text",
      origin: "builtin",
      ts: 0,
    })),
    ...custom.map((t): LibEntry => ({
      id: t.id,
      title: t.name,
      snippet: makeSnippet(t.body),
      type: getTplKind(t) === "image" ? "image" : "text",
      origin: "custom",
      ts: 0,
    })),
    ...saves.map((p): LibEntry => ({
      id: p.id,
      title: p.title,
      snippet: promptPreview(p, custom),
      type: p.kind === "image" ? "image" : "text",
      origin: "save",
      ts: p.created,
    })),
  ];
}

/** Segment + query over the unified list. Recent = saves newest-first,
 * customs after (no timestamps), builtins never. Pure, unit tested. */
export function filterLibrary(entries: LibEntry[], q: string, seg: LibSeg): LibEntry[] {
  const needle = q.trim().toLowerCase();
  const kept = entries.filter((e) => {
    if (seg === "image" && e.type !== "image") return false;
    if (seg === "text" && e.type !== "text") return false;
    if (seg === "mine" && e.origin === "builtin") return false;
    if (seg === "recent" && e.origin === "builtin") return false;
    if (needle && !`${e.title} ${e.snippet}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  if (seg !== "recent") return kept;
  const saves = kept.filter((e) => e.origin === "save").sort((a, b) => b.ts - a.ts);
  return [...saves, ...kept.filter((e) => e.origin !== "save")];
}
