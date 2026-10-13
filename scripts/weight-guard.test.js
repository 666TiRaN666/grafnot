import { describe, expect, it } from 'vitest';
import { FAIL_PCT, WARN_PCT, compareToBaseline } from './weight-guard.js';

const BASE = 1000;

describe('compareToBaseline', () => {
  it('reports ok within 15% growth', () => {
    expect(compareToBaseline(1100, BASE)).toEqual({ pct: 10, status: 'ok' });
  });

  it('reports ok exactly at the warn boundary', () => {
    const r = compareToBaseline(BASE * (1 + WARN_PCT / 100), BASE);
    expect(r.status).toBe('ok');
  });

  it('warns above 15% growth', () => {
    const r = compareToBaseline(1151, BASE);
    expect(r.status).toBe('warn');
    expect(r.pct).toBeGreaterThan(WARN_PCT);
  });

  it('warns exactly at the fail boundary', () => {
    const r = compareToBaseline(BASE * (1 + FAIL_PCT / 100), BASE);
    expect(r.status).toBe('warn');
  });

  it('fails above 50% growth', () => {
    const r = compareToBaseline(1501, BASE);
    expect(r.status).toBe('fail');
    expect(r.pct).toBeGreaterThan(FAIL_PCT);
  });

  it('reports ok when the weight shrank', () => {
    expect(compareToBaseline(950, BASE)).toEqual({ pct: -5, status: 'ok' });
  });
});
