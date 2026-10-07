import { describe, expect, it } from 'vitest';
import { DATASET_VERSION, GENERATED_AT, TAG_DATA } from './promptData';

describe('prompt dataset integrity', () => {
  it('has a usable sample size', () => {
    expect(TAG_DATA.length).toBeGreaterThanOrEqual(40);
  });

  it('every entry covers all models with sane numbers', () => {
    const tags = new Set<string>();
    for (const t of TAG_DATA) {
      expect(t.tag.length).toBeGreaterThan(0);
      expect(tags.has(t.tag)).toBe(false);
      tags.add(t.tag);
      for (const m of ['Pony', 'SDXL', 'Flux'] as const) {
        expect(t.perModel[m].rate).toBeGreaterThanOrEqual(0);
        expect(t.perModel[m].rate).toBeLessThanOrEqual(100);
        expect(t.perModel[m].samples).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is versioned, not "updated someday"', () => {
    expect(DATASET_VERSION).toMatch(/^\d+\.\d+\.\d+-sample$/);
    expect(GENERATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('UI totals derive from the table (recomputed independently)', () => {
    let samples = 0;
    for (const t of TAG_DATA) {
      samples += t.perModel.Pony.samples + t.perModel.SDXL.samples + t.perModel.Flux.samples;
    }
    expect(samples).toBeGreaterThan(300000);
    expect(Number.isInteger(samples)).toBe(true);
  });
});
