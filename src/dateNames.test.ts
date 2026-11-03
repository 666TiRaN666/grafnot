import { describe, expect, it } from 'vitest';
import { monthYear, weekdayShort } from './dateNames';

describe('date names', () => {
  const thu = new Date(2026, 9, 29);
  it('Kazakh weekdays and months come from the table, not the browser', () => {
    expect(weekdayShort(thu, 'KZ')).toBe('Бс');
    expect(weekdayShort(new Date(2026, 10, 1), 'KZ')).toBe('Жс');
    expect(monthYear(thu, 'KZ')).toBe('Қазан 2026');
  });
  it('Russian month title raises only the first letter', () => {
    expect(monthYear(thu, 'RU')).toMatch(/^Октябрь 2026/);
    expect(monthYear(thu, 'RU')).not.toContain('Г.');
  });
});
