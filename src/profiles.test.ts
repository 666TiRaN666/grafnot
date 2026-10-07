import { describe, expect, it } from "vitest";
import {
  PROFILES_KEY,
  createProfile,
  deleteProfile,
  emptyRegistry,
  loadProfiles,
  loadProfilesResult,
  profileKeysFor,
  recoverRegistryFromStores,
  removeProfileData,
  renameProfile,
  saveProfiles,
  setActiveProfile,
} from "./profiles";

function mem(backing?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(backing ?? {}));
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    raw: (k: string) => m.get(k),
    has: (k: string) => m.has(k),
  };
}

describe("profiles", () => {
  it("loads an empty registry from fresh storage", () => {
    expect(loadProfiles(mem())).toEqual({ profiles: [], activeId: "" });
  });
  it("creates the first profile and activates it", () => {
    const { registry, profile } = createProfile(emptyRegistry(), "Учёба", 1000);
    expect(profile).toEqual({ id: "pf1000", name: "Учёба", created: 1000 });
    expect(registry.profiles).toHaveLength(1);
    expect(registry.activeId).toBe("pf1000");
  });
  it("activates each newly created profile", () => {
    let reg = emptyRegistry();
    reg = createProfile(reg, "A", 1).registry;
    reg = createProfile(reg, "B", 2).registry;
    expect(reg.activeId).toBe("pf2");
    expect(reg.profiles.map((p) => p.name)).toEqual(["A", "B"]);
  });
  it("rejects blank names on create and rename", () => {
    expect(() => createProfile(emptyRegistry(), "")).toThrow("profile name required");
    expect(() => createProfile(emptyRegistry(), "   ")).toThrow("profile name required");
    const reg = createProfile(emptyRegistry(), "A", 1).registry;
    expect(() => renameProfile(reg, "pf1", "  ")).toThrow("profile name required");
  });
  it("dedups names with a numeric suffix", () => {
    let reg = emptyRegistry();
    reg = createProfile(reg, "Учёба", 1).registry;
    reg = createProfile(reg, "Учёба", 2).registry;
    reg = createProfile(reg, "Учёба", 3).registry;
    expect(reg.profiles.map((p) => p.name)).toEqual(["Учёба", "Учёба 2", "Учёба 3"]);
  });
  it("renames and dedups against other profiles only", () => {
    let reg = emptyRegistry();
    reg = createProfile(reg, "A", 1).registry;
    reg = createProfile(reg, "B", 2).registry;
    const renamed = renameProfile(reg, "pf1", "B");
    expect(renamed.profiles.find((p) => p.id === "pf1")?.name).toBe("B 2");
    const same = renameProfile(reg, "pf1", "A");
    expect(same.profiles.find((p) => p.id === "pf1")?.name).toBe("A");
  });
  it("rejects unknown ids", () => {
    const reg = createProfile(emptyRegistry(), "A", 1).registry;
    expect(() => renameProfile(reg, "nope", "X")).toThrow("profile not found");
    expect(() => deleteProfile(reg, "nope")).toThrow("profile not found");
    expect(() => setActiveProfile(reg, "nope")).toThrow("profile not found");
  });
  it("deletes and falls back to the first remaining profile", () => {
    let reg = emptyRegistry();
    reg = createProfile(reg, "A", 1).registry;
    reg = createProfile(reg, "B", 2).registry;
    reg = createProfile(reg, "C", 3).registry;
    expect(reg.activeId).toBe("pf3");
    reg = deleteProfile(reg, "pf3");
    expect(reg.profiles.map((p) => p.id)).toEqual(["pf1", "pf2"]);
    expect(reg.activeId).toBe("pf1");
    reg = deleteProfile(reg, "pf1");
    expect(reg.profiles.map((p) => p.id)).toEqual(["pf2"]);
    expect(reg.activeId).toBe("pf2");
  });
  it("refuses to delete the last profile", () => {
    const reg = createProfile(emptyRegistry(), "A", 1).registry;
    expect(() => deleteProfile(reg, "pf1")).toThrow("cannot delete the last profile");
  });
  it("switches the active profile", () => {
    let reg = emptyRegistry();
    reg = createProfile(reg, "A", 1).registry;
    reg = createProfile(reg, "B", 2).registry;
    reg = setActiveProfile(reg, "pf1");
    expect(reg.activeId).toBe("pf1");
  });
  it("round-trips through storage", () => {
    const s = mem();
    let reg = emptyRegistry();
    reg = createProfile(reg, "Учёба", 1000).registry;
    saveProfiles(reg, s);
    expect(s.has(PROFILES_KEY)).toBe(true);
    expect(loadProfiles(s)).toEqual(reg);
  });
  it("falls back to empty on corrupt data", () => {
    expect(loadProfiles(mem({ [PROFILES_KEY]: "{oops" }))).toEqual(emptyRegistry());
    expect(loadProfiles(mem({ [PROFILES_KEY]: "[1,2]" }))).toEqual(emptyRegistry());
    expect(loadProfiles(mem({ [PROFILES_KEY]: JSON.stringify({}) }))).toEqual(emptyRegistry());
    expect(loadProfiles(mem({ [PROFILES_KEY]: JSON.stringify({ profiles: [{ id: 1 }] }) }))).toEqual(
      emptyRegistry(),
    );
  });
  it("repairs a dangling active id to the first profile", () => {
    const s = mem({
      [PROFILES_KEY]: JSON.stringify({
        profiles: [
          { id: "pf1", name: "A", created: 1 },
          { id: "pf2", name: "B", created: 2 },
        ],
        activeId: "ghost",
      }),
    });
    expect(loadProfiles(s).activeId).toBe("pf1");
  });
  it("keeps ids unique for same-millisecond creates", () => {
    let reg = emptyRegistry();
    const a = createProfile(reg, "A", 7);
    reg = a.registry;
    const b = createProfile(reg, "B", 7);
    expect(a.profile.id).toBe("pf7");
    expect(b.profile.id).not.toBe("pf7");
    expect(new Set(b.registry.profiles.map((p) => p.id)).size).toBe(2);
  });
  it("does not mutate the input registry", () => {
    const reg = createProfile(emptyRegistry(), "A", 1).registry;
    const snapshot = JSON.parse(JSON.stringify(reg));
    renameProfile(reg, "pf1", "Renamed");
    deleteProfile(createProfile(reg, "B", 2).registry, "pf1");
    expect(reg).toEqual(snapshot);
  });
});

