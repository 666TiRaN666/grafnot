import { describe, expect, it } from "vitest";
import { STR } from "./i18n";
import { promptPreview } from "./promptUtils";
import type { PromptSave } from "./store";

const IMG: PromptSave = { id: "p1", kind: "image", title: "Blue", model: "SDXL", tokens: ["a", "b"], created: 1 };
const LLM: PromptSave = { id: "p2", kind: "llm", title: "SQL", templateId: "sql", params: { запрос: "SELECT 2", диалект: "pg" }, created: 2 };
const GONE: PromptSave = { id: "p3", kind: "llm", title: "Orphan", templateId: "nope", created: 3 };
const LEGACY: PromptSave = { id: "p4", kind: "llm", title: "Legacy", templateId: "sql", params: { p1: "SELECT 9", p2: "my" }, created: 4 };

describe("prompt preview for search", () => {
  it("renders image syntax", () => {
    expect(promptPreview(IMG, [])).toBe("(a), (b)");
  });
  it("renders saved llm template", () => {
    expect(promptPreview(LLM, []).includes("SELECT 2")).toBe(true);
  });
  it("maps legacy positional params", () => {
    expect(promptPreview(LEGACY, []).includes("SELECT 9")).toBe(true);
  });
  it("falls back to title for missing template", () => {
    expect(promptPreview(GONE, [])).toBe("Orphan");
  });
});

describe("prompt kind copy", () => {
  it("exists in all languages", () => {
    expect(STR.kindPrompt.RU).toBe("промпт");
    expect(STR.kindPrompt.EN).toBe("prompt");
    expect(STR.kindPrompt.KZ).toBe("промпт");
  });
});
