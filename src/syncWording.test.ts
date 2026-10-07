import { describe, expect, it } from "vitest";
import { STR, tr } from "./i18n";

describe("no cloud sync wording", () => {
  it("declares honest saved-locally status in all languages", () => {
    expect(STR.savedLocal.RU).toBe("Сохранено локально");
    expect(STR.savedLocal.EN).toBe("Saved locally");
    expect(STR.savedLocal.KZ).toBe("Жергілікті сақталды");
  });
  it("keeps no sync illusion in user facing strings", () => {
    const gone = ["saved", "synced", "syncNow", "syncing", "toastSynced", "syncStats", "syncT", "syncSub"];
    for (const k of gone) expect(STR[k]).toBeUndefined();
    for (const row of Object.values(STR)) {
      expect(row.RU).not.toMatch(/синхрон/i);
      expect(row.EN).not.toMatch(/sync/i);
      expect(row.KZ).not.toMatch(/синк|үндест/i);
    }
  });
  it("never leaks raw keys into the UI", () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(tr("noSuchKey", "RU")).toBe("—");
      expect(tr("noSuchKey", "EN")).toBe("—");
    } finally {
      console.warn = warn;
    }
  });
});
