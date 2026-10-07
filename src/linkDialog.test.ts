import { describe, expect, it } from "vitest";
import { matchLinkCandidate } from "./LinkDialog";

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
