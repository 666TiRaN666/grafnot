import type { CalcBlock, Graph, Note, PromptSave, Store, TaskItem } from './store';
import type { LlmTpl } from './data';
import { appendPromptText } from './store';
import { renameWikiLinks } from './wikiText';
import { restoreNote, trashNote } from './trashRestore';

/**
 * Store transitions: every user change to notes, tasks, prompts, templates,
 * graphs and formulas is a pure function `(store, …) => store` here (2026-11:
 * moved out of App.tsx, where ~40 inline setStore lambdas repeated the same
 * rules — «unique name» twice, «put back at its place» four times). App.tsx
 * keeps the wiring: ids and time, toasts, Undo, the route. Note trash with
 * exact restore stays in trashRestore.ts. Loading, migration and saving are
 * not here (store.ts, storage/profileBoot.ts).
 */

// ---------- shared rules ----------

/** `base`, or `base 2`, `base 3`… — the first one nobody has. */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/** Undo of a removal: the item goes back to its old index (or the end), once. */
export function reinsertAt<T extends { id: string }>(list: T[], index: number, item: T): T[] {
  if (list.some((x) => x.id === item.id)) return list;
  const next = [...list];
  next.splice(Math.min(index, next.length), 0, item);
  return next;
}

const mapById = <T extends { id: string }>(list: T[], id: string, fn: (x: T) => T): T[] => list.map((x) => (x.id === id ? fn(x) : x));

// ---------- notes ----------

/** Explicit titles stay unique; an empty title needs no suffix (the note is named by its text). */
export function uniqueNoteTitle(notes: Note[], base: string, ignoreId?: string): string {
  const clean = base.trim();
  if (!clean) return '';
  return uniqueName(clean, new Set(notes.filter((n) => n.id !== ignoreId).map((n) => n.title)));
}

export function newNote(id: string, title: string, now: number, body: { content?: Note['content']; text?: string; linkedIds?: string[] } = {}): Note {
  return { id, title, content: body.content ?? '', text: body.text ?? '', linkedIds: body.linkedIds ?? [], calcs: [], updated: now };
}

/** New note on top of the list; `activate` makes it the landing note. */
export function addNote(s: Store, note: Note, activate: boolean): Store {
  return { ...s, notes: [note, ...s.notes], ...(activate ? { activeId: note.id } : {}) };
}

/** A change made in the note itself: it moves up (updated). */
export function editNote(s: Store, id: string, fn: (n: Note) => Note, now: number): Store {
  return { ...s, notes: mapById(s.notes, id, (n) => ({ ...fn(n), updated: now })) };
}

/** [[Old]] markers in other notes follow a rename; those notes keep their place (not an edit of theirs). */
export function renameWikiMarkers(s: Store, renamedId: string, oldName: string, nextName: string): Store {
  return {
    ...s,
    notes: s.notes.map((n) => {
      if (n.id === renamedId) return n;
      const r = renameWikiLinks(n.content, n.text, oldName, nextName);
      return r ? { ...n, content: r.content, text: r.text } : n;
    }),
  };
}

/** A copy that opens as a new note: own links and formulas, a «(copy)» title when there was one. */
export function duplicateOf(src: Note, id: string, title: string, now: number): Note {
  return { ...src, id, title, linkedIds: [...src.linkedIds], calcs: src.calcs.map((c) => ({ ...c })), updated: now };
}

/** One note to the trash; the landing note becomes the first one left. */
export function deleteNoteIn(s: Store, id: string, now: number): Store {
  const t = trashNote(s, id, now);
  return { ...t, activeId: t.notes[0]?.id ?? '' };
}

/** Several notes to the trash in one change; the landing note stays unless it went too. */
export function trashNotesIn(s: Store, ids: string[], now: number): Store {
  const t = ids.reduce((acc, id) => trashNote(acc, id, now), s);
  return { ...t, activeId: t.notes.some((n) => n.id === t.activeId) ? t.activeId : (t.notes[0]?.id ?? '') };
}

/** Undo of a bulk trash: each note that is still in the trash comes back. */
export function restoreNotesIn(s: Store, ids: string[]): Store {
  return ids.reduce((acc, id) => (acc.trash.some((x) => x.id === id) ? restoreNote(acc, id) : acc), s);
}

/** Map drag-a-link: one direction, not an edit of the note text (no `updated`). */
export function linkNotes(s: Store, fromId: string, toId: string): Store {
  return { ...s, notes: s.notes.map((n) => (n.id === fromId && !n.linkedIds.includes(toId) ? { ...n, linkedIds: [...n.linkedIds, toId] } : n)) };
}

export function unlinkNotes(s: Store, fromId: string, toId: string): Store {
  return { ...s, notes: mapById(s.notes, fromId, (n) => ({ ...n, linkedIds: n.linkedIds.filter((x) => x !== toId) })) };
}

/** A dangling reference leaves every note at once. */
export function purgeLinkTo(s: Store, id: string): Store {
  return { ...s, notes: s.notes.map((n) => (n.linkedIds.includes(id) ? { ...n, linkedIds: n.linkedIds.filter((x) => x !== id) } : n)) };
}

/** Prompt text appended to a note (an edit of the note). */
export function appendToNoteIn(s: Store, noteId: string, text: string, now: number): Store {
  return editNote(s, noteId, (n) => ({ ...n, ...appendPromptText(n.content, n.text, text) }), now);
}

