import { describe, expect, it } from "vitest";
import { NO_SELECTION, clickSelect, idsInRect, pruneSelection, selectAll, selectMods } from "./selectionModel";

const order = ["a", "b", "c", "d", "e"];
const plain = { toggle: false, range: false };
const ctrl = { toggle: true, range: false };
const shift = { toggle: false, range: true };

describe("selection model", () => {
  it("Ctrl and Cmd both toggle; Shift ranges", () => {
    expect(selectMods({ ctrlKey: true, metaKey: false, shiftKey: false })).toEqual(ctrl);
    expect(selectMods({ ctrlKey: false, metaKey: true, shiftKey: false })).toEqual(ctrl);
    expect(selectMods({ ctrlKey: false, metaKey: false, shiftKey: true })).toEqual(shift);
  });

  it("Ctrl+click adds and removes; the open item joins when a selection starts", () => {
    let s = clickSelect(NO_SELECTION, "c", ctrl, order, "a");
    expect(s.ids).toEqual(["a", "c"]);
    s = clickSelect(s, "a", ctrl, order, "a");
    expect(s.ids).toEqual(["c"]);
    s = clickSelect(s, "c", ctrl, order, "a");
    expect(s.ids).toEqual([]);
  });

  it("Shift+click selects the range from the anchor in list order, both directions", () => {
    let s = clickSelect(NO_SELECTION, "b", plain, order);
    s = clickSelect(s, "d", shift, order);
    expect(s.ids).toEqual(["b", "c", "d"]);
    s = clickSelect(s, "a", shift, order);
    expect(s.ids).toEqual(["a", "b"]);
    expect(s.anchor).toBe("b");
  });

  it("Ctrl+Shift adds a range to the selection", () => {
    let s = clickSelect(NO_SELECTION, "a", ctrl, order);
    s = clickSelect(s, "d", ctrl, order);
    s = clickSelect(s, "e", { toggle: true, range: true }, order);
    expect(s.ids).toEqual(["a", "d", "e"]);
  });

  it("without an order (map) Shift only adds", () => {
    let s = clickSelect(NO_SELECTION, "x", plain, null);
    s = clickSelect(s, "y", shift, null);
    s = clickSelect(s, "y", shift, null);
    expect(s.ids).toEqual(["x", "y"]);
  });

  it("select all, prune and rectangle hit-test", () => {
    expect(selectAll(order).ids).toEqual(order);
    const p = pruneSelection({ ids: ["a", "b", "z"], anchor: "z" }, new Set(["a", "b"]));
    expect(p).toEqual({ ids: ["a", "b"], anchor: "a" });
    const pts = { a: { x: 0, y: 0 }, b: { x: 5, y: 5 }, c: { x: 20, y: 1 } };
    expect(idsInRect(pts, { x: 10, y: 10 }, { x: -1, y: -1 })).toEqual(["a", "b"]);
  });
});
