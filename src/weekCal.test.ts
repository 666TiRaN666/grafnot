import { describe, expect, it } from "vitest";
import { mondayISO, weekRange } from "./weekCal";

describe("mondayISO", () => {
  it("returns the Monday of the same week", () => {
    expect(mondayISO("2026-10-08")).toBe("2026-10-05"); // Thursday
    expect(mondayISO("2026-10-05")).toBe("2026-10-05"); // Monday
    expect(mondayISO("2026-10-11")).toBe("2026-10-05"); // Sunday
  });
});

describe("weekRange", () => {
  it("lists Mon..Sun across a month boundary", () => {
    expect(weekRange(0, "2026-10-01")).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30",
      "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
  });
  it("shifts by whole weeks", () => {
    const base = weekRange(0, "2026-10-08");
    const next = weekRange(1, "2026-10-08");
    expect(next[0]).toBe("2026-10-12");
    expect(weekRange(-1, "2026-10-08")[0]).toBe("2026-09-28");
    expect(base).toHaveLength(7);
  });
});
