import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { armKey, confirmKey, resetKey, useArmConfirm } from "./useArmConfirm";

const EMPTY: ReadonlySet<string> = new Set();

describe("armKey", () => {
  it("arms one key", () => {
    const next = armKey(EMPTY, "a");
    expect([...next]).toEqual(["a"]);
    expect([...EMPTY]).toEqual([]);
  });
  it("re-arm keeps a single entry", () => {
    const once = armKey(EMPTY, "a");
    expect(armKey(once, "a")).toBe(once);
  });
});

describe("resetKey", () => {
  it("drops one key and keeps the rest", () => {
    expect([...resetKey(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });
  it("missing key returns the same set", () => {
    const s = new Set(["a"]);
    expect(resetKey(s, "zzz")).toBe(s);
  });
});

describe("confirmKey", () => {
  it("first call arms and reports false", () => {
    const r = confirmKey(EMPTY, "a");
    expect(r.confirmed).toBe(false);
    expect([...r.next]).toEqual(["a"]);
  });
  it("second call disarms and reports true", () => {
    const armed = armKey(EMPTY, "a");
    const r = confirmKey(armed, "a");
    expect(r.confirmed).toBe(true);
    expect([...r.next]).toEqual([]);
  });
  it("re-arm after confirm starts over", () => {
    const armed = armKey(EMPTY, "a");
    const done = confirmKey(armed, "a");
    const again = confirmKey(done.next, "a");
    expect(again.confirmed).toBe(false);
    expect([...again.next]).toEqual(["a"]);
  });
  it("missing key arms instead of confirming", () => {
    const r = confirmKey(new Set(["a"]), "zzz");
    expect(r.confirmed).toBe(false);
    expect([...r.next].sort()).toEqual(["a", "zzz"]);
  });
});

describe("n colon t independence", () => {
  it("row keys do not affect each other", () => {
    let s = armKey(EMPTY, "n:1");
    s = armKey(s, "t:2");
    expect(confirmKey(s, "n:1").confirmed).toBe(true);
    const rest = resetKey(s, "n:1");
    expect([...rest]).toEqual(["t:2"]);
    expect(confirmKey(rest, "t:2").confirmed).toBe(true);
  });
});

describe("useArmConfirm", () => {
  it("starts disarmed with full api", () => {
    function Probe() {
      const a = useArmConfirm();
      const fns = [a.arm, a.isArmed, a.reset, a.resetAll, a.confirm];
      return React.createElement("div", {
        "data-n": String(a.isArmed("n:1")),
        "data-fns": fns.every((f) => typeof f === "function") ? "ok" : "bad",
      });
    }
    const html = renderToStaticMarkup(React.createElement(Probe));
    expect(html.includes("false")).toBe(true);
    expect(html.includes("ok")).toBe(true);
  });
});
