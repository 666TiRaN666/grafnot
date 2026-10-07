import { afterEach, describe, expect, it } from "vitest";
import {
  decideFlush,
  ensureRegistryCached,
  freshStore,
  loadProfileStore,
  nextSaveState,
  resetRegistryCache,
  sameStoreContent,
  shouldPersist,
  verifyStoredMatches,
} from "./profileBoot";
import { loadStore, saveStore } from "../store";

function fakeWindow(backing: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(backing));
  const localStorage = {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
  (globalThis as unknown as { window?: unknown }).window = { localStorage };
  return { map: m, localStorage };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  resetRegistryCache();
});

const legacyNote = { id: "n1", title: "Old", content: "", text: "hello", linkedIds: [], calcs: [], updated: 5 };

describe("profileBoot", () => {
  it("boots once: a repeated initializer run duplicates nothing", () => {
    const { map, localStorage } = fakeWindow({
      "grafnot-store-v2": JSON.stringify({ notes: [legacyNote], tasks: [], activeId: "n1" }),
      "grafnot-lang": "EN",
    });
    const first = ensureRegistryCached();
    const second = ensureRegistryCached();
    expect(second).toEqual(first);
    expect(first.registry.profiles).toHaveLength(1);
    const id = first.registry.activeId;
    // legacy store adopted into the new profile exactly once
    const adopted = loadStore(id, localStorage)?.store;
    expect(adopted?.notes.map((n) => n.title)).toEqual(["Old"]);
    expect(map.has("grafnot-store-v2")).toBe(false);
    expect(map.has("grafnot-lang")).toBe(false);
  });
  it("creates a single default profile from empty storage", () => {
    fakeWindow();
    const first = ensureRegistryCached();
    expect(ensureRegistryCached()).toEqual(first);
    expect(first.registry.profiles).toHaveLength(1);
    expect(first.droppedLinks).toBe(0);
  });
});

describe("nextSaveState", () => {
  it.each([
    ["saved", "edit", "pending"],
    ["pending", "edit", "pending"],
    ["failed", "edit", "failed"],
    ["pending", "ok", "saved"],
    ["failed", "ok", "saved"],
    ["pending", "fail", "failed"],
    ["saved", "fail", "failed"],
    ["failed", "retry", "pending"],
    ["saved", "reset", "saved"],
    ["failed", "reset", "saved"],
    ["saved", "conflict", "conflict"],
    ["pending", "conflict", "conflict"],
    ["failed", "conflict", "conflict"],
    ["conflict", "edit", "conflict"],
    ["conflict", "retry", "pending"],
    ["conflict", "ok", "saved"],
    ["conflict", "fail", "conflict"],
    ["conflict", "reset", "saved"],
  ])("%s + %s -> %s", (prev, event, want) => {
    expect(nextSaveState(prev as never, event as never)).toBe(want);
  });
});

describe("decideFlush", () => {
  const pend = { base: "raw1" };
  it("has nothing to write without pending", () => {
    expect(decideFlush(null, "raw1")).toBe("nothing");
    expect(decideFlush(null, null)).toBe("nothing");
  });
  it("skips stale snapshots instead of clobbering", () => {
    expect(decideFlush(pend, "raw2")).toBe("stale");
    expect(decideFlush(pend, null)).toBe("stale");
  });
  it("writes when storage matches the snapshot base", () => {
    expect(decideFlush(pend, "raw1")).toBe("write");
    expect(decideFlush({ base: null }, null)).toBe("write");
  });
  it("ignores activeId-only moves (cross-tab navigation)", () => {
    const a = JSON.stringify({ notes: [], activeId: "a" });
    const b = JSON.stringify({ notes: [], activeId: "b" });
    expect(sameStoreContent(a, a)).toBe(true);
    expect(sameStoreContent(a, b)).toBe(true);
    expect(sameStoreContent(null, null)).toBe(true);
    expect(sameStoreContent(a, null)).toBe(false);
    expect(sameStoreContent(a, "{oops")).toBe(false);
    expect(decideFlush({ base: a }, b)).toBe("write");
    const c = JSON.stringify({ notes: [{ id: "n" }], activeId: "b" });
    expect(sameStoreContent(a, c)).toBe(false);
    expect(decideFlush({ base: a }, c)).toBe("stale");
  });
});

describe("shouldPersist", () => {
  it.each([
    [false, false, false, false],
    [false, false, true, true],
    [false, true, false, false],
    [false, true, true, false],
    [true, false, false, true],
    [true, false, true, true],
    [true, true, false, false],
    [true, true, true, false],
  ])("dirty=%s blocked=%s pending=%s -> %s", (dirty, blocked, pending, want) => {
    expect(shouldPersist(dirty, blocked, pending)).toBe(want);
  });
});

function objStorage(initial: Record<string, string> = {}) {
  const self: Record<string, unknown> = {
    ...initial,
    getItem: (k: string) => (typeof self[k] === "string" ? (self[k] as string) : null),
    setItem: (k: string, v: string) => {
      self[k] = v;
    },
    removeItem: (k: string) => {
      delete self[k];
    },
  };
  return self as unknown as {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
  };
}

