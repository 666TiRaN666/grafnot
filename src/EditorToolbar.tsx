import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { RefObject } from "react";
import type { Editor } from "@tiptap/react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import { Icon, MenuButton, MenuPopup } from "./widgets";
import type { MenuItem } from "./widgets";
import { FONT_FAMILIES, FONT_SIZES, LINE_HEIGHTS, MARK_COLORS, TEXT_COLORS, findKey } from "./editorExtensions";
import type { Align, FontKey, SizeKey, Spacing } from "./editorExtensions";
import { usePopover } from "./ui/dismiss";

type Tri = boolean | "mixed";

/** On, off, or mixed over a partly formatted selection (aria-pressed). */
function markState(editor: Editor, name: string): Tri {
  if (editor.isActive(name)) return true;
  const { from, to, empty } = editor.state.selection;
  const type = editor.schema.marks[name];
  if (empty || !type) return false;
  return editor.state.doc.rangeHasMark(from, to, type) ? "mixed" : false;
}

/** Toolbar controls keep the text selection: no focus theft on mouse down. */
const keepSelection = (e: React.MouseEvent) => e.preventDefault();
const TB = { "data-tb": "1", onMouseDown: keepSelection };
const colorLabel = (c: string, lang: Lang) =>
  ({ red: tr("c_red", lang), orange: tr("c_orange", lang), green: tr("c_green", lang), blue: tr("c_blue", lang), purple: tr("c_purple", lang), gray: tr("c_gray", lang), yellow: tr("c_yellow", lang), pink: tr("c_pink", lang) })[c] ?? c;

/**
 * Formatting bar of the note editor. Groups: history · paragraph style ·
 * font · emphasis · colour · lists · paragraph · link · table · find.
 * One Tab stop (WAI-ARIA toolbar): arrows, Home and End move inside; menus
 * open with Enter or ArrowDown. Every command runs on the editor's own
 * selection and returns focus to the text.
 */
