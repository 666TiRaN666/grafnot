import { describe, expect, it } from "vitest";
import {
  TPL_LIMIT_DEFAULT,
  buildTplEntries,
  clampActive,
  filterTplEntries,
  getTplKind,
  loadTplLimit,
  makeSnippet,
  matchesTpl,
  moveActive,
  parseTplLimit,
  saveTplLimit,
  splitHighlight,
} from "./promptUtils";
import type { LlmTpl } from "./data";

const A: LlmTpl = { id: "a", name: "Code review", body: "Check code in {{lang}} at {{level}}.", defaults: { lang: "TS", level: "junior" } };
const ART: LlmTpl = { id: "art", name: "Art hero", body: "masterpiece, 1girl, {{hair}} hair", defaults: { hair: "long" } };
const MINE: LlmTpl = { id: "ct1", name: "My SQL", body: "Explain {{query}} in {{dialect}}.", defaults: {} };
const MY_ART: LlmTpl = { id: "ct2", name: "My art", body: "blue hair", defaults: {}, kind: "image" };

describe("tpl kind", () => {
  it("marks builtin art as image and rest as llm", () => {
    expect(getTplKind(ART)).toBe("image");
    expect(getTplKind(A)).toBe("llm");
    expect(getTplKind(MINE)).toBe("llm");
    expect(getTplKind(MY_ART)).toBe("image");
  });
});

describe("snippet", () => {
  it("keeps short bodies as is", () => {
    expect(makeSnippet("plain body")).toBe("plain body");
  });
  it("collapses whitespace and truncates long bodies", () => {
    const s = makeSnippet("a  bXc ".repeat(30));
    expect(s.length).toBeLessThanOrEqual(73);
    expect(s.endsWith("...")).toBe(true);
  });
  it("respects custom length", () => {
    expect(makeSnippet("0123456789", 4)).toBe("0123...");
  });
});

describe("matchesTpl", () => {
  it("matches empty query", () => {
    expect(matchesTpl(A, "")).toBe(true);
    expect(matchesTpl(A, "   ")).toBe(true);
  });
  it("searches title body and slots case insensitively", () => {
    expect(matchesTpl(A, "code review")).toBe(true);
    expect(matchesTpl(A, "CODE")).toBe(true);
    expect(matchesTpl(A, "lang")).toBe(true);
    expect(matchesTpl(A, "LEVEL")).toBe(true);
    expect(matchesTpl(A, "missing")).toBe(false);
  });
});

describe("entries", () => {
  it("merges builtins first then customs with mine flags", () => {
    const all = buildTplEntries([A, ART], [MINE]);
    expect(all.map((e) => e.tpl.id)).toEqual(["a", "art", "ct1"]);
    expect(all.map((e) => e.mine)).toEqual([false, false, true]);
    expect(all.map((e) => e.kind)).toEqual(["llm", "image", "llm"]);
  });
  it("filters by chip and query", () => {
    const all = buildTplEntries([A, ART], [MINE]);
    expect(filterTplEntries(all, "", "all")).toHaveLength(3);
    expect(filterTplEntries(all, "", "mine").map((e) => e.tpl.id)).toEqual(["ct1"]);
    expect(filterTplEntries(all, "", "llm").map((e) => e.tpl.id)).toEqual(["a", "ct1"]);
    expect(filterTplEntries(all, "", "image").map((e) => e.tpl.id)).toEqual(["art"]);
    expect(filterTplEntries(all, "sql", "all").map((e) => e.tpl.id)).toEqual(["ct1"]);
    expect(filterTplEntries(all, "sql", "mine").map((e) => e.tpl.id)).toEqual(["ct1"]);
    expect(filterTplEntries(all, "sql", "image")).toHaveLength(0);
  });
});

describe("splitHighlight", () => {
  it("returns single miss for empty query", () => {
    expect(splitHighlight("abc", "")).toEqual([{ text: "abc", hit: false }]);
  });
  it("splits hits case insensitively", () => {
    expect(splitHighlight("Code review code", "code")).toEqual([
      { text: "Code", hit: true },
      { text: " review ", hit: false },
      { text: "code", hit: true },
    ]);
  });
});

describe("tpl limit prefs", () => {
  it("parses only known sizes", () => {
    expect(parseTplLimit("5")).toBe(5);
    expect(parseTplLimit(25)).toBe(25);
    expect(parseTplLimit("7")).toBe(TPL_LIMIT_DEFAULT);
    expect(parseTplLimit(null)).toBe(TPL_LIMIT_DEFAULT);
  });
  it("round trips through storage", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    expect(loadTplLimit(storage)).toBe(TPL_LIMIT_DEFAULT);
    saveTplLimit(25, storage);
    expect(loadTplLimit(storage)).toBe(25);
  });
});

describe("list nav math", () => {
  it("clamps and moves", () => {
    expect(clampActive(9, 3)).toBe(2);
    expect(clampActive(-1, 3)).toBe(0);
    expect(clampActive(0, 0)).toBe(0);
    expect(moveActive(0, 3, 1)).toBe(1);
    expect(moveActive(2, 3, 1)).toBe(2);
    expect(moveActive(0, 3, -1)).toBe(0);
    expect(moveActive(0, 0, 1)).toBe(0);
  });
});
