import { describe, expect, it } from 'vitest';
import { buildRoute, parseRoute } from './router';

describe('hash router', () => {
  it('keeps the selected note in a map deep link', () => {
    expect(parseRoute('#/map/note/n1')).toEqual({ section: 'map', param: 'note/n1' });
    expect(buildRoute({ section: 'map', param: 'note/n1' })).toBe('#/map/note/n1');
  });
  it('parses a note deep link', () => {
    expect(parseRoute('#/notes/abc')).toEqual({ section: 'notes', param: 'abc' });
  });

  it('parses the week view and rejects unknown plan views', () => {
    expect(parseRoute('#/plan/week')).toEqual({ section: 'plan', param: 'week' });
    expect(parseRoute('#/plan/kanban')).toEqual({ section: 'notes' });
  });

  it('keeps a task id under the list view only', () => {
    expect(parseRoute('#/plan/list/t1')).toEqual({ section: 'plan', param: 'list/t1' });
    expect(parseRoute('#/plan/week/t1')).toEqual({ section: 'plan', param: 'week' });
    expect(buildRoute({ section: 'plan', param: 'list/t1' })).toBe('#/plan/list/t1');
  });

  it('roundtrips map/prompt/settings routes', () => {
    for (const route of [
      { section: 'map', param: 'g1' },
      { section: 'prompts', param: 'tpl-2' },
      { section: 'settings', param: 'profiles' },
    ] as const) {
      expect(parseRoute(buildRoute(route))).toEqual(route);
    }
  });

  it('falls back to notes on empty or unknown hashes', () => {
    expect(parseRoute('')).toEqual({ section: 'notes' });
    expect(parseRoute('#/nope')).toEqual({ section: 'notes' });
  });

  it('keeps nested prompts params for builder edit routes', () => {
    expect(parseRoute('#/prompts/edit/ct1')).toEqual({ section: 'prompts', param: 'edit/ct1' });
    expect(parseRoute('#/prompts/new')).toEqual({ section: 'prompts', param: 'new' });
  });
});