export function EditorToolbar({ editor, lang, findOpen, onFind }: { editor: Editor; lang: Lang; findOpen: boolean; onFind: () => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const linkBtn = useRef<HTMLButtonElement>(null);
  // Commands run on the editor's own selection; focus returns at once.
  // Not chain().focus(): it focuses again a frame later and writes the old
  // selection back over a caret the user has already moved (End right after
  // a colour lost the line on Enter).
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => {
    const ok = fn(editor.chain()).run();
    if (!editor.isDestroyed) editor.view.focus();
    return ok;
  };

  // Roving tabindex: the last focused control keeps the single Tab stop.
  useEffect(() => {
    const items = [...(bar.current?.querySelectorAll<HTMLElement>("[data-tb]") ?? [])];
    if (!items.some((el) => el.dataset.tbActive)) items[0]?.setAttribute("data-tb-active", "1");
    for (const el of items) el.tabIndex = el.dataset.tbActive ? 0 : -1;
  });
  const onFocusIn = (e: React.FocusEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tb]");
    if (!t) return;
    for (const el of bar.current?.querySelectorAll<HTMLElement>("[data-tb]") ?? []) {
      if (el === t) el.setAttribute("data-tb-active", "1");
      else el.removeAttribute("data-tb-active");
      el.tabIndex = el === t ? 0 : -1;
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('[role="menu"], .n-linkpop')) return;
    const items = [...(bar.current?.querySelectorAll<HTMLElement>("[data-tb]") ?? [])];
    const at = items.indexOf((e.target as HTMLElement).closest<HTMLElement>("[data-tb]") as HTMLElement);
    const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
    if (e.key === "ArrowRight") go(at + 1);
    else if (e.key === "ArrowLeft") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); editor.view.focus(); }
  };

  const toggle = (name: string, label: string, icon: React.ReactNode, cmd: () => void, testid: string) => {
    const state = markState(editor, name);
    return (
      <button type="button" className="n-tb" {...TB} data-testid={testid} aria-pressed={state} title={label} aria-label={label} onClick={cmd}>
        {icon}
      </button>
    );
  };
  const blockToggle = (active: boolean, label: string, icon: React.ReactNode, cmd: () => void, testid: string) => (
    <button type="button" className="n-tb" {...TB} data-testid={testid} aria-pressed={active} title={label} aria-label={label} onClick={cmd}>
      {icon}
    </button>
  );

  // Paragraph style
  const styles: { key: string; label: string; active: boolean; run: () => void }[] = [
    { key: "p", label: tr("stNormal", lang), active: editor.isActive("paragraph") && !editor.isActive("blockquote") && !editor.isActive("codeBlock"), run: () => run((c) => c.setParagraph()) },
    ...([1, 2, 3] as const).map((level) => ({ key: "h" + level, label: [tr("stH1", lang), tr("stH2", lang), tr("stH3", lang)][level - 1] ?? "", active: editor.isActive("heading", { level }), run: () => run((c) => c.setHeading({ level })) })),
    { key: "quote", label: tr("stQuote", lang), active: editor.isActive("blockquote"), run: () => run((c) => c.toggleBlockquote()) },
    { key: "code", label: tr("stCode", lang), active: editor.isActive("codeBlock"), run: () => run((c) => c.toggleCodeBlock()) },
  ];
  const currentStyle = styles.find((s) => s.active && s.key !== "p") ?? styles[0];

  const ts = editor.getAttributes("textStyle") as { color?: string; fontFamily?: FontKey; fontSize?: SizeKey };
  const hl = editor.isActive("highlight") ? (editor.getAttributes("highlight").color as string) : null;
  const para = editor.getAttributes(editor.isActive("heading") ? "heading" : "paragraph") as { textAlign?: Align | null; lineHeight?: string | null; spacing?: Spacing | null; indent?: number };
  const align: Align = para.textAlign ?? "left";
  const alignIcon = { left: "alignLeft", center: "alignCenter", right: "alignRight", justify: "alignJustify" } as const;
  const inTable = editor.isActive("table");

  const radio = (checked: boolean, label: string, onPick: () => void, key: string, extra?: React.ReactNode) => (
    <button key={key} type="button" role="menuitemradio" aria-checked={checked} tabIndex={-1} className="n-menuitem n-radio" onMouseDown={keepSelection} onClick={onPick}>
      <span className="n-radio-mark" aria-hidden="true">{checked ? "✓" : ""}</span>
      {extra}
      <span>{label}</span>
    </button>
  );

  const moreItems: MenuItem[] = [
    { key: "sup", label: tr("tbSup", lang), run: () => run((c) => c.toggleSuperscript()) },
    { key: "sub", label: tr("tbSub", lang), run: () => run((c) => c.toggleSubscript()) },
    { key: "code", label: tr("tbCode", lang), run: () => run((c) => c.toggleCode()) },
    { key: "clear", label: tr("tbClear", lang), run: () => run((c) => c.clearFormatting()), group: true },
  ];
  const tableItems: MenuItem[] = [
    { key: "row-above", label: tr("tRowAbove", lang), run: () => run((c) => c.tableCommand("addRowBefore")) },
    { key: "row-below", label: tr("tRowBelow", lang), run: () => run((c) => c.tableCommand("addRowAfter")) },
    { key: "col-left", label: tr("tColLeft", lang), run: () => run((c) => c.tableCommand("addColumnBefore")), group: true },
    { key: "col-right", label: tr("tColRight", lang), run: () => run((c) => c.tableCommand("addColumnAfter")) },
    { key: "header", label: tr("tHeader", lang), run: () => run((c) => c.tableCommand("toggleHeaderRow")), group: true },
    { key: "del-row", label: tr("tDelRow", lang), run: () => run((c) => c.tableCommand("deleteRow")), danger: true, group: true },
    { key: "del-col", label: tr("tDelCol", lang), run: () => run((c) => c.tableCommand("deleteColumn")), danger: true },
    { key: "del-table", label: tr("tDelTable", lang), run: () => run((c) => c.tableCommand("deleteTable")), danger: true },
  ];

  return (
    <div className="n-toolbar" ref={bar} role="toolbar" aria-label={tr("tbA", lang)} data-testid="editor-toolbar" onFocus={onFocusIn} onKeyDown={onKeyDown}>
      <div className="n-tbgroup">
        <button type="button" className="n-tb" {...TB} data-testid="tb-undo" title={tr("tbUndo", lang)} aria-label={tr("tbUndo", lang)} disabled={!editor.can().undo()} onClick={() => run((c) => c.undo())}><Icon n="undo" /></button>
        <button type="button" className="n-tb" {...TB} data-testid="tb-redo" title={tr("tbRedo", lang)} aria-label={tr("tbRedo", lang)} disabled={!editor.can().redo()} onClick={() => run((c) => c.redo())}><Icon n="redo" /></button>
      </div>
      <div className="n-tbgroup">
        <MenuButton testid="tb-style" className="n-tb n-tb-text n-tb-style" ariaLabel={tr("tbStyle", lang)} triggerExtra={TB}
          items={styles.map((s) => ({ key: s.key, label: (s.active ? "✓ " : "") + s.label, run: s.run }))}>
          <span className="n-tb-stylelbl">{currentStyle?.label}</span> <span aria-hidden="true">▾</span>
        </MenuButton>
        <MenuPopup testid="tb-font" label={<><span className="n-tb-aa" aria-hidden="true">Aa</span> <span aria-hidden="true">▾</span></>} ariaLabel={tr("tbFont", lang)} className="n-tb n-tb-text" menuClassName="g-menu n-tbmenu" triggerExtra={TB}>
          {(close) => (
            <>
              <span className="n-menuhead muted small" role="presentation">{tr("fontFamilyL", lang)}</span>
              {(Object.keys(FONT_FAMILIES) as FontKey[]).map((k) => radio((ts.fontFamily ?? "sans") === k, tr(k === "sans" ? "fontSans" : k === "serif" ? "fontSerif" : "fontMono", lang), () => { run((c) => c.setFontFamily(k === "sans" ? null : k)); close(); }, "f-" + k, <span className="n-fontsample" data-font={k} aria-hidden="true">Aa</span>))}
              <span role="separator" className="n-menusep" />
              <span className="n-menuhead muted small" role="presentation">{tr("sizeL", lang)}</span>
              {(Object.keys(FONT_SIZES) as SizeKey[]).map((k) => radio((ts.fontSize ?? "md") === k, tr(k === "sm" ? "sizeSm" : k === "md" ? "sizeMd" : k === "lg" ? "sizeLg" : "sizeXl", lang), () => { run((c) => c.setFontSize(k === "md" ? null : k)); close(); }, "s-" + k))}
            </>
          )}
        </MenuPopup>
      </div>
      <div className="n-tbgroup">
        {toggle("bold", tr("tbBold", lang), <b className="n-tb-glyph">B</b>, () => run((c) => c.toggleBold()), "tb-bold")}
        {toggle("italic", tr("tbItalic", lang), <i className="n-tb-glyph">I</i>, () => run((c) => c.toggleItalic()), "tb-italic")}
        {toggle("underline", tr("tbUnderline", lang), <u className="n-tb-glyph">U</u>, () => run((c) => c.toggleUnderline()), "tb-underline")}
        {toggle("strike", tr("tbStrike", lang), <s className="n-tb-glyph">S</s>, () => run((c) => c.toggleStrike()), "tb-strike")}
        <MenuPopup testid="tb-color" ariaLabel={tr("tbColor", lang)} className="n-tb" menuClassName="g-menu n-tbmenu n-colors" triggerExtra={TB}
          label={<span className="n-tb-colorA" data-color={ts.color ?? undefined} data-mark={hl ?? undefined} aria-hidden="true">A</span>}>
          {(close) => (
            <>
              <span className="n-menuhead muted small" role="presentation">{tr("colorText", lang)}</span>
              <span className="n-swatches" role="group" aria-label={tr("colorText", lang)}>
                {[null, ...TEXT_COLORS].map((c) => (
                  <button key={"t" + c} type="button" role="menuitemradio" aria-checked={(ts.color ?? null) === c} tabIndex={-1} className="n-swatch" data-color={c ?? "auto"} data-testid={`tb-color-${c ?? "auto"}`}
                    title={c ? colorLabel(c, lang) : tr("colorAuto", lang)} aria-label={c ? colorLabel(c, lang) : tr("colorAuto", lang)}
                    onMouseDown={keepSelection} onClick={() => { run((ch) => ch.setTextColor(c)); close(); }}>A</button>
                ))}
              </span>
              <span className="n-menuhead muted small" role="presentation">{tr("colorMark", lang)}</span>
              <span className="n-swatches" role="group" aria-label={tr("colorMark", lang)}>
                {[null, ...MARK_COLORS].map((c) => (
                  <button key={"m" + c} type="button" role="menuitemradio" aria-checked={hl === c} tabIndex={-1} className="n-swatch n-swatch-mark" data-mark={c ?? "none"} data-testid={`tb-mark-${c ?? "none"}`}
                    title={c ? colorLabel(c, lang) : tr("colorNone", lang)} aria-label={c ? colorLabel(c, lang) : tr("colorNone", lang)}
                    onMouseDown={keepSelection} onClick={() => { run((ch) => ch.setHighlight(c)); close(); }}>{c ? "" : "∅"}</button>
                ))}
              </span>
            </>
          )}
        </MenuPopup>
        <MenuButton testid="tb-more" className="n-tb" ariaLabel={tr("tbMore", lang)} triggerExtra={TB} items={moreItems}>
          <Icon n="more" />
        </MenuButton>
      </div>
      <div className="n-tbgroup">
        {blockToggle(editor.isActive("bulletList"), tr("tbBullet", lang), <Icon n="listBullet" />, () => run((c) => c.toggleBulletList()), "tb-bullet")}
        {blockToggle(editor.isActive("orderedList"), tr("tbOrdered", lang), <Icon n="listOrdered" />, () => run((c) => c.toggleOrderedList()), "tb-ordered")}
        {blockToggle(editor.isActive("taskList"), tr("tbTask", lang), <Icon n="listTask" />, () => run((c) => c.toggleTaskList()), "tb-task")}
        <MenuPopup testid="tb-para" ariaLabel={tr("tbPara", lang)} className="n-tb" menuClassName="g-menu n-tbmenu" triggerExtra={TB} label={<Icon n={alignIcon[align]} />}>
          {(close) => (
            <>
              <span className="n-menuhead muted small" role="presentation">{tr("alignL", lang)}</span>
              {(["left", "center", "right", "justify"] as const).map((a) => radio(align === a, tr(a === "left" ? "alLeft" : a === "center" ? "alCenter" : a === "right" ? "alRight" : "alJustify", lang), () => { run((c) => c.setTextAlign(a)); close(); }, "a-" + a, <Icon n={alignIcon[a]} size={16} />))}
              <span role="separator" className="n-menusep" />
              <span className="n-menuhead muted small" role="presentation">{tr("lhL", lang)}</span>
              <span className="n-inline-radios">
                {[null, ...LINE_HEIGHTS].map((v) => radio((para.lineHeight ?? null) === v, v ?? tr("spNormal", lang), () => { run((c) => c.setLineHeight(v)); close(); }, "lh-" + (v ?? "auto")))}
              </span>
              <span className="n-menuhead muted small" role="presentation">{tr("spL", lang)}</span>
              {(["none", "normal", "wide"] as const).map((v) => radio((para.spacing ?? "normal") === v, tr(v === "none" ? "spNone" : v === "normal" ? "spNormal" : "spWide", lang), () => { run((c) => c.setBlockSpacing(v)); close(); }, "sp-" + v))}
              <span role="separator" className="n-menusep" />
              <button type="button" role="menuitem" tabIndex={-1} className="n-menuitem" data-testid="tb-indent" onMouseDown={keepSelection} onClick={() => run((c) => c.indent())}><Icon n="indentMore" size={16} /> {tr("indMore", lang)}</button>
              <button type="button" role="menuitem" tabIndex={-1} className="n-menuitem" data-testid="tb-outdent" disabled={!para.indent} onMouseDown={keepSelection} onClick={() => run((c) => c.outdent())}><Icon n="indentLess" size={16} /> {tr("indLess", lang)}</button>
            </>
          )}
        </MenuPopup>
      </div>
      <div className="n-tbgroup">
        <span className="g-menuwrap">
          <button ref={linkBtn} type="button" className="n-tb" {...TB} data-testid="tb-link" aria-pressed={editor.isActive("link")} aria-expanded={linkOpen} title={tr("tbLink", lang)} aria-label={tr("tbLink", lang)} onClick={() => setLinkOpen((v) => !v)}>
            <Icon n="link" />
          </button>
          {linkOpen && <LinkEditor editor={editor} lang={lang} trigger={linkBtn} onClose={() => setLinkOpen(false)} />}
        </span>
        {inTable && (
          <MenuButton testid="tb-table" className="n-tb" ariaLabel={tr("tbTable", lang)} triggerExtra={TB} items={tableItems}>
            <Icon n="table" />
          </MenuButton>
        )}
        <button type="button" className="n-tb" {...TB} data-testid="tb-find" aria-pressed={findOpen} title={tr("tbFind", lang)} aria-label={tr("tbFind", lang)} onClick={onFind}>
          <Icon n="search" />
        </button>
      </div>
    </div>
  );
}