describe("profile data cleanup", () => {
  it("lists the store plus every namespaced pref key", () => {
    const keys = profileKeysFor("pf1");
    expect(keys.store).toBe("grafnot-store-pf1");
    expect(keys.prefs).toEqual([
      "grafnot-theme:pf1",
      "grafnot-lang:pf1",
      "grafnot-side:pf1",
      "grafnot-right:pf1",
      "grafnot-hint-first:pf1",
      "grafnot-list-limits:pf1",
      "grafnot-tpl-limit:pf1",
    ]);
  });
  it("removes every owned key and reports success", () => {
    const keys = profileKeysFor("pf1");
    const s = mem(Object.fromEntries([keys.store, ...keys.prefs].map((k) => [k, "v"])));
    expect(removeProfileData("pf1", s)).toBe(true);
    for (const k of [keys.store, ...keys.prefs]) expect(s.has(k)).toBe(false);
  });
  it("reports failure when a key survives removal", () => {
    const keys = profileKeysFor("pf1");
    const s = mem(Object.fromEntries([keys.store, ...keys.prefs].map((k) => [k, "v"])));
    const throwing = { ...s, removeItem: (_k: string) => { throw new Error("quota"); } };
    expect(removeProfileData("pf1", throwing)).toBe(false);
    const stuck = { ...s, removeItem: (_k: string) => { /* silently keeps the key */ } };
    expect(removeProfileData("pf1", stuck)).toBe(false);
  });
  it("leaves other profiles, the registry and bare keys alone", () => {
    const victim = profileKeysFor("pf1");
    const other = profileKeysFor("pf2");
    const s = mem({
      [victim.store]: "v",
      [`${victim.prefs[0]}`]: "v",
      [other.store]: "v",
      [`${other.prefs[0]}`]: "v",
      [PROFILES_KEY]: "{}",
      "grafnot-store-v2": "v",
      "grafnot-theme": "v",
    });
    removeProfileData("pf1", s);
    expect(s.has(victim.store)).toBe(false);
    expect(s.has(victim.prefs[0])).toBe(false);
    expect(s.has(other.store)).toBe(true);
    expect(s.has(other.prefs[0])).toBe(true);
    expect(s.has(PROFILES_KEY)).toBe(true);
    expect(s.has("grafnot-store-v2")).toBe(true);
    expect(s.has("grafnot-theme")).toBe(true);
  });
  it("reports success when the profile owns no keys", () => {
    expect(removeProfileData("pf1", mem())).toBe(true);
  });
});

