import { describe, expect, it } from "vitest";
import { buildLibrary, filterLibrary } from "./promptLibrary";
import type { LlmTpl } from "./data";
import type { PromptSave } from "./store";

const BUILTIN: LlmTpl[] = [
  { id: "sql", name: "SQL explain", body: "Explain {{query}}", defaults: {} },
  { id: "art", name: "Art", body: "1girl, {{hair}}", defaults: {} },
];
const CUSTOM: LlmTpl[] = [{ id: "ct1", name: "My SQL", body: "SELECT {{what}}", defaults: {} }];
const SAVES: PromptSave[] = [
  { id: "p1", kind: "llm", title: "Old save", templateId: "sql", params: {}, created: 1 },
  { id: "p2", kind: "image", title: "New art", model: "SDXL", tokens: ["blue"], created: 9 },
];

describe("buildLibrary", () => {
  it("unifies builtins, customs and saves with origin and type", () => {
    const lib = buildLibrary(BUILTIN, CUSTOM, SAVES);
    expect(lib.map((e) => e.id)).toEqual(["sql", "art", "ct1", "p1", "p2"]);
    expect(lib.map((e) => e.origin)).toEqual(["builtin", "builtin", "custom", "save", "save"]);
    expect(lib.find((e) => e.id === "art")?.type).toBe("image");
    expect(lib.find((e) => e.id === "sql")?.type).toBe("text");
    expect(lib.find((e) => e.id === "p2")?.type).toBe("image");
  });
});

describe("filterLibrary", () => {
  const lib = buildLibrary(BUILTIN, CUSTOM, SAVES);
  it("filters by segment", () => {
    expect(filterLibrary(lib, "", "image").map((e) => e.id)).toEqual(["art", "p2"]);
    expect(filterLibrary(lib, "", "text").map((e) => e.id)).toEqual(["sql", "ct1", "p1"]);
    expect(filterLibrary(lib, "", "mine").map((e) => e.id)).toEqual(["ct1", "p1", "p2"]);
  });
  it("lists recent saves first, customs after, builtins never", () => {
    expect(filterLibrary(lib, "", "recent").map((e) => e.id)).toEqual(["p2", "p1", "ct1"]);
  });
  it("matches title and snippet case-insensitively", () => {
    expect(filterLibrary(lib, "sql", "all").map((e) => e.id)).toEqual(["sql", "ct1"]);
    expect(filterLibrary(lib, "BLUE", "all").map((e) => e.id)).toEqual(["p2"]);
    expect(filterLibrary(lib, "zzz", "all")).toEqual([]);
  });
});
