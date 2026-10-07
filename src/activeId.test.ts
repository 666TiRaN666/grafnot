import { describe, expect, it } from "vitest";
import { consumeActiveIdReset, settleStore } from "./storage/profileBoot";
import type { Store } from "./store";

function storeWith(activeId: string, ids: string[]): Store {
  return {
    notes: ids.map((id) => ({ id, title: id, content: "", text: "", linkedIds: [], calcs: [], updated: 1 })),
    tasks: [],
    trash: [],
    trashTasks: [],
    graphs: [],
    prompts: [],
    customTpls: [],
    activeId,
  };
}

describe("settleStore activeId", () => {
  it("keeps a valid activeId silently", () => {
    const s = settleStore(storeWith("a", ["a", "b"]));
    expect(s.activeId).toBe("a");
    expect(consumeActiveIdReset()).toBe(false);
  });
  it("resets a dangling activeId to '' without promoting notes[0]", () => {
    const s = settleStore(storeWith("ghost", ["a", "b"]));
    expect(s.activeId).toBe("");
    expect(consumeActiveIdReset()).toBe(true);
    expect(consumeActiveIdReset()).toBe(false);
  });
  it("keeps an empty activeId silent (no toast loop)", () => {
    const s = settleStore(storeWith("", ["a"]));
    expect(s.activeId).toBe("");
    expect(consumeActiveIdReset()).toBe(false);
  });
});
