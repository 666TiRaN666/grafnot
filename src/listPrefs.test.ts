import { describe, expect, it } from "vitest";
import {
  LIST_PREFS_KEY,
  TPL_LIMIT_DEFAULT,
  TPL_LIMIT_KEY,
  listPrefsKeyFor,
  loadListLimit,
  saveListLimit,
  tplLimitKeyFor,
} from "./listPrefs";
import { TPL_LIMITS, loadTplLimit, parseTplLimit, saveTplLimit } from "./promptUtils";

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

describe("list limits", () => {
  it("reads default limit for fresh storage", () => {
    const s = mem();
    expect(loadListLimit("notes", s)).toBe(TPL_LIMIT_DEFAULT);
    expect(loadListLimit("tasks", s)).toBe(TPL_LIMIT_DEFAULT);
    expect(loadListLimit("mapMembers", s)).toBe(TPL_LIMIT_DEFAULT);
    expect(loadListLimit("prompts", s)).toBe(TPL_LIMIT_DEFAULT);
  });
  it("saves and loads each list key independently", () => {
    const s = mem();
    saveListLimit("notes", 25, s);
    saveListLimit("tasks", 5, s);
    expect(loadListLimit("notes", s)).toBe(25);
    expect(loadListLimit("tasks", s)).toBe(5);
    expect(loadListLimit("prompts", s)).toBe(TPL_LIMIT_DEFAULT);
    expect(loadListLimit("mapMembers", s)).toBe(TPL_LIMIT_DEFAULT);
  });
  it("rejects unknown sizes and broken maps", () => {
    expect(loadListLimit("notes", mem({ [LIST_PREFS_KEY]: "7" }))).toBe(TPL_LIMIT_DEFAULT);
    expect(loadListLimit("notes", mem({ [LIST_PREFS_KEY]: "{oops" }))).toBe(TPL_LIMIT_DEFAULT);
    expect(loadListLimit("notes", mem({ [LIST_PREFS_KEY]: "[5]" }))).toBe(TPL_LIMIT_DEFAULT);
    expect(loadListLimit("notes", mem({ [LIST_PREFS_KEY]: JSON.stringify({ notes: 7 }) }))).toBe(
      TPL_LIMIT_DEFAULT,
    );
    expect(loadListLimit("notes", mem({ [LIST_PREFS_KEY]: JSON.stringify({ notes: "25" }) }))).toBe(25);
    expect(loadListLimit("notes", mem({ [LIST_PREFS_KEY]: JSON.stringify({ notes: "big" }) }))).toBe(
      TPL_LIMIT_DEFAULT,
    );
  });
  it("inherits legacy bare value for prompts only", () => {
    const s = mem({ [TPL_LIMIT_KEY]: "5" });
    expect(loadListLimit("prompts", s)).toBe(5);
    expect(loadListLimit("tasks", s)).toBe(TPL_LIMIT_DEFAULT);
    expect(loadListLimit("notes", s)).toBe(TPL_LIMIT_DEFAULT);
  });
  it("prefers the map over legacy and migrates on save", () => {
    const s = mem({ [TPL_LIMIT_KEY]: "5", [LIST_PREFS_KEY]: JSON.stringify({ prompts: 25 }) });
    expect(loadListLimit("prompts", s)).toBe(25);
    saveListLimit("prompts", 50, s);
    expect(s.has(TPL_LIMIT_KEY)).toBe(false);
    expect(loadListLimit("prompts", s)).toBe(50);
    const kept = mem({ [TPL_LIMIT_KEY]: "5" });
    saveListLimit("notes", 25, kept);
    expect(loadListLimit("prompts", kept)).toBe(5);
    expect(loadListLimit("notes", kept)).toBe(25);
    expect(kept.has(TPL_LIMIT_KEY)).toBe(false);
  });
  it("namespaces keys per profile, bare key stays the legacy path", () => {
    expect(listPrefsKeyFor()).toBe(LIST_PREFS_KEY);
    expect(listPrefsKeyFor("pf1")).toBe(`${LIST_PREFS_KEY}:pf1`);
    expect(tplLimitKeyFor()).toBe(TPL_LIMIT_KEY);
    expect(tplLimitKeyFor("pf1")).toBe(`${TPL_LIMIT_KEY}:pf1`);
  });
  it("isolates list limits by profile", () => {
    const s = mem();
    saveListLimit("notes", 25, s, "pf1");
    expect(loadListLimit("notes", s, "pf1")).toBe(25);
    expect(loadListLimit("notes", s, "pf2")).toBe(TPL_LIMIT_DEFAULT);
    expect(loadListLimit("notes", s)).toBe(TPL_LIMIT_DEFAULT);
    saveListLimit("notes", 5, s, "pf2");
    expect(loadListLimit("notes", s, "pf1")).toBe(25);
  });
  it("scopes the legacy fallback to the profile's own key", () => {
    const s = mem({ [`${TPL_LIMIT_KEY}:pf1`]: "5", [TPL_LIMIT_KEY]: "25" });
    expect(loadListLimit("prompts", s, "pf1")).toBe(5);
    expect(loadListLimit("prompts", s, "pf2")).toBe(TPL_LIMIT_DEFAULT);
    expect(loadListLimit("prompts", s)).toBe(25);
  });
  it("migrates the profile legacy value into the profile map", () => {
    const s = mem({ [`${TPL_LIMIT_KEY}:pf1`]: "5" });
    saveListLimit("notes", 25, s, "pf1");
    expect(s.has(`${TPL_LIMIT_KEY}:pf1`)).toBe(false);
    expect(loadListLimit("prompts", s, "pf1")).toBe(5);
    expect(loadListLimit("notes", s, "pf1")).toBe(25);
  });
  it("never touches the bare map for profile saves", () => {
    const s = mem();
    saveListLimit("notes", 25, s, "pf1");
    saveListLimit("tasks", 5, s, "pf2");
    expect(s.has(LIST_PREFS_KEY)).toBe(false);
    expect(loadListLimit("notes", s)).toBe(TPL_LIMIT_DEFAULT);
    expect(loadListLimit("notes", s, "pf1")).toBe(25);
    expect(loadListLimit("tasks", s, "pf2")).toBe(5);
  });
  it("keeps old prompt imports working", () => {
    expect([...TPL_LIMITS]).toEqual([5, 10, 25, 50]);
    expect(parseTplLimit("5")).toBe(5);
    const s = mem();
    saveTplLimit(25, s);
    expect(loadTplLimit(s)).toBe(25);
  });
});
