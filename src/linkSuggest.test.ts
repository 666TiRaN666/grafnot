import { describe, expect, it } from "vitest";
import { matchLinkCandidate, parseBracketQuery, rankLinkSuggest } from "./linkSuggest";

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
