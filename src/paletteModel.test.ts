import { describe, expect, it } from 'vitest';
import { filterPalette, firstMatchPos, type PaletteEntry } from './paletteModel';

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
