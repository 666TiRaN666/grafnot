import { addDaysISO } from "./taskGroups";

/** ISO Monday of the week containing `iso` (yyyy-mm-dd). */
export function mondayISO(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** Seven day ISOs, Mon..Sun, of the week `offset` weeks from `today`. */
export function weekRange(offset: number, today: string): string[] {
  const mon = mondayISO(today);
  return Array.from({ length: 7 }, (_, i) => addDaysISO(mon, offset * 7 + i));
}
