import { describe, expect, it } from 'vitest';
import {
  PREVIEW_LEN,
  RISK_THRESHOLD,
  SNIPPET_LEN,
  cutHiParts,
  fillBody,
  imageInit,
  isBlockSlot,
  isRisky,
  listSlots,
  migrateImageSavesToTemplates,
  missingSlots,
  parseImageBody,
  renderPrompt,
  renderSavedTpl,
  resolveParams,
  splitHighlight,
  splitSlots,
  validateTemplate,
} from './promptUtils';
import { LLM_TEMPLATES } from './data';

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
      model: 'SDXL',
      tokens: ['blue hair'],
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

  it('parses a rendered image body back (UX-03)', () => {
    const tokens = ['a', '((b))', '[c]', '(d:1.2)'];
    expect(parseImageBody(renderPrompt('Pony', tokens))).toEqual({ model: 'Pony', tokens });
    expect(parseImageBody(renderPrompt('SDXL', tokens))).toEqual({ model: 'SDXL', tokens });
    // Flux drops weights at render time: only the tags come back.
    expect(parseImageBody(renderPrompt('Flux', ['((a))', 'b', 'c']))).toEqual({ model: 'Flux', tokens: ['a', 'b', 'c'] });
    expect(parseImageBody('')).toEqual({ model: 'Pony', tokens: [] });
  });

  it('restores image state: stored fields, then body, built-in art from defaults', () => {
    expect(imageInit({ id: 'x', name: 'n', body: 'zzz', defaults: {}, kind: 'image', model: 'Flux', tokens: ['((a))', 'b'] }))
      .toEqual({ model: 'Flux', tokens: ['((a))', 'b'] });
    expect(imageInit({ id: 'old', name: 'n', body: '(blue hair), (((red eyes)))', defaults: {}, kind: 'image' }))
      .toEqual({ model: 'SDXL', tokens: ['blue hair', '((red eyes))'] });
    const art = imageInit(LLM_TEMPLATES.find((t) => t.id === 'art')!);
    expect(art.model).toBe('Pony');
    expect(art.tokens).toEqual(['masterpiece', 'best quality', '1girl', 'long black hair', 'blue eyes', 'school uniform', 'sunset', 'soft lighting']);
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

  it('treats a slot on its own line (or a multiline default) as a block field', () => {
    const cr = 'Проверь код ({{язык}}). Уровень: {{уровень}}.\nКод:\n{{код}}';
    expect(isBlockSlot(cr, 'код')).toBe(true);
    expect(isBlockSlot(cr, 'язык')).toBe(false);
    expect(isBlockSlot('Объясни:\n  {{ запрос }}  \nДиалект: {{диалект}}.', 'запрос')).toBe(true);
    expect(isBlockSlot('{{вопрос}}\nОтветь кратко', 'вопрос')).toBe(true);
    expect(isBlockSlot('Тема {{x}}\nи {{x}} ещё', 'x')).toBe(false);
    expect(isBlockSlot('Тема {{x}}', 'x', 'a\nb')).toBe(true);
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
