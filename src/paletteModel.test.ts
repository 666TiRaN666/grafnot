import { describe, expect, it } from 'vitest';
import { filterPalette, type PaletteEntry } from './paletteModel';

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