describe("registry corruption and recovery (STAGE_08, red first)", () => {
  it("loadProfilesResult reports corrupt with raw instead of silent empty", () => {
    const raws = [
      "{oops",
      "[1,2]",
      JSON.stringify({}),
      JSON.stringify({ profiles: [{ id: 7, name: "X" }] }),
    ];
    for (const raw of raws) {
      const r = loadProfilesResult(mem({ [PROFILES_KEY]: raw }));
      expect(r.status).toBe("corrupt");
      if (r.status === "corrupt") expect(r.raw).toBe(raw);
    }
  });
  it("loadProfilesResult distinguishes absent from ok", () => {
    expect(loadProfilesResult(mem()).status).toBe("absent");
    const reg = createProfile(emptyRegistry(), "A", 1).registry;
    const s = mem();
    saveProfiles(reg, s);
    const r = loadProfilesResult(s);
    expect(r.status).toBe("ok");
    expect(r.registry).toEqual(reg);
  });
  it("saveProfiles reports failure instead of swallowing it", () => {
    const reg = createProfile(emptyRegistry(), "A", 1).registry;
    const throwing = {
      ...mem(),
      setItem: (_k: string, _v: string) => {
        throw new Error("quota");
      },
    };
    expect(saveProfiles(reg, throwing)).toBe(false);
    const ok = mem();
    expect(saveProfiles(reg, ok)).toBe(true);
  });
  it("never deletes the store before prefs (prefs-first order)", () => {
    const keys = profileKeysFor("pf1");
    const s = mem(Object.fromEntries([keys.store, ...keys.prefs].map((k) => [k, "v"])));
    const prefOnlyThrow = {
      ...s,
      removeItem: (k: string) => {
        if (k !== keys.store) throw new Error("quota");
        s.removeItem(k);
      },
    };
    expect(removeProfileData("pf1", prefOnlyThrow)).toBe(false);
    expect(prefOnlyThrow.has(keys.store)).toBe(true);
  });
  it("rebuilds the registry from store keys in deterministic order", () => {
    const keys = [
      "grafnot-store-pf2",
      "grafnot-store-pf1",
      PROFILES_KEY,
      "grafnot-store-v2",
      "grafnot-store-pf1:corrupt-123",
      "grafnot-theme:pf1",
    ];
    const reg = recoverRegistryFromStores(keys, (n) => `Профиль ${n}`);
    expect(reg.profiles.map((p) => p.id)).toEqual(["pf1", "pf2"]);
    expect(reg.profiles.map((p) => p.name)).toEqual(["Профиль 1", "Профиль 2"]);
    expect(reg.activeId).toBe("pf1");
  });
  it("recovers empty when only backups and legacy exist", () => {
    expect(recoverRegistryFromStores(["grafnot-store-v2", "grafnot-store-pf9:corrupt-1"], (n) => `P${n}`)).toEqual({
      profiles: [],
      activeId: "",
    });
  });
});
