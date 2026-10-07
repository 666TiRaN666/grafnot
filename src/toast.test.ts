import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TOAST_VISIBLE_MAX, ToastStack, dismissToast } from "./widgets";
import type { ToastMsg } from "./widgets";

const A: ToastMsg = { id: 1, text: "one" };
const B: ToastMsg = { id: 2, text: "two" };

describe("dismissToast", () => {
  it("removes the toast by id and keeps order", () => {
    expect(dismissToast([A, B], 1)).toEqual([B]);
  });
  it("keeps everything on unknown id", () => {
    expect(dismissToast([A, B], 9)).toEqual([A, B]);
  });
  it("handles empty stack", () => {
    expect(dismissToast([], 1)).toEqual([]);
  });
});

describe("ToastStack queue", () => {
  const html = (items: ToastMsg[]) => renderToStaticMarkup(React.createElement(ToastStack, { items, lang: "RU" }));
  const msgs = (n: number): ToastMsg[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, text: `t${i + 1}` }));
  it(`shows at most ${TOAST_VISIBLE_MAX} toasts without a counter`, () => {
    const h = html(msgs(2));
    expect(h.match(/class="g-toast"/g)?.length ?? 0).toBe(2);
    expect(h).not.toContain("g-toast-more");
  });
  it("collapses older overflow into a +N badge, newest stay visible", () => {
    const h = html(msgs(5));
    expect(h.match(/class="g-toast"/g)?.length ?? 0).toBe(TOAST_VISIBLE_MAX);
    expect(h).toContain("+2");
    expect(h).not.toContain("t1");
    expect(h).toContain("t5");
    expect(h.indexOf("t3")).toBeLessThan(h.indexOf("t5"));
  });
});
