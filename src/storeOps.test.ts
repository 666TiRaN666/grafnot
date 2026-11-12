import { describe, expect, it } from 'vitest';
import type { Note, Store } from './store';
import {
  addNote,
  addPrompt,
  addTemplate,
  changedMembers,
  deleteNoteIn,
  duplicateOf,
  editNote,
  newNote,
  reinsertAt,
  renameWikiMarkers,
  restoreNotesIn,
  restoreTask,
  setGraphMembers,
  toggleGraphMember,
  trashNotesIn,
  trashTask,
  uniqueGraphTitle,
  uniqueNoteTitle,
} from './storeOps';

const note = (id: string, title: string, extra: Partial<Note> = {}): Note => ({ ...newNote(id, title, 1), ...extra });
const store = (extra: Partial<Store> = {}): Store => ({
  notes: [], tasks: [], trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId: '', trashMeta: {}, ...extra,
});

describe('names', () => {
  it('note titles stay unique, an empty title stays empty, the note itself does not clash', () => {
    const notes = [note('a', 'План'), note('b', 'План 2')];
    expect(uniqueNoteTitle(notes, '  План ')).toBe('План 3');
    expect(uniqueNoteTitle(notes, '   ')).toBe('');
    expect(uniqueNoteTitle(notes, 'План', 'a')).toBe('План');
  });
  it('graph titles are never empty', () => {
    const graphs = [{ id: 'g', title: 'Новый граф', noteIds: [] }];
    expect(uniqueGraphTitle(graphs, ' ', 'Новый граф')).toBe('Новый граф 2');
  });
});

describe('Undo puts an item back once, at its place', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  it('returns to the old index, or the end when the list got shorter', () => {
    expect(reinsertAt([a, c], 1, b).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(reinsertAt([a], 5, b).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('a second Undo does not duplicate it', () => {
    expect(reinsertAt([a, b], 0, b).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('notes', () => {
  it('a new note goes on top; only an activating create changes the landing note', () => {
    const s = store({ notes: [note('a', 'A')], activeId: 'a' });
    expect(addNote(s, note('n', 'N'), false).activeId).toBe('a');
    const t = addNote(s, note('n', 'N'), true);
    expect(t.notes.map((n) => n.id)).toEqual(['n', 'a']);
    expect(t.activeId).toBe('n');
  });
  it('an edit stamps the time; a rename rewrites [[markers]] elsewhere without moving those notes', () => {
    const s = store({ notes: [note('a', 'Old'), note('b', 'B', { text: 'see [[Old]]', content: 'see [[Old]]', updated: 5 })] });
    expect(editNote(s, 'a', (n) => ({ ...n, title: 'New' }), 99).notes[0]).toMatchObject({ title: 'New', updated: 99 });
    const r = renameWikiMarkers(s, 'a', 'Old', 'New');
    expect(r.notes[1]).toMatchObject({ text: 'see [[New]]', updated: 5 });
    expect(r.notes[0]).toBe(s.notes[0]);
  });
  it('a copy owns its links and formulas', () => {
    const src = note('a', 'A', { linkedIds: ['b'], calcs: [{ id: 'c', name: 'x', expr: '1' }] });
    const copy = duplicateOf(src, 'n', 'A (копия)', 7);
    expect(copy).toMatchObject({ id: 'n', title: 'A (копия)', updated: 7 });
    expect(copy.linkedIds).not.toBe(src.linkedIds);
    expect(copy.calcs[0]).not.toBe(src.calcs[0]);
  });
  it('deleting one note lands on the first note left', () => {
    const s = store({ notes: [note('a', 'A'), note('b', 'B')], activeId: 'b' });
    const t = deleteNoteIn(s, 'a', 3);
    expect(t.notes.map((n) => n.id)).toEqual(['b']);
    expect(t.trash.map((n) => n.id)).toEqual(['a']);
    expect(t.activeId).toBe('b');
  });
  it('bulk trash keeps the landing note unless it went too, and one Undo brings all back', () => {
    const s = store({ notes: [note('a', 'A'), note('b', 'B'), note('c', 'C')], activeId: 'c' });
    expect(trashNotesIn(s, ['a', 'b'], 3).activeId).toBe('c');
    const t = trashNotesIn(s, ['b', 'c'], 3);
    expect(t.activeId).toBe('a');
    expect(restoreNotesIn(t, ['b', 'c']).notes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('tasks', () => {
  it('trash stamps the time; restore puts the task on top without the stamp', () => {
    const s = store({ tasks: [{ id: 't', text: 'T', done: false }, { id: 'u', text: 'U', done: false }] });
    const t = trashTask(s, 't', 42);
    expect(t.trashTasks[0]).toMatchObject({ id: 't', trashedAt: 42 });
    const r = restoreTask(t, 't');
    expect(r.tasks.map((x) => x.id)).toEqual(['t', 'u']);
    expect(r.tasks[0]).not.toHaveProperty('trashedAt');
  });
});

describe('prompts and templates keep their order rules', () => {
  it('a saved prompt goes first, an own template goes last', () => {
    const s = store({
      prompts: [{ id: 'p1', kind: 'llm', title: 'P1', created: 1 }],
      customTpls: [{ id: 't1', name: 'T1', body: 'b', defaults: {} }],
    });
    expect(addPrompt(s, { id: 'p2', kind: 'llm', title: 'P2', created: 2 }).prompts.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(addTemplate(s, { id: 't2', name: 'T2', body: 'b', defaults: {} }).customTpls.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('graph membership', () => {
  const s = store({ graphs: [{ id: 'g', title: 'G', noteIds: ['a'] }] });
  it('bulk add/remove touches and reports only what changes', () => {
    const g = s.graphs[0];
    if (!g) throw new Error('no graph');
    expect(changedMembers(g, ['a', 'b'], true)).toEqual(['b']);
    expect(setGraphMembers(s, 'g', ['b'], true).graphs[0]?.noteIds).toEqual(['a', 'b']);
    expect(setGraphMembers(s, 'g', ['a'], false).graphs[0]?.noteIds).toEqual([]);
  });
  it('toggle adds and removes one note', () => {
    expect(toggleGraphMember(s, 'g', 'b').graphs[0]?.noteIds).toEqual(['a', 'b']);
    expect(toggleGraphMember(s, 'g', 'a').graphs[0]?.noteIds).toEqual([]);
  });
});
