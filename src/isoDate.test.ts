import { describe, expect, it } from 'vitest';
import { detectDueWord } from './isoDate';

describe('detectDueWord (HE-7: a day word in a task title sets the due date)', () => {
  it('reads today and tomorrow in EN, RU and KZ', () => {
    expect(detectDueWord('Review transactions ACID tomorrow', '2026-11-12')).toEqual({ word: 'tomorrow', due: '2026-11-13' });
    expect(detectDueWord('Сдать отчёт сегодня', '2026-11-12')).toEqual({ word: 'сегодня', due: '2026-11-12' });
    expect(detectDueWord('ертең емтихан', '2026-11-12')).toEqual({ word: 'ертең', due: '2026-11-13' });
  });
  it('finds the word in the middle of the phrase, case-insensitively, next to punctuation', () => {
    expect(detectDueWord('Повторить Завтра, до обеда', '2026-11-12')?.due).toBe('2026-11-13');
  });
  it('maps the day after tomorrow to +2', () => {
    expect(detectDueWord('Купить билеты послезавтра', '2026-11-12')?.due).toBe('2026-11-14');
  });
  it('ignores words that only contain a day word', () => {
    expect(detectDueWord('Read about tomorrows', '2026-11-12')).toBeNull();
    expect(detectDueWord('Купить завтрак', '2026-11-12')).toBeNull();
  });
  it('crosses month and year ends', () => {
    expect(detectDueWord('Exam tomorrow', '2026-12-31')?.due).toBe('2027-01-01');
  });
});
