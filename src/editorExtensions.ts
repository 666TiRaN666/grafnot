// Rich-text model of the note editor (Tiptap 3, ProseMirror schema).
//
// Names of nodes, marks and attributes follow the official Tiptap packages
// (@tiptap/extension-text-style, -highlight, -text-align, -subscript,
// -superscript, -table), which are not installed: the project adds no npm
// dependencies, so these are written on the documented extension API. Notes
// stay compatible if the official packages replace them later. Everything is
// additive: documents saved before 2026-11 are valid in this schema
// (editorExtensions.test.ts).
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import type { CommandProps } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, CellSelection, deleteCellSelection, deleteColumn, deleteRow, deleteTable,
  goToNextCell, isInTable, tableEditing, toggleHeaderRow,
} from '@tiptap/pm/tables';

/** Block types that carry paragraph formatting (indent, alignment, spacing). */
export const BLOCKS = ['paragraph', 'heading'] as const;
export const MAX_INDENT = 8;
export type Align = 'left' | 'center' | 'right' | 'justify';
export const LINE_HEIGHTS = ['1', '1.15', '1.5', '2'] as const;
export type Spacing = 'none' | 'normal' | 'wide';
export const FONT_FAMILIES = { sans: 'var(--u-font)', serif: 'Georgia, "Times New Roman", serif', mono: 'var(--u-mono)' } as const;
export type FontKey = keyof typeof FONT_FAMILIES;
/** Relative to the note text (CSS maps `data-size`). */
export const FONT_SIZES = { sm: '0.875em', md: '1em', lg: '1.25em', xl: '1.6em' } as const;
export type SizeKey = keyof typeof FONT_SIZES;
/** Text and highlight colours: a short palette, legible in both themes (CSS maps them). */
export const TEXT_COLORS = ['red', 'orange', 'green', 'blue', 'purple', 'gray'] as const;
export const MARK_COLORS = ['yellow', 'green', 'blue', 'pink', 'gray'] as const;

const clampIndent = (n: number) => Math.max(0, Math.min(MAX_INDENT, Math.round(n) || 0));

/** Paragraph and heading blocks touched by the selection. */
function textBlocksIn(state: Pick<EditorState, 'doc' | 'selection'>): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if ((BLOCKS as readonly string[]).includes(node.type.name)) {
      out.push({ node, pos });
      return false;
    }
    return true;
  });
  return out;
}

/** Change one block attribute on every touched paragraph/heading in one step (one Undo). */
function setBlockAttr(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, attr: string, value: (current: unknown) => unknown): boolean {
  const blocks = textBlocksIn(state);
  if (blocks.length === 0) return false;
  const changes = blocks.map((b) => ({ ...b, next: value(b.node.attrs[attr]) })).filter((b) => b.next !== b.node.attrs[attr]);
  if (changes.length === 0) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const b of changes) tr.setNodeMarkup(b.pos, undefined, { ...b.node.attrs, [attr]: b.next });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** Lists nest and tables walk cells: their paragraphs take no indent level. */
const NO_INDENT_PARENTS = new Set(['listItem', 'taskItem', 'tableCell', 'tableHeader']);

/** Tab / Shift+Tab outside lists: block indent level, also for empty lines. */
export function changeIndent(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, delta: 1 | -1): boolean {
  const blocks = textBlocksIn(state).filter((b) => {
    const $p = state.doc.resolve(b.pos);
    for (let d = $p.depth; d > 0; d--) if (NO_INDENT_PARENTS.has($p.node(d).type.name)) return false;
    return true;
  });
  const changes = blocks.map((b) => ({ ...b, next: clampIndent(Number(b.node.attrs.indent ?? 0) + delta) })).filter((b) => b.next !== b.node.attrs.indent);
  if (changes.length === 0) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const b of changes) tr.setNodeMarkup(b.pos, undefined, { ...b.node.attrs, indent: b.next });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockFormat: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
      setTextAlign: (align: Align) => ReturnType;
      setLineHeight: (value: string | null) => ReturnType;
      setBlockSpacing: (value: Spacing | null) => ReturnType;
      /** Inline marks off, paragraph formatting back to normal (block type and lists stay). */
      clearFormatting: () => ReturnType;
    };
    textStyle: {
      setTextColor: (color: string | null) => ReturnType;
      setFontFamily: (font: FontKey | null) => ReturnType;
      setFontSize: (size: SizeKey | null) => ReturnType;
    };
    highlight: {
      setHighlight: (color: string | null) => ReturnType;
    };
    supSub: {
      toggleSuperscript: () => ReturnType;
      toggleSubscript: () => ReturnType;
    };
    table: {
      insertTable: (rows?: number, cols?: number) => ReturnType;
      tableCommand: (name: TableCommand) => ReturnType;
    };
    findReplace: {
      setFind: (term: string, caseSensitive?: boolean) => ReturnType;
      findStep: (dir: 1 | -1) => ReturnType;
      replaceCurrent: (text: string) => ReturnType;
      replaceAll: (text: string) => ReturnType;
    };
  }
}

