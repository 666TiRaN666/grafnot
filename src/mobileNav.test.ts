import { describe, expect, it } from "vitest";
import { STR } from "./i18n";

describe("mobile nav copy", () => {
  it("labels all five tabbar destinations in all languages", () => {
    for (const k of ["notebooks", "planT", "kmap", "nav_prompt", "newNote"]) {
      for (const lang of ["RU", "EN", "KZ"] as const) {
        expect(STR[k][lang].length).toBeGreaterThan(0);
      }
    }
  });
});
