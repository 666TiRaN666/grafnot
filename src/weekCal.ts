import { addDaysISO, toISODate } from "./isoDate";

/** ISO Monday of the week containing `iso` (yyyy-mm-dd). */
export function mondayISO(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return toISODate(dt);
}

/** Seven day ISOs, Mon..Sun, of the week `offset` weeks from `today`. */
export function weekRange(offset: number, today: string): string[] {
  const mon = mondayISO(today);
  return Array.from({ length: 7 }, (_, i) => addDaysISO(mon, offset * 7 + i));
}
