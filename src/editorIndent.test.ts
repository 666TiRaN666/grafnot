import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { BlockFormat, changeIndent } from "./editorExtensions";
import { outdentLegacyTabs } from "./editorIndent";

const schema = getSchema([StarterKit, BlockFormat]);
const doc = (...paras: string[]) =>
  schema.node("doc", null, paras.map((t) => schema.node("paragraph", null, t ? [schema.text(t)] : [])));
const run = (state: EditorState, cmd: (s: EditorState, d: (tr: Transaction) => void) => boolean) => {
  let next = state;
  const ok = cmd(state, (tr) => { next = state.apply(tr); });
  return { ok, state: next };
};
const indents = (s: EditorState) => {
  const out: number[] = [];
  s.doc.forEach((n) => out.push(n.attrs.indent as number));
  return out;
};
const at = (s: EditorState, from: number, to = from) => s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));

describe("block indent (Tab / Shift+Tab)", () => {
  it("repeated Tab raises the level of a filled and of an empty paragraph, never adding characters", () => {
    let s = at(EditorState.create({ doc: doc("abc", "") }), 1);
    for (let i = 0; i < 3; i++) s = run(s, (st, d) => changeIndent(st, d, 1)).state;
    s = at(s, 6);
    s = run(s, (st, d) => changeIndent(st, d, 1)).state;
    expect(indents(s)).toEqual([3, 1]);
    expect(s.doc.textContent).toBe("abc");
  });

  it("a multi-block selection indents and outdents every block, capped at 0 and 8", () => {
    let s = at(EditorState.create({ doc: doc("one", "two", "three") }), 2, 7);
    for (let i = 0; i < 12; i++) s = run(s, (st, d) => changeIndent(st, d, 1)).state;
    expect(indents(s)).toEqual([8, 8, 0]);
    s = run(s, (st, d) => changeIndent(st, d, -1)).state;
    expect(indents(s)).toEqual([7, 7, 0]);
    const zero = at(EditorState.create({ doc: doc("x") }), 1);
    expect(run(zero, (st, d) => changeIndent(st, d, -1)).ok).toBe(false);
  });

  it("paragraphs inside a list keep no indent level (lists nest instead)", () => {
    const d = schema.nodeFromJSON({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "a" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] }] },
    ] });
    let s = EditorState.create({ doc: d });
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, s.doc.content.size - 2)));
    s = run(s, (st, dsp) => changeIndent(st, dsp, 1)).state;
    expect((s.doc.toJSON() as { content: { attrs?: { indent?: number }; content?: { content: { attrs: { indent: number } }[] }[] }[] }).content[1]?.content?.[0]?.content[0]?.attrs.indent).toBe(0);
    expect(s.doc.firstChild?.attrs.indent).toBe(1);
  });

  it("Shift+Tab tidies leading tab characters of older notes", () => {
    let s = at(EditorState.create({ doc: doc("\t\tone") }), 3);
    s = run(s, outdentLegacyTabs).state;
    expect(s.doc.textContent).toBe("\tone");
  });
});
