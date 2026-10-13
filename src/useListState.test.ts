import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { LIST_PREFS_KEY, TPL_LIMIT_KEY } from "./listPrefs";
import type { ListKey } from "./listPrefs";
import { useListState } from "./useListState";

function fakeWindow(backing?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(backing ?? {}));
  return {
    localStorage: {
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
      removeItem: (k: string) => {
        m.delete(k);
      },
    },
  };
}

const ITEMS = ["a", "b", "c", "d", "e", "f", "g", "h"];

function renderState(key: ListKey, count: number, limit?: number): Record<string, string> {
  function Probe() {
    const s = useListState<string>({
      key,
      select: () => ITEMS.slice(0, count),
      limit,
    });
    return React.createElement("div", {
      "data-query": s.query,
      "data-limit": String(s.limit),
      "data-shown": String(s.shown),
      "data-filtered": String(s.filtered.length),
      "data-visible": String(s.visible.length),
      "data-active": String(s.nav.active),
      "data-fns": [s.changeQuery, s.changeLimit, s.showMore, s.ensureVisible, s.resetShown, s.resetNavigation].every((f) => typeof f === "function") ? "ok" : "bad",
    });
  }
  const html = renderToStaticMarkup(React.createElement(Probe));
  const get = (name: string): string => {
    const m = html.match(new RegExp(name + "=\"([^\"]*)\""));
    return m ? m[1] : "";
  };
  return {
    query: get("data-query"),
    limit: get("data-limit"),
    shown: get("data-shown"),
    filtered: get("data-filtered"),
    visible: get("data-visible"),
    active: get("data-active"),
    fns: get("data-fns"),
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).window;
});

describe("useListState", () => {
  it("starts with empty query, default limit and full api", () => {
    const s = renderState("notes", 7);
    expect(s.query).toBe("");
    expect(s.limit).toBe("10");
    expect(s.shown).toBe("10");
    expect(s.filtered).toBe("7");
    expect(s.visible).toBe("7");
    expect(s.active).toBe("0");
    expect(s.fns).toBe("ok");
  });
  it("slices visible rows to the stored limit", () => {
    (globalThis as unknown as Record<string, unknown>).window = fakeWindow({
      [LIST_PREFS_KEY]: JSON.stringify({ tasks: 5 }),
    });
    const s = renderState("tasks", 8);
    expect(s.limit).toBe("5");
    expect(s.filtered).toBe("8");
    expect(s.visible).toBe("5");
    expect(renderState("notes", 8).visible).toBe("8");
  });
  it("inherits the legacy bare value for prompts", () => {
    (globalThis as unknown as Record<string, unknown>).window = fakeWindow({ [TPL_LIMIT_KEY]: "25" });
    expect(renderState("prompts", 3).limit).toBe("25");
    expect(renderState("tasks", 3).limit).toBe("10");
  });
  it("prefers a controlled limit when the parent owns it", () => {
    const s = renderState("prompts", 3, 5);
    expect(s.limit).toBe("5");
    expect(s.shown).toBe("5");
  });
});
