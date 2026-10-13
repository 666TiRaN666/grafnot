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
