import { describe, expect, it } from 'vitest';
import { parseImport, storeDigest } from './importStore';
import { SCHEMA_VERSION } from './store';

const note = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id.toUpperCase(), content: '', text: id + ' text', linkedIds: [], calcs: [], updated: 1, ...extra });
const payload = (extra: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: SCHEMA_VERSION, notes: [note('a', { linkedIds: ['b'] }), note('b')], tasks: [{ id: 't1', text: 'Task', done: false, noteId: 'a' }],
  trash: [], trashTasks: [], graphs: [{ id: 'g1', title: 'G', noteIds: ['a'] }], prompts: [], customTpls: [], activeId: 'a', trashMeta: {}, ...extra,
});

describe('parseImport', () => {
  it('accepts an exported store and keeps unknown fields aside', () => {
    const r = parseImport(payload({ futureField: { x: 1 } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.store.notes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(r.rest).toEqual({ futureField: { x: 1 } });
    expect(r.report).toEqual({ notes: 2, tasks: 1, graphs: 1, dropped: 0 });
  });
  it('rejects broken JSON, wrong shapes and a newer schema', () => {
    expect(parseImport('{').ok).toBe(false);
    expect(parseImport('[]')).toEqual({ ok: false, reason: 'shape' });
    expect(parseImport(JSON.stringify({ notes: [] }))).toEqual({ ok: false, reason: 'shape' });
    expect(parseImport(payload({ schemaVersion: SCHEMA_VERSION + 1 }))).toEqual({ ok: false, reason: 'future' });
  });
  it('rejects nested values of the wrong type instead of dropping them', () => {
    expect(parseImport(payload({ notes: [note('a', { linkedIds: [5] })] }))).toEqual({ ok: false, reason: 'type' });
    expect(parseImport(payload({ tasks: [{ id: 't', text: 'x', done: 'no' }] }))).toEqual({ ok: false, reason: 'type' });
    expect(parseImport(payload({ graphs: [{ id: 'g', title: 'G', noteIds: 'a' }] }))).toEqual({ ok: false, reason: 'type' });
  });
  it('rejects repeated ids across notes and trash', () => {
    expect(parseImport(payload({ trash: [note('a')] }))).toEqual({ ok: false, reason: 'duplicate' });
  });
  it('drops and counts links to notes that are not in the file', () => {
    const r = parseImport(payload({ notes: [note('a', { linkedIds: ['ghost'] })] }));
    expect(r.ok && r.report.dropped).toBe(1);
  });
});

describe('storeDigest', () => {
  it('changes when content changes and ignores key order', () => {
    const r = parseImport(payload());
    if (!r.ok) throw new Error('fixture');
    const same = { ...r.store, notes: [...r.store.notes] };
    expect(storeDigest(same)).toBe(storeDigest(r.store));
    const edited = { ...r.store, notes: r.store.notes.map((n) => (n.id === 'b' ? { ...n, text: 'other' } : n)) };
    expect(storeDigest(edited)).not.toBe(storeDigest(r.store));
  });
});