/** indent · textAlign · lineHeight · spacing on paragraphs and headings. */
export const BlockFormat = Extension.create({
  name: 'blockFormat',
  addGlobalAttributes() {
    return [{
      types: [...BLOCKS],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (el) => clampIndent(Number(el.getAttribute('data-indent') ?? 0)),
          renderHTML: (a) => (a.indent ? { 'data-indent': a.indent, style: `--indent: ${a.indent}` } : {}),
        },
        textAlign: {
          default: null,
          parseHTML: (el) => (['center', 'right', 'justify'].includes(el.style.textAlign) ? el.style.textAlign : null),
          renderHTML: (a) => (a.textAlign ? { style: `text-align: ${a.textAlign}` } : {}),
        },
        lineHeight: {
          default: null,
          parseHTML: (el) => ((LINE_HEIGHTS as readonly string[]).includes(el.style.lineHeight) ? el.style.lineHeight : null),
          renderHTML: (a) => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}),
        },
        spacing: {
          default: null,
          parseHTML: (el) => (['none', 'wide'].includes(el.getAttribute('data-spacing') ?? '') ? el.getAttribute('data-spacing') : null),
          renderHTML: (a) => (a.spacing ? { 'data-spacing': a.spacing } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      indent: () => ({ state, dispatch }) => changeIndent(state, dispatch, 1),
      outdent: () => ({ state, dispatch }) => changeIndent(state, dispatch, -1),
      setTextAlign: (align) => ({ state, dispatch }) => setBlockAttr(state, dispatch, 'textAlign', () => (align === 'left' ? null : align)),
      setLineHeight: (value) => ({ state, dispatch }) => setBlockAttr(state, dispatch, 'lineHeight', () => value),
      setBlockSpacing: (value) => ({ state, dispatch }) => setBlockAttr(state, dispatch, 'spacing', () => (value === 'normal' ? null : value)),
      clearFormatting: () => ({ chain }) =>
        chain().unsetAllMarks()
          .command(({ tr }) => {
            for (const b of textBlocksIn(tr)) tr.setNodeMarkup(b.pos, undefined, { ...b.node.attrs, indent: 0, textAlign: null, lineHeight: null, spacing: null });
            return true;
          })
          .run(),
    };
  },
});

