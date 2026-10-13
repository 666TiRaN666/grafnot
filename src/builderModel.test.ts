import { describe, expect, it } from "vitest";
import { lintTemplate, nextFieldName } from "./builderModel";

describe("nextFieldName", () => {
  it("picks the smallest free поле_N", () => {
    expect(nextFieldName("hello")).toBe("поле_1");
    expect(nextFieldName("{{поле_1}} and {{поле_3}}")).toBe("поле_2");
  });
});

describe("lintTemplate", () => {
  it("passes clean bodies", () => {
    expect(lintTemplate("Hi {{name}}, bye")).toEqual([]);
    expect(lintTemplate("plain")).toEqual([]);
  });
  it("flags unclosed brackets with line numbers", () => {
    expect(lintTemplate("ok\nbroken {{oops")).toEqual([{ line: 2, kind: "unclosed" }]);
  });
  it("flags repeated names at the repeat line", () => {
    expect(lintTemplate("{{a}} {{b}}\nagain {{a}}")).toEqual([{ line: 2, kind: "duplicate", name: "a" }]);
  });
});
