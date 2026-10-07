import { describe, expect, it } from "vitest";
import { STR } from "./i18n";

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
