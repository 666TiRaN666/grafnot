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

/** Day words a task title may carry (RU/EN/KZ) and their offset from today. */
const DUE_WORDS: ReadonlyArray<readonly [string, number]> = [
  ['today', 0], ['сегодня', 0], ['бүгін', 0],
  ['tomorrow', 1], ['завтра', 1], ['ертең', 1],
  ['послезавтра', 2], ['бүрсігүні', 2],
];

/** HE-7 (Lab 7): a day word written in a task title ("… tomorrow") becomes its
 * due date, so the intent is not silently lost in "No date". Whole words only
 * (\b is ASCII-only in JS, so the edges are spaces/punctuation). */
export function detectDueWord(text: string, today: string): { word: string; due: string } | null {
  const words = text.toLowerCase().split(/[\s.,!?;:()«»"']+/).filter(Boolean);
  for (const [w, add] of DUE_WORDS) {
    if (words.includes(w)) return { word: w, due: addDaysISO(today, add) };
  }
  return null;
}
