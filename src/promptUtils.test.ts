import { describe, expect, it } from 'vitest';
import {
  PREVIEW_LEN,
  RISK_THRESHOLD,
  SNIPPET_LEN,
  cutHiParts,
  fillBody,
  isRisky,
  listSlots,
  migrateImageSavesToTemplates,
  missingSlots,
  renderPrompt,
  renderSavedTpl,
  resolveParams,
  splitHighlight,
  splitSlots,
  validateTemplate,
} from './promptUtils';

describe('prompt utils', () => {
  it('renders per-model syntax', () => {
    expect(renderPrompt('Pony', ['a', 'b'])).toBe('a, b');
    expect(renderPrompt('SDXL', ['a', 'b'])).toBe('(a), (b)');
    expect(renderPrompt('Flux', ['a', 'b', 'c'])).toBe('a, b and c');
    expect(renderPrompt('Flux', ['a'])).toBe('a');
    expect(renderPrompt('Pony', [])).toBe('');
  });

  it('promotes legacy image saves into editable templates and keeps their links', () => {
    const saved = {
      id: 'p-old',
      kind: 'image' as const,
      title: 'Blue art',
      model: 'SDXL' as const,
      tokens: ['blue hair'],
      noteId: 'n1',
      created: 1,
    };
    const result = migrateImageSavesToTemplates([saved], []);
    const template = result.customTpls[0];

    expect(template).toEqual({
      id: 'legacy-image-p-old',
      name: 'Blue art',
      body: '(blue hair)',
      defaults: {},
      kind: 'image',
    });
    expect(result.prompts[0]).toMatchObject({
      id: 'p-old',
      kind: 'llm',
      title: 'Blue art',
      templateId: 'legacy-image-p-old',
      noteId: 'n1',
      params: {},
    });
  });

  it('flags risk below the named threshold', () => {
    expect(RISK_THRESHOLD).toBe(50);
    expect(isRisky(12)).toBe(true);
    expect(isRisky(49)).toBe(true);
    expect(isRisky(50)).toBe(false);
    expect(isRisky(95)).toBe(false);
  });
});

describe('template slots', () => {
  it('lists slots in order, dedupes, trims', () => {
    expect(listSlots('План по {{предмет}} на {{ дней }} дней. {{предмет}}!')).toEqual(['предмет', 'дней']);
    expect(listSlots('plain')).toEqual([]);
  });

  it('fills slots, blanks missing, ignores extras', () => {
    expect(fillBody('A {{x}} B {{y}}', { x: '1' })).toBe('A 1 B ');
    expect(fillBody('A {{x}}', { x: '1', z: '9' })).toBe('A 1');
    expect(fillBody('line1\n{{x}}', { x: 'v' })).toBe('line1\nv');
  });

  it('reports missing slots', () => {
    expect(missingSlots('A {{x}} {{y}}', { x: ' ' })).toEqual(['x', 'y']);
    expect(missingSlots('A {{x}}', { x: 'v' })).toEqual([]);
  });

  it('splits body for inline rendering', () => {
    expect(splitSlots('{{a}} x {{b}}')).toEqual([
      { text: '{{a}}', slot: 'a' },
      { text: ' x ' },
      { text: '{{b}}', slot: 'b' },
    ]);
    expect(splitSlots('Code review')).toEqual([{ text: 'Code review' }]);
  });

  it('maps legacy positional p1/p2 to slots in order', () => {
    const tpl = { body: 'SQL:\n{{запрос}}\nДиалект: {{диалект}}', defaults: { запрос: 'SELECT 1', диалект: 'pg' } };
    expect(resolveParams(tpl, { p1: 'SELECT 2', p2: 'my' })).toEqual({ запрос: 'SELECT 2', диалект: 'my' });
    expect(renderSavedTpl(tpl, { p1: 'SELECT 2', p2: 'my' })).toBe('SQL:\nSELECT 2\nДиалект: my');
  });

  it('prefers named params and falls back to defaults', () => {
    const tpl = { body: '{{a}} {{b}}', defaults: { a: 'A', b: 'B' } };
    expect(resolveParams(tpl, { b: 'b!' })).toEqual({ a: 'A', b: 'b!' });
    expect(resolveParams(tpl, {})).toEqual({ a: 'A', b: 'B' });
  });

  it('validates editable templates', () => {
    expect(validateTemplate({ name: 'T', body: 'B {{x}}' })).toEqual([]);
    expect(validateTemplate({ name: '  ', body: 'B' })).toEqual(['name']);
    expect(validateTemplate({ name: 'T', body: '   ' })).toEqual(['body']);
  });

  it('fixes preview lengths in one place', () => {
    expect(PREVIEW_LEN).toBe(140);
    expect(SNIPPET_LEN).toBe(40);
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