/** Link address of the selection: edit, remove, open. Empty selection inserts the address as linked text. */
function LinkEditor({ editor, lang, trigger, onClose }: { editor: Editor; lang: Lang; trigger: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const current = (editor.getAttributes("link").href as string | undefined) ?? "";
  const [href, setHref] = useState(current);
  const [bad, setBad] = useState(false);
  // Outside press and Esc close (ui/dismiss); Esc puts the caret back in the text.
  const { ref: root } = usePopover<HTMLDivElement>(true, onClose, { trigger, returnFocus: () => editor.view.focus() });
  useEffect(() => {
    root.current?.querySelector("input")?.select();
  }, [root]);
  const apply = () => {
    const raw = href.trim();
    if (!raw) return;
    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw;
    if (!/^(https?:|mailto:)/i.test(url)) { setBad(true); return; }
    const { empty } = editor.state.selection;
    const ok = empty && !editor.isActive("link")
      ? editor.chain().insertContent({ type: "text", text: raw, marks: [{ type: "link", attrs: { href: url } }] }).run()
      : editor.chain().extendMarkRange("link").setLink({ href: url }).run();
    if (!ok) { setBad(true); return; }
    onClose();
    editor.view.focus();
  };
  return (
    <div ref={root} className="n-linkpop" role="dialog" aria-label={tr("tbLink", lang)} data-testid="link-editor">
      <label className="n-linkfield">
        <span className="muted small">{tr("linkUrl", lang)}</span>
        <input data-testid="link-url" type="url" inputMode="url" autoComplete="off" value={href} aria-invalid={bad} placeholder="https://"
          onChange={(e) => { setHref(e.target.value); setBad(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }} />
      </label>
      {bad && <p className="u-error" role="alert">{tr("linkBad", lang)}</p>}
      <p className="muted small n-linkhint">{tr("linkHint", lang)}</p>
      <div className="n-linkactions">
        {current && <button type="button" className="g-btn sm danger" data-testid="link-remove" onClick={() => { editor.chain().extendMarkRange("link").unsetLink().run(); onClose(); editor.view.focus(); }}>{tr("linkRemove", lang)}</button>}
        {current && <a className="g-btn sm" href={current} target="_blank" rel="noopener noreferrer">{tr("linkOpen", lang)}</a>}
        <button type="button" className="g-btn sm primary" data-testid="link-apply" disabled={!href.trim()} onClick={apply}>{tr("linkApply", lang)}</button>
      </div>
    </div>
  );
}

/** Find and replace inside the open note (decorations; Undo restores replacements). */
export function FindBar({ editor, lang, onClose }: { editor: Editor; lang: Lang; onClose: () => void }) {
  const initial = (() => {
    const { from, to, empty } = editor.state.selection;
    return empty ? "" : editor.state.doc.textBetween(from, to, " ").slice(0, 80);
  })();
  const [term, setTerm] = useState(initial);
  const [repl, setRepl] = useState("");
  const [cs, setCs] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, []);
  useEffect(() => {
    editor.commands.setFind(term, cs);
  }, [editor, term, cs]);
  useEffect(() => () => { if (!editor.isDestroyed) editor.commands.setFind(""); }, [editor]);
  const s = findKey.getState(editor.state);
  const n = s?.matches.length ?? 0;
  const close = () => { onClose(); if (!editor.isDestroyed) editor.view.focus(); };
  return (
    <div className="n-findbar" role="search" aria-label={tr("findA", lang)} data-testid="find-bar"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <input ref={findRef} className="g-in n-findin" data-testid="find-input" value={term} placeholder={tr("findPh", lang)} aria-label={tr("findPh", lang)}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor.commands.findStep(e.shiftKey ? -1 : 1); } }} />
      <span className="n-findcount" aria-live="polite" data-testid="find-count">
        {term ? (n ? tr("findCount", lang).replace("{i}", String((s?.index ?? 0) + 1)).replace("{n}", String(n)) : tr("findNone", lang)) : ""}
      </span>
      <button type="button" className="g-iconbtn" title={tr("findPrev", lang)} aria-label={tr("findPrev", lang)} disabled={!n} onClick={() => editor.commands.findStep(-1)}><Icon n="chevL" /></button>
      <button type="button" className="g-iconbtn" title={tr("findNext", lang)} aria-label={tr("findNext", lang)} disabled={!n} onClick={() => editor.commands.findStep(1)}><Icon n="chevR" /></button>
      <label className="n-findcase"><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> {tr("findCase", lang)}</label>
      <input className="g-in n-findin" data-testid="replace-input" value={repl} placeholder={tr("replacePh", lang)} aria-label={tr("replacePh", lang)}
        onChange={(e) => setRepl(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor.commands.replaceCurrent(repl); } }} />
      <button type="button" className="g-btn sm" data-testid="replace-one" disabled={!n} onClick={() => editor.commands.replaceCurrent(repl)}>{tr("replaceOne", lang)}</button>
      <button type="button" className="g-btn sm" data-testid="replace-all" disabled={!n} onClick={() => editor.commands.replaceAll(repl)}>{tr("replaceAllBtn", lang)}</button>
      <button type="button" className="g-iconbtn" title={tr("findClose", lang)} aria-label={tr("findClose", lang)} data-testid="find-close" onClick={close}><Icon n="close" size={16} /></button>
    </div>
  );
}