/** Inline style: colour, font family, font size (official name and shape: textStyle). */
export const TextStyle = Mark.create({
  name: 'textStyle',
  priority: 101,
  addAttributes() {
    return {
      color: { default: null, parseHTML: (el) => el.getAttribute('data-color') || null, renderHTML: (a) => (a.color ? { 'data-color': a.color } : {}) },
      fontFamily: { default: null, parseHTML: (el) => el.getAttribute('data-font') || null, renderHTML: (a) => (a.fontFamily ? { 'data-font': a.fontFamily } : {}) },
      fontSize: { default: null, parseHTML: (el) => el.getAttribute('data-size') || null, renderHTML: (a) => (a.fontSize ? { 'data-size': a.fontSize } : {}) },
    };
  },
  parseHTML() {
    return [{ tag: 'span', getAttrs: (el) => ((el as HTMLElement).hasAttribute('data-color') || (el as HTMLElement).hasAttribute('data-font') || (el as HTMLElement).hasAttribute('data-size') ? {} : false) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    // One mark carries three settings: unsetting the last one removes the mark.
    const set = (attr: 'color' | 'fontFamily' | 'fontSize', value: string | null) => ({ chain, editor }: CommandProps) => {
      const cur = editor.getAttributes('textStyle');
      const next = { color: cur.color ?? null, fontFamily: cur.fontFamily ?? null, fontSize: cur.fontSize ?? null, [attr]: value };
      return next.color || next.fontFamily || next.fontSize ? chain().setMark('textStyle', next).run() : chain().unsetMark('textStyle').run();
    };
    return {
      setTextColor: (color) => set('color', color),
      setFontFamily: (font) => set('fontFamily', font),
      setFontSize: (size) => set('fontSize', size),
    };
  },
});

export const Highlight = Mark.create({
  name: 'highlight',
  addAttributes() {
    return { color: { default: 'yellow', parseHTML: (el) => el.getAttribute('data-color') || 'yellow', renderHTML: (a) => ({ 'data-color': a.color }) } };
  },
  parseHTML() {
    return [{ tag: 'mark' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return { setHighlight: (color) => ({ chain }) => (color ? chain().setMark('highlight', { color }).run() : chain().unsetMark('highlight').run()) };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.setHighlight(this.editor.isActive('highlight') ? null : 'yellow') };
  },
});

export const Superscript = Mark.create({
  name: 'superscript',
  excludes: 'subscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: () => ['sup', 0],
  addCommands() {
    return { toggleSuperscript: () => ({ commands }) => commands.toggleMark('superscript') };
  },
  addKeyboardShortcuts() {
    return { 'Mod-.': () => this.editor.commands.toggleSuperscript() };
  },
});

export const Subscript = Mark.create({
  name: 'subscript',
  excludes: 'superscript',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: () => ['sub', 0],
  addCommands() {
    return { toggleSubscript: () => ({ commands }) => commands.toggleMark('subscript') };
  },
  addKeyboardShortcuts() {
    return { 'Mod-,': () => this.editor.commands.toggleSubscript() };
  },
});

// ---------------- Tables (prosemirror-tables from @tiptap/pm) ----------------

export type TableCommand = 'addRowBefore' | 'addRowAfter' | 'deleteRow' | 'addColumnBefore' | 'addColumnAfter' | 'deleteColumn' | 'toggleHeaderRow' | 'deleteTable';
const TABLE_COMMANDS = { addRowBefore, addRowAfter, deleteRow, addColumnBefore, addColumnAfter, deleteColumn, toggleHeaderRow, deleteTable };

const cellAttrs = {
  colspan: { default: 1, parseHTML: (el: HTMLElement) => Number(el.getAttribute('colspan') || 1), renderHTML: (a: Record<string, unknown>) => (Number(a.colspan) > 1 ? { colspan: a.colspan } : {}) },
  rowspan: { default: 1, parseHTML: (el: HTMLElement) => Number(el.getAttribute('rowspan') || 1), renderHTML: (a: Record<string, unknown>) => (Number(a.rowspan) > 1 ? { rowspan: a.rowspan } : {}) },
  colwidth: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
};

/** prosemirror-tables reads `tableRole` from the node spec. */
const TableRole = Extension.create({
  name: 'tableRole',
  extendNodeSchema(extension) {
    const role = (extension.config as { tableRole?: string }).tableRole;
    return role ? { tableRole: role } : {};
  },
});

export const TableCell = Node.create({
  name: 'tableCell',
  content: 'block+',
  isolating: true,
  tableRole: 'cell',
  addAttributes: () => cellAttrs,
  parseHTML: () => [{ tag: 'td' }],
  renderHTML: ({ HTMLAttributes }) => ['td', mergeAttributes(HTMLAttributes), 0],
} as Parameters<typeof Node.create>[0]);

export const TableHeader = Node.create({
  name: 'tableHeader',
  content: 'block+',
  isolating: true,
  tableRole: 'header_cell',
  addAttributes: () => cellAttrs,
  parseHTML: () => [{ tag: 'th' }],
  renderHTML: ({ HTMLAttributes }) => ['th', mergeAttributes(HTMLAttributes), 0],
} as Parameters<typeof Node.create>[0]);

export const TableRow = Node.create({
  name: 'tableRow',
  content: '(tableCell | tableHeader)*',
  tableRole: 'row',
  parseHTML: () => [{ tag: 'tr' }],
  renderHTML: ({ HTMLAttributes }) => ['tr', mergeAttributes(HTMLAttributes), 0],
} as Parameters<typeof Node.create>[0]);

export const Table = Node.create({
  name: 'table',
  group: 'block',
  content: 'tableRow+',
  isolating: true,
  tableRole: 'table',
  parseHTML: () => [{ tag: 'table' }],
  renderHTML: ({ HTMLAttributes }) => ['div', { class: 'tableWrapper' }, ['table', mergeAttributes(HTMLAttributes), ['tbody', 0]]],
  addProseMirrorPlugins: () => [tableEditing()],
  addCommands() {
    return {
      insertTable: (rows = 3, cols = 3) => ({ state, dispatch }) => {
        const s = state.schema;
        const cell = (header: boolean) => (header ? s.nodes.tableHeader : s.nodes.tableCell)?.createAndFill();
        const rowsArr = Array.from({ length: rows }, (_, r) => s.nodes.tableRow?.create(null, Array.from({ length: cols }, () => cell(r === 0)).filter((c): c is PMNode => !!c)));
        const table = s.nodes.table?.create(null, rowsArr.filter((r): r is PMNode => !!r));
        if (!table) return false;
        if (dispatch) {
          const tr = state.tr.replaceSelectionWith(table);
          // Caret into the first cell: find the inserted node (the same instance).
          let at = -1;
          tr.doc.descendants((n, pos) => {
            if (at >= 0) return false;
            if (n === table) { at = pos; return false; }
            return true;
          });
          if (at >= 0) tr.setSelection(TextSelection.near(tr.doc.resolve(at + 3)));
          dispatch(tr.scrollIntoView());
        }
        return true;
      },
      tableCommand: (name) => ({ state, dispatch }) => TABLE_COMMANDS[name](state, dispatch),
    };
  },
  addKeyboardShortcuts() {
    // Inside a table Tab walks the cells (a new row after the last one).
    return {
      Tab: () => {
        const { state, view } = this.editor;
        if (!isInTable(state)) return false;
        if (goToNextCell(1)(state, view.dispatch)) return true;
        return this.editor.chain().command(({ state: st, dispatch }) => addRowAfter(st, dispatch)).command(({ state: st, dispatch }) => goToNextCell(1)(st, dispatch)).run();
      },
      'Shift-Tab': () => isInTable(this.editor.state) && goToNextCell(-1)(this.editor.state, this.editor.view.dispatch),
      Backspace: () => this.editor.state.selection instanceof CellSelection && deleteCellSelection(this.editor.state, this.editor.view.dispatch),
      Delete: () => this.editor.state.selection instanceof CellSelection && deleteCellSelection(this.editor.state, this.editor.view.dispatch),
    };
  },
} as Parameters<typeof Node.create>[0]);

export const TableKit = [TableRole, Table, TableRow, TableHeader, TableCell];

// ---------------- Find and replace (decorations, one Undo per replace) ----------------

interface FindState { term: string; caseSensitive: boolean; matches: { from: number; to: number }[]; index: number }
export const findKey = new PluginKey<FindState>('findReplace');

export function findMatches(doc: PMNode, term: string, caseSensitive: boolean): { from: number; to: number }[] {
  if (!term) return [];
  const needle = caseSensitive ? term : term.toLocaleLowerCase();
  const out: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Text of the block with positions (inline leaves count as one char).
    let text = '';
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        map.push(pos + 1 + offset);
        text += '￼';
      }
    });
    const hay = caseSensitive ? text : text.toLocaleLowerCase();
    let i = hay.indexOf(needle);
    while (i >= 0) {
      const from = map[i], last = map[i + needle.length - 1];
      if (from !== undefined && last !== undefined) out.push({ from, to: last + 1 });
      i = hay.indexOf(needle, i + Math.max(needle.length, 1));
    }
    return false;
  });
  return out;
}

