import { describe, expect, it } from "vitest";
import { newId } from "./newId";

describe("newId", () => {
  it("stamps the type prefix", () => {
    expect(newId("n").startsWith("n")).toBe(true);
    expect(newId("g").startsWith("g")).toBe(true);
  });
  it("never collides on rapid double creation", () => {
    const a = newId("n");
    const b = newId("n");
    expect(a).not.toBe(b);
  });
  it("stays unique across a burst", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId("t")));
    expect(ids.size).toBe(200);
  });
});
