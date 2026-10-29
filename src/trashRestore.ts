import type { Store } from './store';

// Note trash with exact restore (D3, W4). Deleting records what pointed at
// the note — incoming links and graph membership — in store.trashMeta and
// removes them (no dangling ids); restoring re-adds them only where the
// source note or graph still exists. Nothing else is rolled back, so edits
// made after the deletion stay. Pure: App wires these into setStore.

/** Move a note to the trash, recording its incoming links and graphs. */
export function trashNote(s: Store, id: string, at: number): Store {
  const victim = s.notes.find((n) => n.id === id);
  if (!victim) return s;
  const incoming = s.notes.filter((n) => n.id !== id && n.linkedIds.includes(id)).map((n) => n.id);
  const graphs = s.graphs.filter((g) => g.noteIds.includes(id)).map((g) => g.id);
  return {
    ...s,
    notes: s.notes
      .filter((n) => n.id !== id)
      .map((n) => (n.linkedIds.includes(id) ? { ...n, linkedIds: n.linkedIds.filter((x) => x !== id) } : n)),
    graphs: s.graphs.map((g) => (g.noteIds.includes(id) ? { ...g, noteIds: g.noteIds.filter((x) => x !== id) } : g)),
    trash: [victim, ...s.trash.filter((n) => n.id !== id)],
    trashMeta: { ...(s.trashMeta ?? {}), [id]: { incoming, graphs, at } },
  };
}

/** Bring a trashed note back with the links and memberships that still have a home. */
export function restoreNote(s: Store, id: string): Store {
  const n = s.trash.find((x) => x.id === id);
  if (!n) return s;
  const meta = s.trashMeta?.[id];
  const incoming = new Set(meta?.incoming ?? []);
  const graphIds = new Set(meta?.graphs ?? []);
  return {
    ...s,
    trash: s.trash.filter((x) => x.id !== id),
    notes: [
      n,
      ...s.notes.map((x) => (incoming.has(x.id) && !x.linkedIds.includes(id) ? { ...x, linkedIds: [...x.linkedIds, id] } : x)),
    ],
    graphs: s.graphs.map((g) => (graphIds.has(g.id) && !g.noteIds.includes(id) ? { ...g, noteIds: [...g.noteIds, id] } : g)),
    trashMeta: withoutMeta(s, id),
  };
}

/** Delete a trashed note for good, together with its restore record. */
export function purgeNote(s: Store, id: string): Store {
  return { ...s, trash: s.trash.filter((x) => x.id !== id), trashMeta: withoutMeta(s, id) };
}

function withoutMeta(s: Store, id: string): Record<string, NonNullable<Store['trashMeta']>[string]> {
  const next = { ...(s.trashMeta ?? {}) };
  delete next[id];
  return next;
}
