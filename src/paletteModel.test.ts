import { describe, expect, it } from 'vitest';
import { filterPalette, firstMatchPos, PALETTE_RECENT, suggestNotes, type PaletteEntry } from './paletteModel';

const NOTES: PaletteEntry[] = [
  { id: 'n1', group: 'notes', title: 'Alpha Michel', sub: 'first' },
  { id: 'n2', group: 'notes', title: 'Alpha Beta', sub: 'second' },
  { id: 'n3', group: 'notes', title: 'Alpha Gamma', sub: 'third' },
  { id: 'n4', group: 'notes', title: 'Alpha Delta', sub: 'fourth' },
  { id: 'n5', group: 'notes', title: 'Alpha Epsilon', sub: 'fifth' },
];
const TASKS: PaletteEntry[] = [
  { id: 't1', group: 'tasks', title: 'Buy milk', sub: '' },
  { id: 't2', group: 'tasks', title: 'Alpha chore', sub: '' },
];
const COMMANDS: PaletteEntry[] = [
  { id: 'c-new-note', group: 'commands', title: 'cmd-new-note', sub: '' },
  { id: 'c-new-task', group: 'commands', title: 'cmd-new-task', sub: '' },
  { id: 'c-go-map', group: 'commands', title: 'cmd-go-map', sub: '' },
];

describe('filterPalette', () => {
  it('reveals the fifth and the 51st match without dropping the group', () => {
    const notes = Array.from({ length: 60 }, (_, i): PaletteEntry => ({ id: 'n' + i, group: 'notes', title: 'needle ' + i, sub: '' }));
    expect(filterPalette('needle', notes, [], [], [], { notes: 54 })).toHaveLength(54);
  });
  it('finds a distant text tail and keeps Kazakh letters distinct', () => {
    const notes: PaletteEntry[] = [{ id: 'tail', group: 'notes', title: 'Named', sub: 'short', searchText: 'x'.repeat(1000) + ' Ә Ғ Қ' }];
    expect(filterPalette('Ә Қ', notes, [], [], []).map(n => n.id)).toEqual(['tail']);
    expect(filterPalette('А К', notes, [], [], [])).toEqual([]);
  });
  it('caps every group at 4 entries', () => {
    const rows = filterPalette('alpha', NOTES, TASKS, [], COMMANDS);
    expect(rows.filter((r) => r.group === 'notes')).toHaveLength(4);
  });

  it('matches all words across title and sub', () => {
    const rows = filterPalette('alpha michel', NOTES, TASKS, [], COMMANDS);
    expect(rows.map((r) => r.id)).toEqual(['n1']);
  });

  it('finds tasks by title', () => {
    const rows = filterPalette('milk', NOTES, TASKS, [], COMMANDS);
    expect(rows.map((r) => r.id)).toEqual(['t1']);
  });

  it('matches tasks in the ordering check', () => {
    const rows = filterPalette('alpha', NOTES, TASKS, [], COMMANDS);
    expect(rows.some((r) => r.group === 'tasks')).toBe(true);
  });

  it('shows all commands on empty query', () => {
    const rows = filterPalette('', NOTES, TASKS, [], COMMANDS);
    expect(rows.filter((r) => r.group === 'commands')).toHaveLength(3);
  });

  it('empty query: commands first, then the first three notes as recent, no tasks', () => {
    const rows = filterPalette('', NOTES, TASKS, [], COMMANDS);
    expect(rows.map((r) => r.id)).toEqual(['c-new-note', 'c-new-task', 'c-go-map', 'n1', 'n2', 'n3']);
    // Raised limits (the "show more" pass) never widen the recent list.
    const all = filterPalette('', NOTES, TASKS, [], COMMANDS, { notes: Infinity, tasks: Infinity, prompts: Infinity, commands: Infinity });
    expect(all.filter((r) => r.group === 'notes')).toHaveLength(PALETTE_RECENT);
  });

  it('filters commands by title fragment', () => {
    const rows = filterPalette('new', NOTES, TASKS, [], COMMANDS);
    expect(rows.map((r) => r.id).sort()).toEqual(['c-new-note', 'c-new-task']);
  });

  it('orders notes before tasks before prompts before commands', () => {
    const prompts: PaletteEntry[] = [{ id: 'p1', group: 'prompts', title: 'alpha plan', sub: '' }];
    const rows = filterPalette('alpha', NOTES, TASKS, prompts, COMMANDS);
    const groups = rows.map((r) => r.group);
    expect(groups.indexOf('notes')).toBeLessThan(groups.indexOf('tasks'));
    expect(groups.indexOf('tasks')).toBeLessThan(groups.indexOf('prompts'));
  });
});

describe('firstMatchPos', () => {
  const blocks = [{ pos: 1, text: 'first line' }, { pos: 13, text: 'second Needle' }, { pos: 28, text: 'third needle' }];
  it('returns the document position of the first match in reading order', () => {
    expect(firstMatchPos(blocks, 'needle')).toBe(13 + 7);
  });
  it('takes the earliest of the AND words', () => {
    expect(firstMatchPos(blocks, 'needle line')).toBe(1 + 6);
  });
  it('prefers the first block that holds every word', () => {
    expect(firstMatchPos([{ pos: 1, text: 'line 0' }, { pos: 9, text: 'see line 50' }], 'line 50')).toBe(9 + 4);
  });
  it('keeps Kazakh letters distinct and reports no match', () => {
    expect(firstMatchPos([{ pos: 1, text: 'Әліпби' }], 'ә')).toBe(1);
    expect(firstMatchPos([{ pos: 1, text: 'Әліпби' }], 'а')).toBeNull();
    expect(firstMatchPos(blocks, '   ')).toBeNull();
  });
});

describe('suggestNotes (HE-1: "Did you mean" for a query with no hits)', () => {
  const notes: PaletteEntry[] = [
    { id: 'a', group: 'notes', title: 'Normalization', sub: '' },
    { id: 'b', group: 'notes', title: 'Transactions', sub: '' },
    { id: 'c', group: 'notes', title: 'Нормализация БД', sub: '' },
    { id: 'd', group: 'notes', title: 'Normal forms', sub: '' },
  ];
  it('finds a title behind an adjacent-letter swap', () => {
    expect(suggestNotes('nrom', notes).map((e) => e.id)).toEqual(['a', 'd']);
  });
  it('tolerates two typos only in long words', () => {
    expect(suggestNotes('trnsactons', notes).map((e) => e.id)).toEqual(['b']);
    expect(suggestNotes('nxrx', notes)).toEqual([]);
  });
  it('works for Cyrillic titles', () => {
    expect(suggestNotes('нормлаизация', notes).map((e) => e.id)).toEqual(['c']);
  });
  it('returns nothing for an empty or unrelated query', () => {
    expect(suggestNotes('', notes)).toEqual([]);
    expect(suggestNotes('qwerty', notes)).toEqual([]);
  });
  it('caps the list and puts the closest first', () => {
    const many: PaletteEntry[] = ['norm', 'nrom', 'noem', 'nirm', 'npqm'].map((t, i) => ({ id: 'm' + i, group: 'notes', title: t, sub: '' }));
    const got = suggestNotes('norm', many);
    expect(got).toHaveLength(3);
    expect(got[0]?.id).toBe('m0');
  });
});
