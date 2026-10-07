import { describe, expect, it } from "vitest";
import { STR } from "./i18n";

describe("mobile nav copy", () => {
  it("declares more overflow label in all languages", () => {
    expect(STR.moreNav.RU).toBe("Ещё");
    expect(STR.moreNav.EN).toBe("More");
    expect(STR.moreNav.KZ).toBe("Қосымша");
  });
  it("keeps overflow destinations labeled", () => {
    for (const k of ["kmap", "nav_prompt"]) {
      for (const lang of ["RU", "EN", "KZ"] as const) {
        expect(STR[k][lang].length).toBeGreaterThan(0);
      }
    }
  });
});
