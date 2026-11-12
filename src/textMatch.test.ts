import { describe, expect, it } from 'vitest';
import { cutHiParts, matchesQuery, queryWords, splitHighlight } from './textMatch';

const hits = (text: string, q: string) => splitHighlight(text, q).filter((p) => p.hit).map((p) => p.text);

describe('query words', () => {
  it('lower-cases and splits on any whitespace; an empty query has no words', () => {
    expect(queryWords('  Отчёт   МАРТ\t2026 ')).toEqual(['отчёт', 'март', '2026']);
    expect(queryWords('   ')).toEqual([]);
  });
});

describe('matchesQuery: one rule for every list, the palette and the trash', () => {
  it('needs every word, in any order and across fields', () => {
    expect(matchesQuery(['Отчёт за март', 'итоги квартала'], 'март отчёт')).toBe(true);
    expect(matchesQuery(['Отчёт за март', 'итоги квартала'], 'отчёт итоги')).toBe(true);
    expect(matchesQuery(['Отчёт за март', 'итоги квартала'], 'отчёт апрель')).toBe(false);
  });
  it('is a superset of the old single-substring match', () => {
    expect(matchesQuery(['Отчёт за март'], 'за март')).toBe(true);
    expect(matchesQuery(['Alpha'], 'ALP')).toBe(true);
  });
  it('does not glue fields together', () => {
    expect(matchesQuery(['ab', 'cd'], 'bc')).toBe(false);
  });
  it('matches everything for an empty query and skips absent fields', () => {
    expect(matchesQuery(['x'], '  ')).toBe(true);
    expect(matchesQuery(['Task', undefined], 'task')).toBe(true);
  });
  it('keeps Kazakh letters distinct', () => {
    expect(matchesQuery(['Әже'], 'әже')).toBe(true);
    expect(matchesQuery(['Әже'], 'аже')).toBe(false);
  });
});

describe('highlight follows the same words', () => {
  it('marks every word of the query, wherever it is', () => {
    expect(hits('Отчёт за март', 'март отчёт')).toEqual(['Отчёт', 'март']);
  });
  it('merges overlapping words into one mark', () => {
    expect(hits('мартовский', 'март арто')).toEqual(['марто']);
  });
  it('keeps the text whole and unmarked for an empty query', () => {
    expect(splitHighlight('abc', '')).toEqual([{ text: 'abc', hit: false }]);
    expect(splitHighlight('abc', ' ')).toEqual([{ text: 'abc', hit: false }]);
  });
  it('splits a one-word query case-insensitively, as before', () => {
    expect(splitHighlight('Code review code', 'code')).toEqual([
      { text: 'Code', hit: true },
      { text: ' review ', hit: false },
      { text: 'code', hit: true },
    ]);
  });

  it('cuts after highlighting, never inside a hit', () => {
    const parts = splitHighlight('a'.repeat(130) + 'MATCH' + 'b'.repeat(100), 'match');
    const cut = cutHiParts(parts, 140);
    const text = cut.map((p) => p.text).join('');
    expect(text.length).toBeGreaterThan(130);
    expect(text).toContain('MATCH');
    expect(cut.some((p) => p.hit && p.text === 'MATCH')).toBe(true);
  });

  it('falls back to a plain slice without matches', () => {
    const cut = cutHiParts(splitHighlight('x'.repeat(200), 'zzz'), 140);
    expect(cut.map((p) => p.text).join('')).toBe('x'.repeat(140));
  });
});
