import { describe, expect, it } from 'vitest';
import {
  LEGACY_STORE_KEY,
  SCHEMA_VERSION,
  appendPromptText,
  brokenIds,
  loadStore,
  loadStoreResult,
  migrate,
  readLegacyStore,
  saveStore,
  storeKeyFor,
  unlinkedNotes,
  filterTasks,
} from './store';
import type { LoadResult, LooseStore, LooseTpl } from './store';

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
    has: (k: string) => m.has(k),
  };
}

const legacy = (): LooseStore => ({
  notes: [
    { id: 'a', title: 'Alpha', notebook: 'HCI', content: '', text: 'a', linked: ['Beta', 'Ghost', 'Beta'] },
    { id: 'b', title: 'Beta', notebook: 'HCI', content: '', text: 'b', linked: [] },
    { id: 'c', title: 'Solo', notebook: 'Math', content: '', text: 'c', linked: [] },
  ],
  tasks: [],
  activeId: 'a',
});

describe('v1 -> v2 migration', () => {
  it('converts title links to ids, counts missing targets', () => {
    const { store, droppedLinks } = migrate(legacy());
    expect(store.notes.find((n) => n.id === 'a')?.linkedIds).toEqual(['b']);
    expect(droppedLinks).toBe(1);
    expect(store.notes).toHaveLength(3);
    expect('notebook' in (store.notes[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('puts every note into at least its notebook graph', () => {
    const { store } = migrate(legacy());
    const hci = store.graphs.find((g) => g.title === 'HCI');
    const math = store.graphs.find((g) => g.title === 'Math');
    expect(hci?.noteIds.slice().sort()).toEqual(['a', 'b']);
    expect(math?.noteIds).toEqual(['c']);
    const member = new Set(store.graphs.flatMap((g) => g.noteIds));
    for (const n of store.notes) expect(member.has(n.id)).toBe(true);
  });

  it('keeps pre-existing memberships and merges notebook fill', () => {
    const raw = legacy();
    raw.graphs = [{ id: 'g1', title: 'Fav', noteIds: ['c'] }];
    const { store } = migrate(raw);
    const fav = store.graphs.find((g) => g.id === 'g1');
    expect(fav?.noteIds).toContain('c');
    expect(store.graphs.find((g) => g.title === 'Math')?.noteIds).toContain('c');
  });
});

describe('v5 -> v6 image templates (UX-03)', () => {
  it('keeps kind, model and tokens; old entries stay valid; junk fields drop', () => {
    const { store } = migrate({
      ...legacy(),
      schemaVersion: 5,
      customTpls: [
        { id: 'i1', name: 'Img', body: 'a and b', defaults: {}, kind: 'image', model: 'Flux', tokens: ['((a))', 'b'] },
        { id: 'i0', name: 'Old', body: '(a)', defaults: {}, kind: 'image' },
        { id: 't0', name: 'Txt', body: 'x {{y}}', defaults: { y: '1' } },
        { id: 'bad', name: 'Bad', body: 'q', defaults: {}, kind: 'image', model: 'Midjourney', tokens: [1, 'ok'] },
      ] as never,
    });
    expect(store.customTpls).toEqual([
      { id: 'i1', name: 'Img', body: 'a and b', defaults: {}, kind: 'image', model: 'Flux', tokens: ['((a))', 'b'] },
      { id: 'i0', name: 'Old', body: '(a)', defaults: {}, kind: 'image' },
      { id: 't0', name: 'Txt', body: 'x {{y}}', defaults: { y: '1' } },
      { id: 'bad', name: 'Bad', body: 'q', defaults: {}, kind: 'image' },
    ]);
  });
});

describe('v3 -> v4 migration', () => {
  it('bumps schema and defaults customTpls, keeps prompts', () => {
    expect(SCHEMA_VERSION).toBe(7);
    const { store } = migrate({
      ...legacy(),
      prompts: [{ id: 'p1', kind: 'image', title: 't', model: 'Pony', tokens: ['a'], created: 1 }],
    });
    expect(store.customTpls).toEqual([]);
    expect(store.prompts).toHaveLength(1);
  });

  it('converts legacy fixed-field templates to slot bodies', () => {
    const { store } = migrate({
      ...legacy(),
      customTpls: [
        { id: 'c1', title: 'Ревью {{p1}}', p1label: 'Запрос', p1: 'SELECT 1', p2label: 'Диалект', p2: 'pg' },
        { id: 'bad', title: 5 } as unknown as LooseTpl,
      ],
    });
    expect(store.customTpls.map((t) => t.id)).toEqual(['c1']);
    expect(store.customTpls[0]).toEqual({
      id: 'c1',
      name: 'Ревью',
      body: 'Ревью {{Запрос}}',
      defaults: { Запрос: 'SELECT 1', Диалект: 'pg' },
    });
  });

  it('dedupes colliding slot labels', () => {
    const { store } = migrate({
      ...legacy(),
      customTpls: [{ id: 'c2', title: 'T {{p1}} {{p2}}', p1label: 'X', p2label: 'X' }],
    });
    expect(store.customTpls[0].body).toBe('T {{X}} {{X_2}}');
  });

  it('passes v4 templates through untouched (reload-safe)', () => {
    const tpl = { id: 'c9', name: 'N', body: 'Hi {{who}}', defaults: { who: 'Bob' } };
    const once = migrate({ ...legacy(), customTpls: [tpl] });
    expect(once.store.customTpls).toEqual([tpl]);
    const twice = migrate({ ...once.store, customTpls: once.store.customTpls });
    expect(twice.store.customTpls).toEqual([tpl]);
  });
});

describe("v4 -> v5 task trash", () => {
  it("defaults trashTasks for old payloads", () => {
    const { store } = migrate(legacy());
    expect(store.trashTasks).toEqual([]);
  });
  it("drops non-array trashTasks and keeps tasks", () => {
    const raw = { ...legacy(), trashTasks: "junk" } as unknown as LooseStore;
    const { store } = migrate(raw);
    expect(store.trashTasks).toEqual([]);
  });
  it("passes existing task trash through untouched", () => {
    const t = { id: "t1", text: "Old", done: false };
    const { store } = migrate({ ...legacy(), trashTasks: [t] });
    expect(store.trashTasks).toEqual([t]);
  });
});

describe('v6 -> v7 trash restore records (D3)', () => {
  const trashedNote = { id: 't', title: 'Old', content: '', text: 'x', linkedIds: [], calcs: [], updated: 1 };
  it('bumps the schema to 7', () => {
    expect(SCHEMA_VERSION).toBe(7);
  });
  it('defaults trashMeta to {} for v6 payloads', () => {
    const { store } = migrate({ ...legacy(), schemaVersion: 6 });
    expect(store.trashMeta).toEqual({});
  });
  it('keeps valid records of trashed notes and drops the rest', () => {
    const { store, droppedItems, rest } = migrate({
      ...legacy(),
      schemaVersion: 7,
      trash: [trashedNote],
      trashMeta: {
        t: { incoming: ['a', 5, 'b'], graphs: ['g1'], at: 9 },
        gone: { incoming: ['a'], graphs: [], at: 1 },
        bad: 'nope',
      },
    } as unknown as LooseStore);
    expect(store.trashMeta).toEqual({ t: { incoming: ['a', 'b'], graphs: ['g1'], at: 9 } });
    expect(droppedItems).toBe(2);
    expect(rest).not.toHaveProperty('trashMeta');
  });
  it('survives a non-object trashMeta', () => {
    const { store } = migrate({ ...legacy(), schemaVersion: 7, trashMeta: [1, 2] } as unknown as LooseStore);
    expect(store.trashMeta).toEqual({});
  });
  it('round-trips through save and load', () => {
    const s = mem();
    const loaded = migrate({ ...legacy(), schemaVersion: 7, trash: [trashedNote], trashMeta: { t: { incoming: ['a'], graphs: [], at: 3 } } } as unknown as LooseStore).store;
    expect(saveStore(loaded, 'pf1', s)).toBe(true);
    const back = loadStoreResult('pf1', s);
    expect(back.status).toBe('ok');
    expect(back.store?.trashMeta).toEqual({ t: { incoming: ['a'], graphs: [], at: 3 } });
    expect(JSON.parse(s.getItem(storeKeyFor('pf1')) ?? '{}').schemaVersion).toBe(7);
  });
});

describe('graph helpers', () => {
  it('unlinkedNotes finds isolates by id', () => {
    const { store } = migrate(legacy());
    expect(unlinkedNotes(store.notes).map((n) => n.id)).toEqual(['c']);
  });

  it('brokenIds lists dangling refs only', () => {
    const { store } = migrate(legacy());
    expect(brokenIds(store.notes)).toEqual([]);
    const broken = {
      ...store,
      notes: store.notes.map((n) => (n.id === 'a' ? { ...n, linkedIds: [...n.linkedIds, 'zzz'] } : n)),
    };
    expect(brokenIds(broken.notes)).toEqual([{ id: 'zzz', usedIn: 1 }]);
  });
});
describe('appendPromptText', () => {
  it('appends a paragraph to an empty JSON doc', () => {
    const r = appendPromptText({ type: 'doc', content: [] }, '', 'hi');
    expect(r.text).toBe('hi');
    expect(JSON.stringify(r.content)).toContain('hi');
  });

  it('concats text cache with newline', () => {
    const r = appendPromptText({ type: 'doc', content: [] }, 'old', 'new');
    expect(r.text).toBe('old\nnew');
  });

  it('keeps multi-line text verbatim as a code block (UX-02)', () => {
    const code = 'def f():\n    return 1';
    const j = appendPromptText({ type: 'doc', content: [] }, '', code);
    expect(j.content).toEqual({ type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: code }] }] });
    expect(j.text).toBe(code);
    expect(appendPromptText('', '', code).content).toBe('<pre><code>def f():\n    return 1</code></pre>');
  });

  it('escapes HTML in legacy string content', () => {
    const r = appendPromptText('<p>a</p>', 'a', 'x<y>&z');
    expect(r.content).toContain('&lt;y&gt;');
    expect(r.content).toContain('&amp;');
    expect(r.content).not.toContain('<y>');
  });
});

describe("per-profile store keys", () => {
  it("isolates payloads by profile id", () => {
    const s = mem();
    const a = migrate({ ...legacy(), activeId: "a" }).store;
    saveStore(a, "pf1", s);
    expect(loadStore("pf1", s)?.store?.activeId).toBe("a");
    expect(loadStore("pf2", s)).toBeNull();
    const b = migrate({ ...legacy(), activeId: "b" }).store;
    saveStore(b, "pf2", s);
    expect(loadStore("pf1", s)?.store?.activeId).toBe("a");
    expect(loadStore("pf2", s)?.store?.activeId).toBe("b");
  });
  it("keeps the legacy key path working without profile id", () => {
    const s = mem();
    saveStore(migrate(legacy()).store, undefined, s);
    expect(s.has(LEGACY_STORE_KEY)).toBe(true);
    expect(loadStore(undefined, s)?.store?.notes).toHaveLength(3);
    expect(loadStore("pf1", s)).toBeNull();
  });
  it("derives per-profile keys from the id", () => {
    expect(storeKeyFor("pf1")).toBe("grafnot-store-pf1");
    expect(storeKeyFor("pf1")).not.toBe(LEGACY_STORE_KEY);
  });
  it("returns null for missing or corrupt payloads", () => {
    expect(loadStore("pf1", mem())).toBeNull();
    expect(loadStore("pf1", mem({ [storeKeyFor("pf1")]: "{oops" }))).toBeNull();
  });
  it("reports write success and quota failure", () => {
    const s = mem();
    const store = migrate(legacy()).store;
    expect(saveStore(store, "pf1", s)).toBe(true);
    expect(s.has(storeKeyFor("pf1"))).toBe(true);
    const failing = {
      getItem: (_k: string): string | null => null,
      setItem: (_k: string, _v: string): void => {
        throw new Error("quota");
      },
      removeItem: (_k: string): void => {},
    };
    expect(saveStore(store, "pf1", failing)).toBe(false);
    expect(saveStore(store, undefined, failing)).toBe(false);
  });
  it("keeps the last-good payload intact when a write fails", () => {
    const inner = mem();
    const store = migrate(legacy()).store;
    expect(saveStore(store, "pf1", inner)).toBe(true);
    const good = inner.getItem(storeKeyFor("pf1"));
    let writes = 0;
    const quota = {
      getItem: inner.getItem,
      setItem: (_k: string, _v: string): void => {
        writes += 1;
        throw new Error("quota");
      },
      removeItem: inner.removeItem,
    };
    expect(saveStore(store, "pf1", quota)).toBe(false);
    expect(writes).toBe(1);
    expect(inner.getItem(storeKeyFor("pf1"))).toBe(good);
    expect(loadStore("pf1", inner)?.store?.activeId).toBe(store.activeId);
  });
});

describe("legacy store migration", () => {
  it("reads the pre-profiles payload through migration", () => {
    const s = mem({ [LEGACY_STORE_KEY]: JSON.stringify(legacy()) });
    const store = readLegacyStore(s)?.store;
    expect(store?.notes.find((n) => n.id === "a")?.linkedIds).toEqual(["b"]);
    expect(store?.graphs.length).toBeGreaterThan(0);
    expect(store?.activeId).toBe("a");
  });
  it("returns null when there is nothing to migrate", () => {
    expect(readLegacyStore(mem())).toBeNull();
  });
  it("leaves the legacy key in place for the caller to remove", () => {
    const s = mem({ [LEGACY_STORE_KEY]: JSON.stringify(legacy()) });
    readLegacyStore(s);
    expect(s.has(LEGACY_STORE_KEY)).toBe(true);
  });
});

describe("versioned migration without losses", () => {
  const trashed = {
    id: "t",
    title: "Old",
    content: "<p>x</p>",
    text: "x",
    linkedIds: ["b"],
    calcs: [{ id: "c1", name: "n", expr: "1+1" }],
    updated: 42,
  };
  it("keeps trash fields instead of resetting them", () => {
    const { store } = migrate({ ...legacy(), trash: [trashed] });
    expect(store.trash).toEqual([trashed]);
  });
  it("never rewrites existing updated stamps", () => {
    const missing = migrate(legacy());
    expect(typeof missing.store.notes[0].updated).toBe("number");
    const stamped = migrate({
      ...legacy(),
      notes: legacy().notes.map((n) => ({ ...n, updated: 7 })),
    });
    expect(stamped.store.notes.every((n) => n.updated === 7)).toBe(true);
  });
  it("leaves v5 membership alone (no notebook injection)", () => {
    const v5 = {
      schemaVersion: 5,
      notes: [
        { id: "m1", title: "One", content: "", text: "", linkedIds: [], calcs: [], updated: 1 },
        { id: "m2", title: "Two", content: "", text: "", linkedIds: [], calcs: [], updated: 2 },
      ],
      tasks: [],
      trash: [],
      trashTasks: [],
      graphs: [{ id: "g1", title: "Team", noteIds: ["m1"] }],
      prompts: [],
      customTpls: [],
      activeId: "m1",
    };
    const { store, droppedLinks } = migrate(v5);
    expect(store.graphs).toEqual([{ id: "g1", title: "Team", noteIds: ["m1"] }]);
    expect(droppedLinks).toBe(0);
  });
  it("is idempotent through the save/load cycle", () => {
    const once = migrate(legacy());
    const stamped = { ...once.store, schemaVersion: 5 };
    const twice = migrate(stamped);
    expect(twice.store).toEqual(once.store);
    expect(twice.droppedLinks).toBe(0);
  });
  it("still fills notebook graphs for unversioned payloads with graphs", () => {
    const raw = legacy();
    raw.graphs = [{ id: "g1", title: "Fav", noteIds: ["c"] }];
    const { store } = migrate(raw);
    expect(store.graphs.find((g) => g.title === "Math")?.noteIds).toContain("c");
  });
  it("does not resurrect an HCI graph when versionless payload already has graphs", () => {
    const raw: LooseStore = {
      notes: [{ id: "a", title: "A", content: "", text: "", linkedIds: [] }],
      tasks: [],
      graphs: [{ id: "g1", title: "Math", noteIds: ["a"] }],
      activeId: "a",
    };
    const { store } = migrate(raw);
    expect(store.graphs.find((g) => g.title === "HCI")).toBeUndefined();
    expect(store.graphs).toEqual([{ id: "g1", title: "Math", noteIds: ["a"] }]);
  });
  it("keeps v1 notebook adoption for versionless payloads without graphs", () => {
    const { store } = migrate(legacy());
    expect(store.graphs.find((g) => g.title === "HCI")?.noteIds.slice().sort()).toEqual(["a", "b"]);
  });
});

describe("safe loading (LoadResult)", () => {
  it("drops invalid elements and counts them, never throws", () => {
    const s = mem({
      [storeKeyFor("pf1")]: JSON.stringify({
        notes: [null],
        tasks: [null],
        trash: [],
        trashTasks: [{}],
        graphs: [null],
        prompts: [1],
        customTpls: [],
        activeId: "",
      }),
    });
    let r: LoadResult | undefined;
    expect(() => {
      r = loadStoreResult("pf1", s);
    }).not.toThrow();
    expect(r!.status).toBe("ok");
    expect(r!.store!.notes).toEqual([]);
    expect(r!.store!.tasks).toEqual([]);
    expect(r!.store!.trashTasks).toEqual([]);
    expect(r!.store!.graphs).toEqual([]);
    expect(r!.store!.prompts).toEqual([]);
    expect(r!.droppedItems).toBe(5);
    expect(r!.droppedLinks).toBe(0);
  });
  it("keeps valid elements untouched while dropping garbage around them", () => {
    const good = { id: "t1", text: "Old", done: false, noteId: "a" };
    const { store, droppedItems } = migrate({
      ...legacy(),
      tasks: [good, null, { id: 7 }] as unknown as LooseStore["tasks"],
    });
    expect(store.tasks[0]).toBe(good);
    expect(store.tasks).toHaveLength(1);
    expect(droppedItems).toBe(2);
  });
  it("reports corrupt for truncated JSON and non-objects, keeps raw", () => {
    const s = mem({ [storeKeyFor("pf1")]: "{oops", [storeKeyFor("pf2")]: "[1,2]" });
    const c1 = loadStoreResult("pf1", s);
    expect(c1.status).toBe("corrupt");
    expect(c1.raw).toBe("{oops");
    expect(c1.store).toBeUndefined();
    const c2 = loadStoreResult("pf2", s);
    expect(c2.status).toBe("corrupt");
    expect(c2.raw).toBe("[1,2]");
    expect(loadStoreResult("px", s).status).toBe("absent");
    expect(loadStore("pf1", s)).toBeNull();
  });
  it("reports future for newer schemaVersion without touching data", () => {
    const payload = JSON.stringify({ ...migrate(legacy()).store, schemaVersion: SCHEMA_VERSION + 1, next: true });
    const s = mem({ [storeKeyFor("pf1")]: payload });
    const r = loadStoreResult("pf1", s);
    expect(r.status).toBe("future");
    expect(r.store).toBeUndefined();
    expect(r.raw).toBe(payload);
    expect(loadStore("pf1", s)).toBeNull();
  });
  it("forbids saveStore for future payloads at API level", () => {
    const payload = JSON.stringify({ ...migrate(legacy()).store, schemaVersion: SCHEMA_VERSION + 1 });
    const s = mem({ [storeKeyFor("pf1")]: payload });
    expect(saveStore(migrate(legacy()).store, "pf1", s, { status: "future" })).toBe(false);
    expect(s.getItem(storeKeyFor("pf1"))).toBe(payload);
  });
  it("preserves unknown top-level fields through save/load", () => {
    const m = migrate({ ...legacy(), extra: { foo: 1 } } as LooseStore);
    expect(m.rest).toEqual({ extra: { foo: 1 } });
    const s = mem();
    expect(saveStore(m.store, "pf1", s, { rest: m.rest })).toBe(true);
    expect(JSON.parse(s.getItem(storeKeyFor("pf1")) as string).extra).toEqual({ foo: 1 });
    expect(loadStoreResult("pf1", s).status).toBe("ok");
  });
});

describe("filterTasks pipeline", () => {
  const all = [
    { id: "a", text: "Fix login button", desc: "auth form", done: false },
    { id: "b", text: "Login audit", done: true },
    { id: "c", text: "Write docs", desc: "LOGIN guide", done: false },
  ];
  it("filters by status", () => {
    expect(filterTasks(all, "active", "").map((t) => t.id)).toEqual(["a", "c"]);
    expect(filterTasks(all, "done", "").map((t) => t.id)).toEqual(["b"]);
    expect(filterTasks(all, "all", "").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
  it("searches text and desc case insensitively after status", () => {
    expect(filterTasks(all, "all", "login").map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(filterTasks(all, "active", "login").map((t) => t.id)).toEqual(["a", "c"]);
    expect(filterTasks(all, "done", "login").map((t) => t.id)).toEqual(["b"]);
    expect(filterTasks(all, "active", "audit")).toEqual([]);
  });
});
