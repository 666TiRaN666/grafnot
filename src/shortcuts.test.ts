import { describe, expect, it } from "vitest";
import { STR } from "./i18n";
import { SHORTCUTS } from "./shortcuts";

describe("shortcuts help copy", () => {
  it("declares title and all three hotkeys in all languages", () => {
    expect(STR.shortcutsT.RU).toBe("Горячие клавиши");
    expect(STR.shortcutsT.EN).toBe("Keyboard shortcuts");
    expect(STR.shortcutsT.KZ).toBe("Жылдам пернелер");
    const rows: Array<[string, string, string, string]> = [
      ["scSearch", "Глобальный поиск", "Global search", "Жаһандық іздеу"],
      ["scPanels", "Сбросить панели", "Reset panels", "Панельдерді қалпына келтіру"],
      ["scNew", "Новая заметка", "New note", "Жаңа жазба"],
    ];
    for (const [k, ru, en, kz] of rows) {
      expect(STR[k].RU).toBe(ru);
      expect(STR[k].EN).toBe(en);
      expect(STR[k].KZ).toBe(kz);
    }
  });
});

describe("shortcuts registry", () => {
  it("has unique ids, known label keys in all languages, non-empty key hints", () => {
    const dict = STR as unknown as Record<string, { RU: string; EN: string; KZ: string }>;
    const ids = new Set<string>();
    const combos = new Set<string>();
    for (const s of SHORTCUTS) {
      expect(s.id).toBeTruthy();
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.keys.trim()).not.toBe("");
      // P2: one combination per scope at most (same keys in different
      // scopes are fine — handlers are section-scoped).
      const combo = `${s.scope}:${s.keys}`;
      expect(combos.has(combo)).toBe(false);
      combos.add(combo);
      const e = dict[s.labelKey];
      expect(e).toBeTruthy();
      expect(e.RU).toBeTruthy();
      expect(e.EN).toBeTruthy();
      expect(e.KZ).toBeTruthy();
    }
    expect(SHORTCUTS.length).toBe(16);
  });
});
