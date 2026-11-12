/**
 * The local calendar day as yyyy-mm-dd — the shape of TaskItem.due, date
 * inputs, the week grid and dated file names. One place for it (2026-11: it
 * was written out in taskGroups, weekCal and noteName, and noteName used the
 * UTC day, so a note changed just after local midnight got yesterday's name).
 */
export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

/** The day `n` days after `iso` (negative: before), across months and years. */
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + n);
  return toISODate(dt);
}

/** Display form of a due date: ISO YYYY-MM-DD -> DD.MM, legacy strings as-is. */
export function fmtDue(due?: string): string {
  if (!due) return '';
  const m = due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}.${m[2]}`;
  return due;
}
