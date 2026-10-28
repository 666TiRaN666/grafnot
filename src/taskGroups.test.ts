import { describe, expect, it } from "vitest";
import { addDaysISO, groupTasks, todayISO, toISODate } from "./taskGroups";
import type { TaskItem } from "./store";

const t = (id: string, extra: Partial<TaskItem> = {}): TaskItem =>
  Object.assign({ id, text: id, done: false }, extra);

describe("toISODate/todayISO/addDaysISO", () => {
  it("formats local yyyy-mm-dd and shifts days", () => {
    expect(toISODate(new Date(2026, 9, 8))).toBe("2026-10-08");
    expect(addDaysISO("2026-10-08", 1)).toBe("2026-10-09");
    expect(addDaysISO("2026-10-08", -1)).toBe("2026-10-07");
    expect(todayISO(new Date(2026, 9, 8))).toBe("2026-10-08");
  });
});

describe("groupTasks", () => {
  // 2026-10-08 is a Thursday: tomorrow is Fri 09, week runs Sat..Sun (10..11).
  const today = "2026-10-08";
  const tasks = [
    t("overdue", { due: "2026-10-07" }),
    t("today", { due: "2026-10-08" }),
    t("tomorrow", { due: "2026-10-09" }),
    t("fri", { due: "2026-10-09" }),
    t("sun", { due: "2026-10-11" }),
    t("later", { due: "2026-10-20" }),
    t("free"),
    t("done", { done: true, due: "2026-10-01" }),
  ];
  it("buckets by date with done pulled aside", () => {
    const g = groupTasks(tasks, today);
    const keys = g.active.map((x) => x.key);
    expect(keys).toEqual(["overdue", "today", "tomorrow", "week", "later", "undated"]);
    expect(g.active[0]?.items.map((x) => x.id)).toEqual(["overdue"]);
    expect(g.active[2]?.items.map((x) => x.id)).toEqual(["tomorrow", "fri"]);
    expect(g.active[3]?.items.map((x) => x.id)).toEqual(["sun"]);
    expect(g.done.map((x) => x.id)).toEqual(["done"]);
  });
  it("skips empty groups and keeps store order", () => {
    const g = groupTasks([t("a"), t("b", { due: "2026-10-08" })], today);
    expect(g.active.map((x) => x.key)).toEqual(["today", "undated"]);
    expect(g.done).toEqual([]);
  });
});

// T2: weekday/matrix coverage. Independent oracle (plain Date math, no calls
// into the tested module): buckets must match on every weekday plus month,
// year and leap boundaries.
describe("groupTasks weekday matrix", () => {
  const fmt = (d: Date): string => {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const shift = (iso: string, n: number): string => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return fmt(dt);
  };
  // Oracle bucket for one task (mirrors the documented rule independently).
  const oracle = (due: string | undefined, done: boolean, now: string): string => {
    if (done) return "done";
    if (!due) return "undated";
    const tomorrow = shift(now, 1);
    const [y, m, d] = now.split("-").map(Number);
    const sundayOff = (7 - (((new Date(y, m - 1, d).getDay() + 6) % 7)) - 1) % 7;
    const weekEnd = shift(now, sundayOff);
    if (due < now) return "overdue";
    if (due === now) return "today";
    if (due === tomorrow) return "tomorrow";
    if (due <= weekEnd) return "week";
    return "later";
  };
  const NOWS = [
    "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
    "2026-10-16", "2026-10-17", "2026-10-18",
    "2026-10-31", "2026-11-01", "2026-12-28", "2026-12-31",
    "2027-01-03", "2028-02-29",
  ];
  for (const now of NOWS) {
    it(`matches oracle on ${now}`, () => {
      const dues = [-3, -1, 0, 1, 2, 6, 10];
      const items = [
        ...dues.map((n) => t(`d${n}`, { due: shift(now, n) })),
        t("free"),
        t("old", { done: true, due: shift(now, -5) }),
      ];
      const g = groupTasks(items, now);
      const order = ["overdue", "today", "tomorrow", "week", "later", "undated"];
      const want = new Map<string, string[]>();
      for (const k of order) want.set(k, []);
      const wantDone: string[] = [];
      for (const task of items) {
        const b = oracle(task.due, task.done, now);
        if (b === "done") wantDone.push(task.id);
        else want.get(b)?.push(task.id);
      }
      expect(g.active.map((x) => x.key)).toEqual(order.filter((k) => (want.get(k) ?? []).length > 0));
      for (const grp of g.active) {
        expect(grp.items.map((x) => x.id)).toEqual(want.get(grp.key));
      }
      expect(g.done.map((x) => x.id)).toEqual(wantDone);
    });
  }
});
