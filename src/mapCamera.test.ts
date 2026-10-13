import { describe, expect, it } from "vitest";
import { MAP_H, MAP_W, centerView, fitView } from "./mapCamera";

describe("centerView", () => {
  it("maps the point onto the viewBox center", () => {
    const v = centerView(100, 200, 1);
    expect(v.k).toBe(1);
    expect(100 * v.k + v.x).toBe(MAP_W / 2);
    expect(200 * v.k + v.y).toBe(MAP_H / 2);
  });
  it("respects the zoom factor", () => {
    const v = centerView(100, 200, 2);
    expect(100 * v.k + v.x).toBe(MAP_W / 2);
  });
});

describe("fitView", () => {
  it("fits two points with padding inside the box", () => {
    const v = fitView([{ x: 0, y: 0 }, { x: 400, y: 250 }]);
    expect(v.k).toBeLessThanOrEqual(2.5);
    const cx = 200 * v.k + v.x;
    const cy = 125 * v.k + v.y;
    expect(cx).toBe(MAP_W / 2);
    expect(cy).toBe(MAP_H / 2);
  });
  it("falls back to identity on empty input", () => {
    expect(fitView([])).toEqual({ k: 1, x: 0, y: 0 });
  });
});
