import { describe, expect, it } from 'vitest';
import type { Note, Store } from './store';
import { expireTrash, purgeNote, restoreNote, trashNote, TRASH_DAY_MS } from './trashRestore';

const note = (id: string, linkedIds: string[] = [], text = id): Note => ({
  id,
  title: id.toUpperCase(),
  content: '',
  text,
  linkedIds,
  calcs: [],
  updated: 1,
});

// a -> b, c -> b; b and a in graph g1, b in g2.
const base = (): Store => ({
  notes: [note('a', ['b']), note('b', ['a']), note('c', ['b'])],
  tasks: [],
  trash: [],
  trashTasks: [],
  graphs: [
    { id: 'g1', title: 'G1', noteIds: ['a', 'b'] },
    { id: 'g2', title: 'G2', noteIds: ['b'] },
  ],
  prompts: [],
  customTpls: [],
  activeId: 'b',
  trashMeta: {},
});
const byId = (s: Store, id: string) => s.notes.find((n) => n.id === id);
const graph = (s: Store, id: string) => s.graphs.find((g) => g.id === id);

describe('trashNote', () => {
  it('moves the note to the trash and records what pointed at it', () => {
    const s = trashNote(base(), 'b', 100);
    expect(byId(s, 'b')).toBeUndefined();
    expect(s.trash.map((n) => n.id)).toEqual(['b']);
    expect(s.trashMeta?.b).toEqual({ incoming: ['a', 'c'], graphs: ['g1', 'g2'], at: 100 });
  });
  it('removes incoming links and graph membership instead of leaving them dangling', () => {
    const s = trashNote(base(), 'b', 100);
    expect(byId(s, 'a')?.linkedIds).toEqual([]);
    expect(byId(s, 'c')?.linkedIds).toEqual([]);
    expect(graph(s, 'g1')?.noteIds).toEqual(['a']);
    expect(graph(s, 'g2')?.noteIds).toEqual([]);
  });
  it('keeps the trashed note own outgoing links', () => {
    const s = trashNote(base(), 'b', 100);
    expect(s.trash[0].linkedIds).toEqual(['a']);
  });
});

describe('restoreNote', () => {
  it('restores incoming links and graph membership', () => {
    const s = restoreNote(trashNote(base(), 'b', 100), 'b');
    expect(byId(s, 'b')).toBeDefined();
    expect(byId(s, 'a')?.linkedIds).toEqual(['b']);
    expect(byId(s, 'c')?.linkedIds).toEqual(['b']);
    expect(graph(s, 'g1')?.noteIds).toEqual(['a', 'b']);
    expect(graph(s, 'g2')?.noteIds).toEqual(['b']);
    expect(s.trash).toEqual([]);
    expect(s.trashMeta?.b).toBeUndefined();
  });
  it('keeps edits made after the deletion', () => {
    const t = trashNote(base(), 'b', 100);
    const edited: Store = { ...t, notes: t.notes.map((n) => (n.id === 'a' ? { ...n, text: 'edited', linkedIds: ['c'] } : n)) };
    const s = restoreNote(edited, 'b');
    expect(byId(s, 'a')?.text).toBe('edited');
    expect(byId(s, 'a')?.linkedIds).toEqual(['c', 'b']);
  });
  it('skips sources and graphs that are gone since', () => {
    const t = trashNote(base(), 'b', 100);
    const gone: Store = { ...t, notes: t.notes.filter((n) => n.id !== 'c'), graphs: t.graphs.filter((g) => g.id !== 'g2') };
    const s = restoreNote(gone, 'b');
    expect(byId(s, 'c')).toBeUndefined();
    expect(s.graphs.map((g) => g.id)).toEqual(['g1']);
    expect(graph(s, 'g1')?.noteIds).toEqual(['a', 'b']);
  });
  it('never duplicates a link or a membership', () => {
    const t = trashNote(base(), 'b', 100);
    const relinked: Store = {
      ...t,
      notes: t.notes.map((n) => (n.id === 'a' ? { ...n, linkedIds: ['b'] } : n)),
      graphs: t.graphs.map((g) => (g.id === 'g1' ? { ...g, noteIds: ['a', 'b'] } : g)),
    };
    const s = restoreNote(relinked, 'b');
    expect(byId(s, 'a')?.linkedIds).toEqual(['b']);
    expect(graph(s, 'g1')?.noteIds).toEqual(['a', 'b']);
  });
  it('restores a trashed note without a record (deleted before v7) alone', () => {
    const old: Store = { ...base(), notes: [note('a')], trash: [note('b', ['a'])], trashMeta: undefined };
    const s = restoreNote(old, 'b');
    expect(byId(s, 'b')?.linkedIds).toEqual(['a']);
    expect(byId(s, 'a')?.linkedIds).toEqual([]);
    expect(s.trash).toEqual([]);
  });
});

describe('purgeNote', () => {
  it('drops the note and its restore record', () => {
    const s = purgeNote(trashNote(base(), 'b', 100), 'b');
    expect(s.trash).toEqual([]);
    expect(s.trashMeta?.b).toBeUndefined();
  });
});

describe('expireTrash', () => {
  const now = 100 * TRASH_DAY_MS;
  const aged = (): Store => {
    let s = trashNote(base(), 'b', now - 40 * TRASH_DAY_MS);
    s = trashNote(s, 'c', now - 5 * TRASH_DAY_MS);
    return {
      ...s,
      trash: [...s.trash, note('legacy')],
      trashTasks: [
        { id: 'old', text: 'old', done: false, trashedAt: now - 31 * TRASH_DAY_MS },
        { id: 'new', text: 'new', done: false, trashedAt: now - 1 * TRASH_DAY_MS },
        { id: 'unknown', text: 'unknown', done: false },
      ],
    };
  };
  it('removes notes and tasks deleted longer ago than the limit, with their restore records', () => {
    const r = expireTrash(aged(), 30, now);
    expect(r.removed).toBe(2);
    expect(r.store.trash.map((n) => n.id).sort()).toEqual(['c', 'legacy']);
    expect(r.store.trashTasks.map((t) => t.id)).toEqual(['new', 'unknown']);
    expect(r.store.trashMeta?.b).toBeUndefined();
    expect(r.store.trashMeta?.c).toBeDefined();
  });
  it('keeps entries whose deletion time is unknown, and does nothing when off', () => {
    const s = aged();
    expect(expireTrash(s, 0, now)).toEqual({ store: s, removed: 0 });
    expect(expireTrash(s, 30, now).store.trash.some((n) => n.id === 'legacy')).toBe(true);
  });
});
