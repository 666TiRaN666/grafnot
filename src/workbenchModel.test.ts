import { describe, expect, it } from "vitest";
import { buildSaveTitle, requiredSlots } from "./workbenchModel";

describe("requiredSlots", () => {
  it("treats slots without a non-empty default as required", () => {
    expect(requiredSlots({ body: "a {{x}} b {{y}}", defaults: { x: "1" } })).toEqual(["y"]);
    expect(requiredSlots({ body: "a {{x}}", defaults: { x: " " } })).toEqual(["x"]);
    expect(requiredSlots({ body: "plain", defaults: {} })).toEqual([]);
  });
});

describe("buildSaveTitle", () => {
  it("names saves template plus date", () => {
    expect(buildSaveTitle("SQL explain", "08.10.2026")).toBe("SQL explain · 08.10.2026");
  });
});
