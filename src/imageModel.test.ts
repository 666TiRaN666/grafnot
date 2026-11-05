import { describe, expect, it } from 'vitest';
import { ASPECTS, catOf, moveInLane, orderTokens, renderImage } from './imageModel';

describe('catOf', () => {
  it('takes the category from the dictionary, weights ignored', () => {
    expect(catOf('blue eyes')).toBe('look');
    expect(catOf('((school uniform))')).toBe('outfit');
    expect(catOf('masterpiece')).toBe('quality');
  });
  it('guesses common English endings for tags outside the dictionary', () => {
    expect(catOf('long black hair')).toBe('look');
    expect(catOf('rim lighting')).toBe('light');
    expect(catOf('grey background')).toBe('scene');
    expect(catOf('watercolor')).toBe('other');
  });
  it('a user choice wins over the dictionary', () => {
    expect(catOf('blue eyes', { 'blue eyes': 'style' })).toBe('style');
  });
});

describe('orderTokens', () => {
  it('sorts by the order a model reads a prompt, stable inside a lane', () => {
    expect(orderTokens(['sunset', 'blue eyes', 'masterpiece', 'long hair', '1girl'])).toEqual(['masterpiece', '1girl', 'blue eyes', 'long hair', 'sunset']);
  });
});

describe('moveInLane', () => {
  it('swaps with the neighbour of the same category only', () => {
    const t = ['blue eyes', 'sunset', 'long hair'];
    expect(moveInLane(t, 0, 1)).toEqual(['long hair', 'sunset', 'blue eyes']);
    expect(moveInLane(t, 1, 1)).toEqual(t);
  });
});

describe('renderImage', () => {
  const base = { tokens: ['1girl', 'blue eyes'], negative: ['blurry', 'text'], aspect: '2:3' as const, ponyScore: false };
  it('Pony: tags, optional quality prefix, separate negative, SDXL size', () => {
    const r = renderImage({ ...base, model: 'Pony', ponyScore: true });
    expect(r.positive).toBe('score_9, score_8_up, score_7_up, 1girl, blue eyes');
    expect(r.negative).toBe('blurry, text');
    expect(r.size).toEqual(ASPECTS['2:3']);
    expect(r.negativeSupported).toBe(true);
  });
  it('Flux: a sentence, no negative prompt (focus group: a tag list is not natural language)', () => {
    const r = renderImage({ ...base, model: 'Flux' });
    expect(r.positive).toBe('A girl with blue eyes.');
    expect(r.negative).toBe('');
    expect(r.negativeSupported).toBe(false);
  });
  it('Flux: lanes become phrases, quality tags and weights drop out', () => {
    const r = renderImage({
      ...base, model: 'Flux',
      tokens: ['masterpiece', '1girl', '(blue eyes:1.3)', 'school uniform', 'sitting', 'classroom', 'soft lighting', 'watercolor', 'close-up'],
      tagCats: { watercolor: 'style', classroom: 'scene' },
    });
    expect(r.positive).toBe('A girl with blue eyes, wearing school uniform, sitting. Setting: classroom. Lighting: soft lighting. Style: watercolor. Shot: close-up.');
  });
  it('Midjourney: parameters live in the prompt, weights stripped', () => {
    const r = renderImage({ ...base, tokens: ['((1girl))', 'blue eyes'], model: 'Midjourney' });
    expect(r.positive).toBe('1girl, blue eyes --ar 2:3 --no blurry, text');
    expect(r.size).toBeNull();
  });
});
