import { describe, expect, it } from "vitest";
import { LIST_PREFS_KEY, TPL_LIMIT_KEY } from "./listPrefs";
import { PREF_KEYS, migrateLegacyPrefs, prefKeyFor } from "./prefs";

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

describe("profile pref keys", () => {
  it("keeps bare keys without profile", () => {
    expect(prefKeyFor("theme")).toBe("grafnot-theme");
    expect(prefKeyFor("lang")).toBe("grafnot-lang");
    expect(prefKeyFor("hint")).toBe("grafnot-hint-first");
  });
  it("suffixes every shell pref with the profile id", () => {
    for (const name of Object.keys(PREF_KEYS) as (keyof typeof PREF_KEYS)[]) {
      expect(prefKeyFor(name, "pf1")).toBe(`${PREF_KEYS[name]}:pf1`);
    }
  });
});

describe("legacy prefs migration", () => {
  it("copies bare prefs into the profile namespace", () => {
    const s = mem({ "grafnot-theme": "dark", "grafnot-lang": "EN", "grafnot-hint-first": "0" });
    const migrated = migrateLegacyPrefs("pf1", s);
    expect(migrated).toEqual(["grafnot-theme", "grafnot-lang", "grafnot-hint-first"]);
    expect(s.raw("grafnot-theme:pf1")).toBe("dark");
    expect(s.raw("grafnot-lang:pf1")).toBe("EN");
    expect(s.raw("grafnot-hint-first:pf1")).toBe("0");
  });
  it("leaves bare keys in place for the caller to remove", () => {
    const s = mem({ "grafnot-theme": "dark" });
    migrateLegacyPrefs("pf1", s);
    expect(s.raw("grafnot-theme")).toBe("dark");
  });
  it("skips missing keys and returns nothing on empty storage", () => {
    expect(migrateLegacyPrefs("pf1", mem())).toEqual([]);
  });
  it("never overwrites existing profile values", () => {
    const s = mem({ "grafnot-theme": "dark", "grafnot-theme:pf1": "light" });
    expect(migrateLegacyPrefs("pf1", s)).toEqual([]);
    expect(s.raw("grafnot-theme:pf1")).toBe("light");
  });
  it("carries the list map and legacy tpl limit along", () => {
    const map = JSON.stringify({ notes: 25 });
    const s = mem({ [LIST_PREFS_KEY]: map, [TPL_LIMIT_KEY]: "5" });
    const migrated = migrateLegacyPrefs("pf1", s);
    expect(migrated).toEqual([LIST_PREFS_KEY, TPL_LIMIT_KEY]);
    expect(s.raw(`${LIST_PREFS_KEY}:pf1`)).toBe(map);
    expect(s.raw(`${TPL_LIMIT_KEY}:pf1`)).toBe("5");
  });
  it("reads the second profile's own lang, never the bare key", () => {
    const s = mem({ "grafnot-lang": "EN", "grafnot-lang:pf2": "KZ" });
    expect(s.getItem(prefKeyFor("lang", "pf2"))).toBe("KZ");
    expect(s.getItem(prefKeyFor("lang"))).toBe("EN");
    const migrated = migrateLegacyPrefs("pf2", s);
    expect(migrated).not.toContain("grafnot-lang");
    expect(s.raw("grafnot-lang:pf2")).toBe("KZ");
  });
});
