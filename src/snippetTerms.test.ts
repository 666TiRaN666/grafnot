import { describe, expect, it } from "vitest";
import { STR } from "./i18n";

const SNIP_KEYS = ["snipT", "snipLecture", "snipEnt", "snipProj", "toastSnipApplied"];

describe("note snippet terms", () => {
  it("calls note inserts заготовки not шаблоны", () => {
    expect(STR.snipT.RU).toBe("Заготовки");
    expect(STR.snipT.EN).toBe("Snippets");
    expect(STR.snipT.KZ).toBe("Дайындамалар");
    expect(STR.toastSnipApplied.RU).toBe("Заготовка вставлена");
    expect(STR.toastSnipApplied.EN).toBe("Snippet inserted");
    expect(STR.toastSnipApplied.KZ).toBe("Дайындама қойылды");
  });
  it("keeps snippet copy free of template wording", () => {
    const gone = ["tmplT", "tplLecture", "tplEnt", "tplProj", "toastTplApplied"];
    for (const k of gone) expect(STR[k]).toBeUndefined();
    for (const k of SNIP_KEYS) {
      expect(STR[k].RU).not.toMatch(/шаблон/i);
      expect(STR[k].EN).not.toMatch(/template/i);
      expect(STR[k].KZ).not.toMatch(/үлгі/i);
    }
  });
});
