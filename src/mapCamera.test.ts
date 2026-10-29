import { describe, expect, it } from "vitest";
import { MAP_H, MAP_W, boxHeight, centerView, fitView, revealShift } from "./mapCamera";

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

describe("boxHeight", () => {
  it("follows the canvas proportions instead of a fixed 800x500 box", () => {
    expect(boxHeight(400, 600)).toBe(1200);
    expect(boxHeight(1000, 500)).toBe(400);
    expect(boxHeight(0, 0)).toBe(MAP_H);
  });
  it("centers inside a box of any height", () => {
    const v = centerView(100, 200, 1, MAP_W, 1200);
    expect(200 * v.k + v.y).toBe(600);
  });
});

describe("revealShift", () => {
  const canvas = { left: 0, top: 0, width: 800, height: 600 };
  it("moves a note out from under a side card, to its left", () => {
    const card = { left: 440, right: 780, top: 200, bottom: 400, width: 340 };
    const d = revealShift({ x: 600, y: 300 }, card, canvas);
    expect(d.dy).toBe(0);
    expect(600 + d.dx).toBeLessThan(card.left - 32);
  });
  it("moves a note up from under a bottom sheet", () => {
    const sheet = { left: 0, right: 800, top: 400, bottom: 600, width: 800 };
    const d = revealShift({ x: 300, y: 450 }, sheet, canvas);
    expect(d.dx).toBe(0);
    expect(450 + d.dy).toBeLessThan(sheet.top - 32);
  });
  it("leaves a visible note alone", () => {
    expect(revealShift({ x: 100, y: 100 }, { left: 440, right: 780, top: 200, bottom: 400, width: 340 }, canvas)).toEqual({ dx: 0, dy: 0 });
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
