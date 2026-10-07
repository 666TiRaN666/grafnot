import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./widgets";

afterEach(() => {
  vi.unstubAllGlobals();
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