export const FindReplace = Extension.create({
  name: 'findReplace',
  addProseMirrorPlugins() {
    return [new Plugin<FindState>({
      key: findKey,
      state: {
        init: () => ({ term: '', caseSensitive: false, matches: [], index: 0 }),
        apply(tr, prev) {
          const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
          if (!meta && !tr.docChanged) return prev;
          const term = meta?.term ?? prev.term;
          const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
          const matches = findMatches(tr.doc, term, caseSensitive);
          const index = Math.min(meta?.index ?? prev.index, Math.max(matches.length - 1, 0));
          return { term, caseSensitive, matches, index };
        },
      },
      props: {
        decorations(state) {
          const s = findKey.getState(state);
          if (!s || !s.term || s.matches.length === 0) return null;
          return DecorationSet.create(state.doc, s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.index ? 'n-find n-find-cur' : 'n-find' })));
        },
      },
    })];
  },
  addCommands() {
    const select = (tr: Transaction, m: { from: number; to: number } | undefined) => (m ? tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView() : tr);
    return {
      setFind: (term, caseSensitive = false) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(findKey, { term, caseSensitive, index: 0 });
        return true;
      },
      findStep: (dir) => ({ state, tr, dispatch }) => {
        const s = findKey.getState(state);
        if (!s || s.matches.length === 0) return false;
        const index = (s.index + dir + s.matches.length) % s.matches.length;
        if (dispatch) select(tr.setMeta(findKey, { index }), s.matches[index]);
        return true;
      },
      replaceCurrent: (text) => ({ state, tr, dispatch }) => {
        const s = findKey.getState(state);
        const m = s?.matches[s.index];
        if (!s || !m) return false;
        if (dispatch) {
          tr.insertText(text, m.from, m.to);
          const next = findMatches(tr.doc, s.term, s.caseSensitive);
          const index = Math.min(s.index, Math.max(next.length - 1, 0));
          select(tr.setMeta(findKey, { index }), next[index]);
        }
        return true;
      },
      replaceAll: (text) => ({ state, tr, dispatch }) => {
        const s = findKey.getState(state);
        if (!s || s.matches.length === 0) return false;
        if (dispatch) for (const m of [...s.matches].reverse()) tr.insertText(text, m.from, m.to);
        return true;
      },
    };
  },
});

