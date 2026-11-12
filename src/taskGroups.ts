import type { TaskItem } from "./store";
import { addDaysISO } from "./isoDate";

export type TaskGroupKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "undated";

export interface TaskGroup {
  key: TaskGroupKey;
  items: TaskItem[];
}

export const TASK_GROUP_ORDER: TaskGroupKey[] = ["overdue", "today", "tomorrow", "week", "later", "undated"];


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

export interface TaskPage {
  sections: { key: TaskGroupKey; total: number; items: TaskItem[] }[];
  done: TaskItem[];
  /** Rows on screen now. */
  rendered: number;
  /** Rows the expanded groups hold: «show more» pages only through these. */
  open: number;
}

/**
 * One budget of `shown` rows across the expanded groups, Done included.
 * A collapsed group keeps its header and count and is not paged: «show more»
 * counted collapsed rows before (2026-11), so «Show 1 more» did nothing.
 * A search expands every group.
 */
export function pageTaskGroups(active: TaskGroup[], done: TaskItem[], collapsed: ReadonlySet<string>, searching: boolean, shown: number): TaskPage {
  let rest = shown;
  let open = 0;
  const sections = active.map((g) => {
    const shut = collapsed.has(g.key) && !searching;
    if (!shut) open += g.items.length;
    const items = shut ? [] : g.items.slice(0, Math.max(rest, 0));
    rest -= items.length;
    return { key: g.key, total: g.items.length, items };
  });
  const doneShut = collapsed.has('done') && !searching;
  if (!doneShut) open += done.length;
  const doneItems = doneShut ? [] : done.slice(0, Math.max(rest, 0));
  const rendered = sections.reduce((n, g) => n + g.items.length, 0) + doneItems.length;
  return { sections, done: doneItems, rendered, open };
}
