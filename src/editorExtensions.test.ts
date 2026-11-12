import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { checkContent, findMatches, richTextExtensions } from "./editorExtensions";

const schema = getSchema(richTextExtensions());
const old = getSchema([StarterKit]);

// A note as the editor stored it before 2026-11 (StarterKit defaults, heading 3).
const LEGACY = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "План" }] },
    { type: "paragraph", content: [{ type: "text", marks: [{ type: "bold" }], text: "жирный" }, { type: "text", text: "\tс табом" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "пункт" }] }] }] },
    { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "x = 1" }] },
  ],
};

const strip = (j: unknown): unknown => JSON.parse(JSON.stringify(j));
/** Defaults the new schema adds (attrs at their default) do not change meaning. */
const withoutDefaults = (j: unknown): unknown => JSON.parse(JSON.stringify(j, (k, v) => {
  if (k === "attrs" && v && typeof v === "object") {
    const rest = Object.fromEntries(Object.entries(v).filter(([a, x]) => !((a === "indent" && x === 0) || (["textAlign", "lineHeight", "spacing"].includes(a) && x === null))));
    return Object.keys(rest).length ? rest : undefined;
  }
  // The schema orders marks by rank; the order carries no meaning.
  if (k === "marks" && Array.isArray(v)) return [...v].sort((x, y) => String(x.type).localeCompare(String(y.type)));
  return v;
}));

describe("note schema compatibility", () => {
  it("old notes load unchanged: same text, marks, lists, code and tab characters", () => {
    expect(checkContent(schema, LEGACY)).toEqual({ ok: true });
    const before = withoutDefaults(old.nodeFromJSON(LEGACY).toJSON());
    const after = withoutDefaults(schema.nodeFromJSON(LEGACY).toJSON());
    expect(after).toEqual(before);
  });

  it("new formatting survives save and reload (JSON round trip)", () => {
    const rich = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1, indent: 0, textAlign: "center", lineHeight: null, spacing: null }, content: [{ type: "text", text: "Заголовок" }] },
        { type: "paragraph", attrs: { indent: 2, textAlign: "justify", lineHeight: "1.5", spacing: "wide" }, content: [
          { type: "text", marks: [{ type: "bold" }, { type: "italic" }, { type: "highlight", attrs: { color: "green" } }, { type: "textStyle", attrs: { color: "red", fontFamily: "serif", fontSize: "lg" } }], text: "всё сразу" },
          { type: "text", marks: [{ type: "superscript" }], text: "2" },
          { type: "text", marks: [{ type: "underline" }, { type: "strike" }, { type: "link", attrs: { href: "https://example.org", target: "_blank", rel: "noopener noreferrer nofollow", class: null, title: null } }], text: "ссылка" },
        ] },
        { type: "orderedList", attrs: { start: 3, type: null }, content: [{ type: "listItem", content: [{ type: "paragraph", attrs: { indent: 0, textAlign: null, lineHeight: null, spacing: null }, content: [{ type: "text", text: "три" }] }] }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", attrs: { indent: 0, textAlign: null, lineHeight: null, spacing: null }, content: [{ type: "text", text: "готово" }] }] }] },
        { type: "table", content: [{ type: "tableRow", content: [
          { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", attrs: { indent: 0, textAlign: null, lineHeight: null, spacing: null }, content: [{ type: "text", text: "A" }] }] },
          { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", attrs: { indent: 0, textAlign: null, lineHeight: null, spacing: null } }] },
        ] }] },
        { type: "blockquote", content: [{ type: "paragraph", attrs: { indent: 0, textAlign: null, lineHeight: null, spacing: null }, content: [{ type: "text", text: "цитата" }] }] },
        { type: "horizontalRule" },
      ],
    };
    const node = schema.nodeFromJSON(rich);
    node.check();
    const back = strip(node.toJSON()) as { content: { type: string }[] };
    expect(withoutDefaults(back)).toEqual(withoutDefaults(rich));
    expect(back.content.map((n) => n.type)).toEqual(["heading", "paragraph", "orderedList", "taskList", "table", "blockquote", "horizontalRule"]);
  });

  it("content from an unknown future schema is reported, never dropped silently", () => {
    const res = checkContent(schema, { type: "doc", content: [{ type: "kanbanBoard", content: [] }] });
    expect(res.ok).toBe(false);
    expect(checkContent(schema, "<p>legacy html</p>")).toEqual({ ok: true });
  });

  it("find matches across marks, case-insensitive by default", () => {
    const d = schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ab" }, { type: "text", marks: [{ type: "bold" }], text: "c ab" }] }] });
    expect(findMatches(d, "abc", false)).toEqual([{ from: 1, to: 4 }]);
    expect(findMatches(d, "ab", false).length).toBe(2);
    expect(findMatches(d, "ab", true).length).toBe(1);
  });
});