/** Link: open with Ctrl/Cmd+click (as [[links]] and Word); a plain click places the caret. */
export const LINK_OPTIONS = { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' } as const;

export function openLinkOnModClick(dom: HTMLElement, event: MouseEvent): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  const a = (event.target as HTMLElement | null)?.closest?.('a[href]');
  if (!a || !dom.contains(a)) return false;
  window.open((a as HTMLAnchorElement).href, '_blank', 'noopener,noreferrer');
  return true;
}

/** Is the stored document valid in this schema? Unknown nodes or marks
 * (a file from a newer version) must never be dropped silently. */
export function checkContent(schema: Schema, content: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof content === 'string' || content === null || content === undefined) return { ok: true };
  try {
    schema.nodeFromJSON(content).check();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The note schema: StarterKit (incl. ordered list, link, underline, strike,
 * code block, quote, divider) plus task lists, paragraph formatting, inline
 * styles, tables and find/replace. Placeholder, [[links]] and keys are added
 * by the editor itself (NotesView). */
export function richTextExtensions(opts: { taskLabel?: (text: string, checked: boolean) => string } = {}) {
  const taskLabel = opts.taskLabel;
  return [
    StarterKit.configure({ link: LINK_OPTIONS, heading: { levels: [1, 2, 3] } }),
    TaskList,
    TaskItem.configure({ nested: true, ...(taskLabel ? { a11y: { checkboxLabel: (node: PMNode, checked: boolean) => taskLabel(node.textContent, checked) } } : {}) }),
    BlockFormat,
    TextStyle,
    Highlight,
    Superscript,
    Subscript,
    ...TableKit,
    FindReplace,
  ];
}
