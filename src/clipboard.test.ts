import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./widgets";
import { exportMemory } from "./exportRaw";
import { freshStore } from "./storage/profileBoot";
import { SCHEMA_VERSION } from "./store";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exportMemory", () => {
  it("exports unknown fields from the live snapshot and keeps owned fields authoritative", () => {
    let payload = "";
    vi.stubGlobal("Blob", class {
      constructor(parts: unknown[]) { payload = String(parts[0]); }
    });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:memory", revokeObjectURL: () => {} });
    vi.stubGlobal("document", { createElement: () => ({ click() {} }), body: { appendChild() {} } });
    vi.stubGlobal("window", { setTimeout: () => 0 });
    expect(exportMemory(freshStore(), { extra: { keep: [1, null] }, notes: "foreign", schemaVersion: 99 })).toBe(true);
    expect(JSON.parse(payload)).toMatchObject({ extra: { keep: [1, null] }, notes: [], schemaVersion: SCHEMA_VERSION });
  });
});

describe("copyText", () => {
  it("resolves true through the async clipboard API", async () => {
    const writeText = vi.fn(async (_s: string) => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });
  it("resolves false when clipboard rejects and no document fallback exists", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async (_s: string) => {
          throw new Error("denied");
        },
      },
    });
    await expect(copyText("hello")).resolves.toBe(false);
  });
});
