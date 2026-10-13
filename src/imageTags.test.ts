import { describe, expect, it } from "vitest";
import { applyWeight, filterTags, moveTag, parseTagInput, stripWeight, tagWeight } from "./imageTags";

const DICT = [{ tag: "blue hair" }, { tag: "blue eyes" }, { tag: "sunset" }];

describe("filterTags", () => {
  it("matches substrings case-insensitively", () => {
    expect(filterTags(DICT, "BLUE").map((t) => t.tag)).toEqual(["blue hair", "blue eyes"]);
    expect(filterTags(DICT, "zzz")).toEqual([]);
  });
});

describe("parseTagInput", () => {
  it("splits on commas and drops empties", () => {
    expect(parseTagInput("a, b ,,c")).toEqual(["a", "b", "c"]);
    expect(parseTagInput("  ")).toEqual([]);
  });
});

describe("moveTag", () => {
  it("moves within bounds and ignores the rest", () => {
    expect(moveTag(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveTag(["a", "b"], 0, 9)).toEqual(["a", "b"]);
    expect(moveTag(["a"], 0, 0)).toEqual(["a"]);
  });
});

describe("tag weight", () => {
  it("detects and applies SDXL-style emphasis", () => {
    expect(tagWeight("tag")).toBe("normal");
    expect(tagWeight("[tag]")).toBe("low");
    expect(tagWeight("((tag))")).toBe("high");
    expect(applyWeight("tag", "high")).toBe("((tag))");
    expect(applyWeight("tag", "low")).toBe("[tag]");
    expect(applyWeight("((tag))", "normal")).toBe("tag");
    expect(stripWeight("((tag))")).toBe("tag");
    expect(stripWeight("[tag]")).toBe("tag");
  });
});
