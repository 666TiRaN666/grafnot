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
import { SCHEMA_VERSION, loadStore, saveStore } from "../store";

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
  it("keeps the existing registry intact after a transient read failure and recovers on retry", () => {
    const original = JSON.stringify({ profiles: [{ id: "p1", name: "One", created: 1 }, { id: "p2", name: "Two", created: 2 }], activeId: "p2" });
    const { map, localStorage } = fakeWindow({ "grafnot-profiles-v1": original, "grafnot-store-p1": "first", "grafnot-store-p2": "second" });
    const get = localStorage.getItem;
    let denied = true;
    localStorage.getItem = (key) => {
      if (key === "grafnot-profiles-v1" && denied) throw new Error("temporary registry read failure");
      return get(key);
    };
    const failed = ensureRegistryCached();
    expect(map.get("grafnot-profiles-v1")).toBe(original);
    expect(failed.registryFailed).toBe(true);
    expect(failed).toHaveProperty("registryReadFailed", true);
    expect(failed.registry.profiles).toEqual([]);
    expect([...map.keys()].sort()).toEqual(["grafnot-profiles-v1", "grafnot-store-p1", "grafnot-store-p2"]);
    denied = false;
    expect(ensureRegistryCached()).toBe(failed);
    resetRegistryCache();
    const recovered = ensureRegistryCached();
    expect(recovered.registry).toEqual(JSON.parse(original));
    expect(recovered.registryFailed).not.toBe(true);
    expect(map.get("grafnot-profiles-v1")).toBe(original);
  });
  it("does not start legacy migration when the registry cannot be read", () => {
    const raw = JSON.stringify({ notes: [legacyNote], tasks: [], activeId: "n1" });
    const { map, localStorage } = fakeWindow({ "grafnot-store-v2": raw, "grafnot-theme": "dark" });
    const get = localStorage.getItem;
    localStorage.getItem = (key) => {
      if (key === "grafnot-profiles-v1") throw new Error("read denied");
      return get(key);
    };
    expect(ensureRegistryCached().registryFailed).toBe(true);
    expect([...map.entries()]).toEqual([["grafnot-store-v2", raw], ["grafnot-theme", "dark"]]);
  });
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
  it("ignores key order and activeId together (seed vs migrated writes)", () => {
    // S3: tab A holds the seed literal, tab B flushed a migrate() rebuild of
    // the same content while navigating. Same store, must harmonize.
    const seedOrder = '{"schemaVersion":5,"notes":[],"activeId":"a"}';
    const migratedOrder = '{"notes":[],"activeId":"b","schemaVersion":5}';
    expect(sameStoreContent(seedOrder, migratedOrder)).toBe(true);
    expect(decideFlush({ base: seedOrder }, migratedOrder)).toBe("write");
    const nestedA = '{"notes":[{"id":"n","title":"t"}],"activeId":"a"}';
    const nestedB = '{"activeId":"b","notes":[{"title":"t","id":"n"}]}';
    expect(sameStoreContent(nestedA, nestedB)).toBe(true);
    const changed = '{"notes":[{"id":"n","title":"other"}],"activeId":"a"}';
    expect(sameStoreContent(nestedA, changed)).toBe(false);
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
  it("preserves unknown fields through profile load, edit, save and reload", () => {
    const extra = { extensionData: { nested: [null, false, { text: "keep" }] }, emptyExtension: null };
    const storage = objStorage({ "grafnot-store-p1": JSON.stringify({ ...JSON.parse(good()), ...extra }) });
    const loaded = loadProfileStore("p1", storage);
    expect(loaded).toHaveProperty("rest", extra);
    if (loaded.kind !== "ok") throw new Error("profile did not load");
    expect(saveStore({ ...loaded.store, tasks: [{ id: "new-task", text: "Edited", done: false }] }, "p1", storage, { rest: loaded.rest })).toBe(true);
    const reloaded = loadProfileStore("p1", storage);
    expect(reloaded).toHaveProperty("rest", extra);
    if (reloaded.kind !== "ok") throw new Error("profile did not reload");
    expect(reloaded.store.tasks[0].text).toBe("Edited");
  });
  it("keeps unknown fields isolated between profiles and absent stores", () => {
    const storage = objStorage({
      "grafnot-store-p1": JSON.stringify({ ...JSON.parse(good()), extensionData: { owner: "one" } }),
      "grafnot-store-p2": JSON.stringify({ ...JSON.parse(good()), otherExtension: [2] }),
    });
    expect(loadProfileStore("p1", storage)).toHaveProperty("rest", { extensionData: { owner: "one" } });
    expect(loadProfileStore("p2", storage)).toHaveProperty("rest", { otherExtension: [2] });
    expect(loadProfileStore("new", storage)).toHaveProperty("rest", {});
  });
  it("blocks read failures without inventing raw data or writing", () => {
    let writes = 0;
    const storage = {
      getItem: () => { throw new Error("read denied"); },
      setItem: () => { writes += 1; },
      removeItem: () => { writes += 1; },
    };
    const result = loadProfileStore("p1", storage);
    expect(result).toEqual({ kind: "blocked", reason: "unavailable", backupKey: null });
    expect(shouldPersist(true, result.kind === "blocked", true)).toBe(false);
    expect(writes).toBe(0);
  });
  it("blocks when accessing localStorage itself throws", () => {
    globalThis.window = Object.defineProperty({}, "localStorage", {
      get: () => { throw new Error("SecurityError"); },
    }) as Window & typeof globalThis;
    expect(loadProfileStore("p1")).toEqual({ kind: "blocked", reason: "unavailable", backupKey: null });
  });
  it("retries a failed read and recovers the original data without writing", () => {
    const raw = good();
    const storage = objStorage({ "grafnot-store-p1": raw });
    const get = storage.getItem;
    let denied = true;
    storage.getItem = (key) => {
      if (denied) throw new Error("read denied");
      return get(key);
    };
    expect(loadProfileStore("p1", storage).kind).toBe("blocked");
    denied = false;
    expect(loadProfileStore("p1", storage).kind).toBe("ok");
    expect(storage.getItem("grafnot-store-p1")).toBe(raw);
    expect(Object.keys(storage).filter((key) => key.includes(":corrupt-"))).toEqual([]);
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
    const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, notes: [], tasks: [], activeId: "" });
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
      rest: {},
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
    for (const raw of ["{oops", JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, notes: [], tasks: [], activeId: "" })]) {
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
  it("keeps legacy and prefs when only registry writes fail, reuses the verified copy on retry", () => {
    const raw = JSON.stringify({ notes: [legacyNote], tasks: [], activeId: "n1" });
    const storage = objStorage({ "grafnot-store-v2": raw, "grafnot-theme": "dark", "grafnot-lang": "EN" });
    globalThis.window = { localStorage: storage } as Window & typeof globalThis;
    const set = storage.setItem;
    let denied = true;
    storage.setItem = (key, value) => {
      if (key === "grafnot-profiles-v1" && denied) throw new Error("registry quota");
      set(key, value);
    };
    const first = ensureRegistryCached();
    expect(first.registry.profiles).toHaveLength(0);
    expect(first.adoption).not.toBe("done");
    expect(storage.getItem("grafnot-store-v2")).toBe(raw);
    expect(storage.getItem("grafnot-theme")).toBe("dark");
    expect(storage.getItem("grafnot-lang")).toBe("EN");
    const copies = () => Object.keys(storage).filter((key) => key.startsWith("grafnot-store-") && key !== "grafnot-store-v2");
    const initialCopies = copies();
    expect(initialCopies).toHaveLength(1);
    resetRegistryCache();
    expect(ensureRegistryCached().registry.profiles).toHaveLength(0);
    expect(copies()).toEqual(initialCopies);
    denied = false;
    resetRegistryCache();
    const final = ensureRegistryCached();
    expect(final.adoption).toBe("done");
    expect(final.registry.profiles).toHaveLength(1);
    expect("grafnot-store-" + final.registry.activeId).toBe(initialCopies[0]);
    expect(copies()).toEqual(initialCopies);
    expect(storage.getItem("grafnot-store-v2")).toBeNull();
    expect(storage.getItem("grafnot-theme:" + final.registry.activeId)).toBe("dark");
    expect(storage.getItem("grafnot-lang:" + final.registry.activeId)).toBe("EN");
    expect(storage.getItem("grafnot-theme")).toBeNull();
    expect(storage.getItem("grafnot-adoption-pending-v1")).toBeNull();
    expect(JSON.parse(storage.getItem(initialCopies[0])!).notes[0].id).toBe("n1");
  });
  it("blocks an empty first launch on registry failure and preserves bare prefs", () => {
    const storage = objStorage({ "grafnot-theme": "dark" });
    globalThis.window = { localStorage: storage } as Window & typeof globalThis;
    const set = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === "grafnot-profiles-v1") throw new Error("registry quota");
      set(key, value);
    };
    expect(ensureRegistryCached().registry.profiles).toHaveLength(0);
    expect(storage.getItem("grafnot-theme")).toBe("dark");
    expect(Object.keys(storage).filter((key) => key.startsWith("grafnot-theme:"))).toEqual([]);
    storage.setItem = set;
    resetRegistryCache();
    const final = ensureRegistryCached();
    expect(final.registry.profiles).toHaveLength(1);
    expect(storage.getItem("grafnot-theme:" + final.registry.activeId)).toBe("dark");
  });
  it("blocks failed registry recovery and retries without changing profile stores", () => {
    const raw = JSON.stringify({ notes: [legacyNote], tasks: [], activeId: "n1" });
    const storage = objStorage({ "grafnot-profiles-v1": "{broken", "grafnot-store-old": raw });
    globalThis.window = { localStorage: storage } as Window & typeof globalThis;
    const set = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === "grafnot-profiles-v1") throw new Error("registry quota");
      set(key, value);
    };
    const failed = ensureRegistryCached();
    expect(failed.registry.profiles).toHaveLength(0);
    expect(failed.recovered).toBe(false);
    expect(storage.getItem("grafnot-profiles-v1")).toBe("{broken");
    expect(storage.getItem("grafnot-store-old")).toBe(raw);
    storage.setItem = set;
    resetRegistryCache();
    const final = ensureRegistryCached();
    expect(final.recovered).toBe(true);
    expect(final.registry.profiles.map((profile) => profile.id)).toEqual(["old"]);
    expect(storage.getItem("grafnot-store-old")).toBe(raw);
  });
  it("does not remove legacy data after a silent registry short write", () => {
    const raw = JSON.stringify({ notes: [legacyNote], tasks: [], activeId: "n1" });
    const storage = objStorage({ "grafnot-store-v2": raw });
    globalThis.window = { localStorage: storage } as Window & typeof globalThis;
    const set = storage.setItem;
    storage.setItem = (key, value) => set(key, key === "grafnot-profiles-v1" ? "{}" : value);
    expect(ensureRegistryCached().adoption).not.toBe("done");
    expect(storage.getItem("grafnot-store-v2")).toBe(raw);
  });
  it.each(["throw", "short-write"])("keeps legacy when the pending destination cannot be saved: %s", (mode) => {
    const raw = JSON.stringify({ notes: [legacyNote], tasks: [], activeId: "n1" });
    const storage = objStorage({ "grafnot-store-v2": raw });
    globalThis.window = { localStorage: storage } as Window & typeof globalThis;
    const set = storage.setItem;
    storage.setItem = (key, value) => {
      if (key === "grafnot-adoption-pending-v1") {
        if (mode === "throw") throw new Error("quota");
        set(key, "{}");
      } else set(key, value);
    };
    expect(ensureRegistryCached().adoption).toBe("failed");
    expect(storage.getItem("grafnot-store-v2")).toBe(raw);
    expect(storage.getItem("grafnot-profiles-v1")).toBeNull();
    expect(Object.keys(storage).filter((key) => key.startsWith("grafnot-store-"))).toEqual(["grafnot-store-v2"]);
  });
  it("verifyStoredMatches compares canonical content", () => {
    const s = objStorage();
    const store = { ...freshStore(), notes: [legacyNote] };
    saveStore(store, "p1", s);
    expect(verifyStoredMatches(s, "p1", { ...store, schemaVersion: SCHEMA_VERSION })).toBe(true);
    s.setItem("grafnot-store-p1", JSON.stringify({ ...store, notes: [], schemaVersion: SCHEMA_VERSION }));
    expect(verifyStoredMatches(s, "p1", { ...store, schemaVersion: SCHEMA_VERSION })).toBe(false);
    expect(verifyStoredMatches(s, "nope", { ...store, schemaVersion: SCHEMA_VERSION })).toBe(false);
  });
});