describe("loadProfileStore", () => {
  const good = () =>
    JSON.stringify({
      schemaVersion: 5,
      notes: [],
      tasks: [],
      trash: [],
      trashTasks: [],
      graphs: [],
      prompts: [],
      customTpls: [],
      activeId: "",
    });
  it("loads a valid store with drop counts", () => {
    const s = objStorage({ "grafnot-store-p1": good() });
    const r = loadProfileStore("p1", s);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.store.notes).toEqual([]);
      expect(r.droppedLinks).toBe(0);
      expect(r.droppedItems).toBe(0);
    }
  });
  it("blocks corrupt payloads, backs them up, keeps raw", () => {
    const raw = '{"notes": [broken';
    const s = objStorage({ "grafnot-store-p1": raw });
    const r = loadProfileStore("p1", s);
    expect(r.kind).toBe("blocked");
    if (r.kind === "blocked") {
      expect(r.reason).toBe("corrupt");
      expect(r.raw).toBe(raw);
      expect(r.backupKey).toMatch(/^grafnot-store-p1:corrupt-/);
      expect(s.getItem(r.backupKey as string)).toBe(raw);
      expect(s.getItem("grafnot-store-p1")).toBe(raw);
    }
  });
  it("blocks future payloads", () => {
    const raw = JSON.stringify({ schemaVersion: 6, notes: [], tasks: [], activeId: "" });
    const s = objStorage({ "grafnot-store-p1": raw });
    const r = loadProfileStore("p1", s);
    expect(r.kind).toBe("blocked");
    if (r.kind === "blocked") {
      expect(r.reason).toBe("future");
      expect(r.raw).toBe(raw);
      expect(r.backupKey).toMatch(/^grafnot-store-p1:corrupt-/);
    }
  });
  it("keeps at most two backups per key", () => {
    const raw = "{oops";
    const s = objStorage({
      "grafnot-store-p1": raw,
      "grafnot-store-p1:corrupt-1": "old1",
      "grafnot-store-p1:corrupt-2": "old2",
    });
    const r = loadProfileStore("p1", s);
    expect(r.kind).toBe("blocked");
    const backs = Object.keys(s).filter((k) => k.startsWith("grafnot-store-p1:corrupt-"));
    expect(backs).toHaveLength(2);
    expect(backs.some((k) => s.getItem(k) === raw)).toBe(true);
  });
  it("treats absent payloads as a clean empty start", () => {
    expect(loadProfileStore("p1", objStorage())).toEqual({
      kind: "ok",
      store: freshStore(),
      droppedLinks: 0,
      droppedItems: 0,
    });
  });
});

describe("legacy adoption under quota and damage (STAGE_09, red first)", () => {
  function quotaWindow(backing: Record<string, string>, cap: number) {
    const m = new Map<string, string>(Object.entries(backing));
    let used = [...m.values()].reduce((a, v) => a + v.length, 0);
    const localStorage = {
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        if (used + v.length > cap) throw new Error("QuotaExceededError");
        used += v.length;
        m.set(k, v);
      },
      removeItem: (k: string) => {
        m.delete(k);
      },
    };
    (globalThis as unknown as { window?: unknown }).window = { localStorage };
    return m;
  }
  const bigLegacy = () =>
    JSON.stringify({
      notes: [{ id: "n1", title: "Big", content: "", text: "x".repeat(20000), linkedIds: [], calcs: [], updated: 1 }],
      tasks: [],
      activeId: "n1",
    });
  it("fails loudly when the adopted copy does not fit next to the original", () => {
    const legacy = bigLegacy();
    const m = quotaWindow({ "grafnot-store-v2": legacy }, legacy.length + 1000);
    const first = ensureRegistryCached();
    expect(first.adoption).toBe("failed");
    // No phantom profile in memory, no registry on disk, legacy intact.
    expect(first.registry.profiles).toHaveLength(0);
    expect(m.has("grafnot-profiles-v1")).toBe(false);
    expect(m.get("grafnot-store-v2")).toBe(legacy);
    const storesBefore = [...m.keys()].filter((k) => k.startsWith("grafnot-store-"));
    // A second launch creates nothing new: no random profiles pile up.
    resetRegistryCache();
    const second = ensureRegistryCached();
    expect(second.adoption).toBe("failed");
    expect([...m.keys()].filter((k) => k.startsWith("grafnot-store-"))).toEqual(storesBefore);
  });
  it("waits for an explicit choice when legacy is unreadable", () => {
    for (const raw of ["{oops", JSON.stringify({ schemaVersion: 6, notes: [], tasks: [], activeId: "" })]) {
      const { map } = fakeWindow({ "grafnot-store-v2": raw });
      resetRegistryCache();
      const r = ensureRegistryCached();
      expect(r.adoption).toBe("blocked");
      expect(r.registry.profiles).toHaveLength(0);
      expect(map.has("grafnot-profiles-v1")).toBe(false);
      expect(map.get("grafnot-store-v2")).toBe(raw);
    }
  });
  it("adopts a fitting legacy store with a verified write", () => {
    fakeWindow({
      "grafnot-store-v2": JSON.stringify({ notes: [legacyNote], tasks: [], activeId: "n1" }),
    });
    const r = ensureRegistryCached();
    expect(r.adoption).toBe("done");
    expect(r.registry.profiles).toHaveLength(1);
  });
  it("verifyStoredMatches compares canonical content", () => {
    const s = objStorage();
    const store = { ...freshStore(), notes: [legacyNote] };
    saveStore(store, "p1", s);
    expect(verifyStoredMatches(s, "p1", { ...store, schemaVersion: 5 })).toBe(true);
    s.setItem("grafnot-store-p1", JSON.stringify({ ...store, notes: [], schemaVersion: 5 }));
    expect(verifyStoredMatches(s, "p1", { ...store, schemaVersion: 5 })).toBe(false);
    expect(verifyStoredMatches(s, "nope", { ...store, schemaVersion: 5 })).toBe(false);
  });
});
