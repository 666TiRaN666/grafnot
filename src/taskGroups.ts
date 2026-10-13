import type { TaskItem } from "./store";

export type TaskGroupKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "undated";

export interface TaskGroup {
  key: TaskGroupKey;
  items: TaskItem[];
}

export const TASK_GROUP_ORDER: TaskGroupKey[] = ["overdue", "today", "tomorrow", "week", "later", "undated"];

/** Local yyyy-mm-dd (date inputs and TaskItem.due use this shape). */
export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + n);
  return toISODate(dt);
}

/** Offset of the coming Sunday (0 when today is Sunday). */
function sundayOffset(today: string): number {
  const [y, m, d] = today.split("-").map(Number);
  const jsDay = new Date(y, (m || 1) - 1, d || 1).getDay();
  return (7 - ((jsDay + 6) % 7) - 1) % 7;
}

/**
 * Bucket active tasks by due date against `today` (yyyy-mm-dd, string
 * comparison works on this shape). Done tasks go aside regardless of date.
 * Store order is kept inside every bucket; empty buckets are skipped.
 */
export function groupTasks(tasks: TaskItem[], today: string): { active: TaskGroup[]; done: TaskItem[] } {
  const done: TaskItem[] = [];
  const buckets = new Map<TaskGroupKey, TaskItem[]>(TASK_GROUP_ORDER.map((k) => [k, []]));
  const tomorrow = addDaysISO(today, 1);
  const weekEnd = addDaysISO(today, sundayOffset(today));
  for (const t of tasks) {
    if (t.done) {
      done.push(t);
      continue;
    }
    const due = t.due ?? "";
    const key: TaskGroupKey =
      !due ? "undated" : due < today ? "overdue" : due === today ? "today" : due === tomorrow ? "tomorrow" : due <= weekEnd ? "week" : "later";
    buckets.get(key)?.push(t);
  }
  return { active: TASK_GROUP_ORDER.flatMap((key) => {
    const items = buckets.get(key) ?? [];
    return items.length > 0 ? [{ key, items }] : [];
  }), done };
}
