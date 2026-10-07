import { describe, expect, it } from "vitest";
import { TPL_LIMITS } from "./promptUtils";
import { STR } from "./i18n";

describe("settings panel copy", () => {
  it("covers theme language and list limit in all languages", () => {
    const keys = ["settings", "themeL", "themeLight", "themeDark", "langL", "tplLimitL", "closeBtn"];
    for (const k of keys) {
      for (const lang of ["RU", "EN", "KZ"] as const) {
        const v = STR[k][lang];
        expect(typeof v).toBe("string");
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });
  it("keeps limit options in sync with persisted domain", () => {
    expect([...TPL_LIMITS]).toEqual([5, 10, 25, 50]);
  });
});
