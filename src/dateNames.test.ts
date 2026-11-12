import { describe, expect, it } from 'vitest';
import { dayMonth, weekRangeLabel, weekdayShort } from './dateNames';

describe('date names', () => {
  const thu = new Date(2026, 9, 29);
  it('Kazakh weekdays and months come from the table, not the browser', () => {
    expect(weekdayShort(thu, 'KZ')).toBe('Бс');
    expect(weekdayShort(new Date(2026, 10, 1), 'KZ')).toBe('Жс');
    expect(dayMonth(thu, 'KZ')).toBe('29 қазан');
  });
});

describe('week labels', () => {
  it('names the shown week as a range, across months too', () => {
    expect(weekRangeLabel(new Date(2026, 10, 9), new Date(2026, 10, 15), 'RU')).toBe('9–15 ноября 2026');
    expect(weekRangeLabel(new Date(2026, 10, 30), new Date(2026, 11, 6), 'KZ')).toBe('30 Қараша – 6 Желтоқсан 2026');
    expect(dayMonth(new Date(2026, 10, 20), 'RU')).toBe('20 ноября');
  });
});