// ---------- formulas (inside a note) ----------

export function withCalc(n: Note, calc: CalcBlock): Note {
  return { ...n, calcs: [...n.calcs, calc] };
}

export function patchCalc(n: Note, id: string, patch: Partial<CalcBlock>): Note {
  return { ...n, calcs: mapById(n.calcs, id, (c) => ({ ...c, ...patch })) };
}

export function withoutCalc(n: Note, id: string): Note {
  return { ...n, calcs: n.calcs.filter((c) => c.id !== id) };
}

// ---------- tasks ----------

/** New task on top of the list. */
export function addTask(s: Store, task: TaskItem): Store {
  return { ...s, tasks: [task, ...s.tasks] };
}

export function patchTask(s: Store, id: string, patch: Partial<Pick<TaskItem, 'text' | 'desc' | 'due'>>): Store {
  return { ...s, tasks: mapById(s.tasks, id, (x) => ({ ...x, ...patch })) };
}

export function toggleTaskDone(s: Store, id: string): Store {
  return { ...s, tasks: mapById(s.tasks, id, (x) => ({ ...x, done: !x.done })) };
}

/** Task to the trash, stamped with the time (auto-cleanup counts from it). */
export function trashTask(s: Store, id: string, now: number): Store {
  const victim = s.tasks.find((x) => x.id === id);
  if (!victim) return s;
  return { ...s, tasks: s.tasks.filter((x) => x.id !== id), trashTasks: [{ ...victim, trashedAt: now }, ...s.trashTasks] };
}

export function restoreTask(s: Store, id: string): Store {
  const found = s.trashTasks.find((x) => x.id === id);
  if (!found) return s;
  const { trashedAt: _gone, ...t } = found;
  return { ...s, trashTasks: s.trashTasks.filter((x) => x.id !== id), tasks: [t, ...s.tasks] };
}

export function purgeTask(s: Store, id: string): Store {
  return { ...s, trashTasks: s.trashTasks.filter((x) => x.id !== id) };
}

// ---------- saved prompts and own templates ----------

/** New saved prompt on top. */
export function addPrompt(s: Store, p: PromptSave): Store {
  return { ...s, prompts: [p, ...s.prompts] };
}

export function patchPrompt(s: Store, id: string, patch: Partial<Pick<PromptSave, 'title' | 'noteId'>>): Store {
  return { ...s, prompts: mapById(s.prompts, id, (x) => ({ ...x, ...patch })) };
}

export function removePrompt(s: Store, id: string): Store {
  return { ...s, prompts: s.prompts.filter((x) => x.id !== id) };
}

export function restorePromptAt(s: Store, index: number, p: PromptSave): Store {
  return { ...s, prompts: reinsertAt(s.prompts, index, p) };
}

/** Own templates keep their creation order: a new one goes last. */
export function addTemplate(s: Store, t: LlmTpl): Store {
  return { ...s, customTpls: [...s.customTpls, t] };
}

export function replaceTemplate(s: Store, id: string, d: Omit<LlmTpl, 'id'>): Store {
  return { ...s, customTpls: mapById(s.customTpls, id, () => ({ ...d, id })) };
}

export function removeTemplate(s: Store, id: string): Store {
  return { ...s, customTpls: s.customTpls.filter((x) => x.id !== id) };
}

export function restoreTemplateAt(s: Store, index: number, t: LlmTpl): Store {
  return { ...s, customTpls: reinsertAt(s.customTpls, index, t) };
}

// ---------- graphs ----------

/** Graph titles are always set and unique (`fallback` names an empty one). */
export function uniqueGraphTitle(graphs: Graph[], base: string, fallback: string, ignoreId?: string): string {
  return uniqueName(base.trim() || fallback, new Set(graphs.filter((g) => g.id !== ignoreId).map((g) => g.title)));
}

/** New graph goes last (the switcher keeps creation order). */
export function addGraph(s: Store, g: Graph): Store {
  return { ...s, graphs: [...s.graphs, g] };
}

export function renameGraphIn(s: Store, id: string, title: string): Store {
  return { ...s, graphs: mapById(s.graphs, id, (g) => ({ ...g, title })) };
}

export function removeGraph(s: Store, id: string): Store {
  return { ...s, graphs: s.graphs.filter((g) => g.id !== id) };
}

export function restoreGraphAt(s: Store, index: number, g: Graph): Store {
  return { ...s, graphs: reinsertAt(s.graphs, index, g) };
}

/** Notes whose membership would actually change (bulk add/remove reports and undoes only these). */
export function changedMembers(g: Graph, ids: string[], member: boolean): string[] {
  return ids.filter((id) => g.noteIds.includes(id) !== member);
}

export function setGraphMembers(s: Store, graphId: string, ids: string[], member: boolean): Store {
  return {
    ...s,
    graphs: mapById(s.graphs, graphId, (x) => ({
      ...x,
      noteIds: member ? [...x.noteIds, ...ids.filter((id) => !x.noteIds.includes(id))] : x.noteIds.filter((id) => !ids.includes(id)),
    })),
  };
}

export function toggleGraphMember(s: Store, graphId: string, noteId: string): Store {
  return {
    ...s,
    graphs: mapById(s.graphs, graphId, (g) => ({ ...g, noteIds: g.noteIds.includes(noteId) ? g.noteIds.filter((x) => x !== noteId) : [...g.noteIds, noteId] })),
  };
}
