import { describe, expect, it } from "vitest";
import { linkDirection, linkTargets, matchLinkCandidate, parseBracketQuery, rankLinkSuggest } from "./linkSuggest";

describe("matchLinkCandidate", () => {
  it("matches by title case insensitively", () => {
    expect(matchLinkCandidate({ id: "a", title: "Alpha" }, "z", "alp")).toBe(true);
    expect(matchLinkCandidate({ id: "a", title: "Alpha" }, "z", "ALP")).toBe(true);
  });
  it("matches body text as well as title", () => {
    expect(matchLinkCandidate({ id: "a", title: "Alpha", text: "beta body words" }, "z", "beta body words")).toBe(true);
    expect(matchLinkCandidate({ id: "a", title: "Alpha", text: "beta body words" }, "z", "BODY")).toBe(true);
    expect(matchLinkCandidate({ id: "a", title: "Alpha", text: "beta body words" }, "z", "gamma")).toBe(false);
  });
  it("matches every word in any order, like the lists", () => {
    expect(matchLinkCandidate({ id: "a", title: "Alpha", text: "beta body words" }, "z", "words alpha")).toBe(true);
  });
  it("excludes the source note", () => {
    expect(matchLinkCandidate({ id: "a", title: "Alpha" }, "a", "alp")).toBe(false);
  });
});

describe("parseBracketQuery", () => {
  it("returns null without an open bracket pair", () => {
    expect(parseBracketQuery("plain text")).toBe(null);
    expect(parseBracketQuery("a [b] c")).toBe(null);
    expect(parseBracketQuery("closed [[q]] tail")).toBe(null);
  });
  it("extracts the query after [[", () => {
    expect(parseBracketQuery("see [[Al")).toBe("Al");
    expect(parseBracketQuery("[[")).toBe("");
  });
  it("ignores newlines and nested brackets", () => {
    expect(parseBracketQuery("a\n[[be")).toBe("be");
    expect(parseBracketQuery("[[a[[b")).toBe("b");
  });
});

describe("rankLinkSuggest", () => {
  const notes = [
    { id: "old", title: "Alpha", text: "", updated: 1 },
    { id: "new", title: "Alpha beta", text: "", updated: 9 },
    { id: "mid", title: "Alphabet", text: "", updated: 5 },
  ];
  it("returns matches recent-first and drops the source", () => {
    expect(rankLinkSuggest(notes, "mid", "alpha").map((n) => n.id)).toEqual(["new", "old"]);
  });
  it("returns recent notes first on an empty query", () => {
    expect(rankLinkSuggest(notes, "zzz", "").map((n) => n.id)).toEqual(["new", "mid", "old"]);
  });
});

describe("linkDirection (P5: one row per related note)", () => {
  const a = { id: "a", linkedIds: ["b", "c"] };
  const notes = [a, { id: "b", linkedIds: ["a"] }, { id: "c", linkedIds: [] }, { id: "d", linkedIds: ["a"] }];
  it("tells outgoing, incoming and mutual links apart", () => {
    expect(linkDirection(a, notes[1]!)).toBe("both");
    expect(linkDirection(a, notes[2]!)).toBe("out");
    expect(linkDirection(a, notes[3]!)).toBe("in");
  });
});

describe("linkTargets (P3: the context panel's own note picker)", () => {
  const notes = [
    { id: "a", title: "Alpha", updated: 1, linkedIds: ["b"] },
    { id: "b", title: "Beta", updated: 2, linkedIds: [] },
    { id: "c", title: "Gamma", updated: 3, linkedIds: [] },
    { id: "d", title: "Alpha two", updated: 4, linkedIds: [] },
  ];
  it("offers notes not yet linked from the source, recent first, source excluded", () => {
    expect(linkTargets(notes, notes[0]!, "").map((n) => n.id)).toEqual(["d", "c"]);
    expect(linkTargets(notes, notes[0]!, "alp").map((n) => n.id)).toEqual(["d"]);
  });
});
