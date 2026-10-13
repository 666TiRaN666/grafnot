import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import { unlinkedNotes } from "./store";
import type { Graph, Note, PromptSave, TaskItem } from "./store";
import { Hi } from "./widgets";
import { PREVIEW_LEN } from "./promptUtils";
import { useListState } from "./useListState";
import { parseBracketQuery, rankLinkSuggest } from "./linkSuggest";

export interface NotesActions {
  updateTitle: (v: string) => void;
  updateDoc: (doc: Note["content"], text: string) => void;
  createTask: (d: { text: string; desc: string; due?: string; noteId?: string }) => void;
  updateTask: (id: string, patch: { text?: string; desc?: string; due?: string }) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  duplicate: () => void;
  exportMd: () => void;
  deleteNote: () => void;
  addLink: (id: string) => void;
  removeLink: (id: string) => void;
  addCalc: () => void;
  updateCalc: (id: string, patch: { name?: string; expr?: string }) => void;
  deleteCalc: (id: string) => void;
  /** Create a note and return its id (used by the `[[` create-row). */
  createLinkedNote: (title: string) => string;
  /** Toast with an action button (Undo / Open). Lives 8s per N4. */
  notifyAction: (text: string, actionLabel: string, fn: () => void) => void;
}

const TPL_HTML: Record<string, string> = {
  lec: "<h3>Лекция — план</h3><ul><li>Цель</li><li>Определения</li><li>Примеры</li><li>Вопросы</li></ul>",
  ent: "<h3>ЕНТ — план дня</h3><ul><li>Разобрать 10 заданий</li><li>Повторить формулы</li><li>Пробник на время</li></ul>",
  proj: "<h3>Проект</h3><ul><li>Задача</li><li>Шаги</li><li>Дедлайн</li></ul>",
};

const STOP = new Set(["лекция", "план", "как", "для", "что", "это", "или", "the", "and", "және"]);

function wordsOf(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-zа-яёәіңғүұқөһ0-9]+/i)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

/** Notes related to the current one: same graph or a shared significant word. */
function similarNotes(note: Note, notes: Note[], graphs: Graph[]): Note[] {
  const mine = new Set(wordsOf(note.title));
  const shared = (a: string, b: string) => graphs.some((g) => g.noteIds.includes(a) && g.noteIds.includes(b));
  return notes
    .filter((n) => n.id !== note.id && !note.linkedIds.includes(n.id))
    .filter((n) => shared(note.id, n.id) || wordsOf(n.title).some((w) => mine.has(w)));
}

const normName = (n: string) => n.trim().replace(/\s+/g, "");

/** Safe arithmetic with named variables, no eval. Throws on cycle / unknown names. */
function evalExpr(src: string, blocks: { name: string }[], lookup: (name: string) => number): number {
  const s = src.replace(/\s+/g, "").replace(/,/g, ".");
  const names = blocks
    .map((b) => normName(b.name))
    .filter((n) => n.length > 0)
    .sort((a, b) => b.length - a.length);
  let i = 0;
  function parseExpr(): number {
    let v = parseTerm();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (s[i] === "*" || s[i] === "/" || s[i] === "%") {
      const op = s[i++];
      const r = parseFactor();
      if (op === "*") v *= r;
      else if (op === "/") {
        if (!r) throw new Error("div0");
        v /= r;
      } else v %= r;
    }
    return v;
  }
  function parseFactor(): number {
    const c = s[i];
    if (c === "(") {
      i++;
      const v = parseExpr();
      if (s[i] !== ")") throw new Error("paren");
      i++;
      return v;
    }
    if (c === "-") {
      i++;
      return -parseFactor();
    }
    if (c === "+") {
      i++;
      return parseFactor();
    }
    for (const n of names) {
      if (s.startsWith(n, i)) {
        i += n.length;
        return lookup(n);
      }
    }
    const m = /^[0-9]*\.?[0-9]+/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      return parseFloat(m[0]);
    }
    const idm = /^[A-Za-zА-Яа-яЁё_]+[A-Za-zА-Яа-яЁё_0-9]*/.exec(s.slice(i));
    throw new Error("unknown:" + (idm ? idm[0] : (c ?? "")));
  }
  if (!s) throw new Error("empty");
  const v = parseExpr();
  if (i !== s.length) throw new Error("end");
  return v;
}

interface CalcLike {
  id: string;
  name: string;
  expr: string;
}

function resolveBlock(id: string, blocks: CalcLike[], memo: Map<string, number>, visiting: Set<string>): number {
  const hit = memo.get(id);
  if (hit !== undefined) return hit;
  if (visiting.has(id)) throw new Error("cycle");
  const b = blocks.find((x) => x.id === id);
  if (!b) throw new Error("unknown:");
  visiting.add(id);
  try {
    const v = evalExpr(b.expr, blocks, (name) => {
      const t = blocks.find((x) => normName(x.name) === name);
      if (!t) throw new Error("unknown:" + name);
      return resolveBlock(t.id, blocks, memo, visiting);
    });
    memo.set(id, v);
    return v;
  } finally {
    visiting.delete(id);
  }
}

function calcDisplay(c: CalcLike, blocks: CalcLike[], lang: Lang): { text: string; title: string } {
  if (!c.expr.trim()) return { text: "", title: "" };
  try {
    const v = resolveBlock(c.id, blocks, new Map(), new Set());
    if (!Number.isFinite(v)) return { text: "—", title: "" };
    return { text: "= " + (Math.round(v * 100) / 100).toLocaleString("ru-RU"), title: "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "cycle") return { text: "—", title: tr("calcCycle", lang) };
    if (msg.startsWith("unknown:")) return { text: "—", title: tr("calcUnknown", lang) + msg.slice(8) };
    return { text: "—", title: "" };
  }
}

function fmtDate(u: number, lang: Lang): string {
  if (!u) return "";
  try {
    return new Date(u).toLocaleDateString(lang === "KZ" ? "kk-KZ" : lang === "EN" ? "en-US" : "ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

type CtxTab = "links" | "similar" | "tasks" | "prompts" | "snip";

interface SuggestState {
  query: string;
  /** Document range of `[[query` to replace on pick. */
  start: number;
  end: number;
  x: number;
  y: number;
  active: number;
}

interface SlashState {
  /** Caret offset of the `/` char to delete on pick. */
  slashAt: number;
  x: number;
  y: number;
  active: number;
}

const SUGGEST_CAP = 6;
/** N9: notes list pages by 50, no limit selector. */
const NOTES_PAGE = 50;

function clampXY(x: number, y: number): { x: number; y: number } {
  const w = window.innerWidth || 1024;
  return { x: Math.max(8, Math.min(x, w - 280)), y: Math.max(8, y) };
}

export function NotesView({
  lang,
  hintKey,
  notes,
  openNote,
  tasks,
  graphs,
  onOpenNote,
  onNew,
  onOpenPlan,
  prompts,
  onOpenPrompt,
  onUnbind,
  rightOpen,
  onToggleRight,
  actions,
  notify,
  profileId,
}: {
  lang: Lang;
  hintKey: string;
  notes: Note[];
  openNote: Note | null;
  tasks: TaskItem[];
  graphs: Graph[];
  onOpenNote: (id: string) => void;
  onNew: () => void;
  onOpenPlan: () => void;
  prompts: PromptSave[];
  onOpenPrompt: (id: string) => void;
  onUnbind: (id: string) => void;
  rightOpen: boolean;
  onToggleRight: () => void;
  actions: NotesActions;
  notify: (msg: string) => void;
  profileId: string;
}) {
  const note = openNote;
  const noteId = note?.id ?? null;
  // ----- master-detail list (N9: sort by change, pages of 50) -----
  const sorted = useMemo(() => [...notes].sort((a, b) => b.updated - a.updated), [notes]);
  const select = useCallback(
    (q: string) => {
      const needle = q.trim().toLowerCase();
      return needle ? sorted.filter((n) => `${n.title} ${n.text}`.toLowerCase().includes(needle)) : sorted;
    },
    [sorted],
  );
  const list = useListState({ key: "notes", profileId, select, limit: NOTES_PAGE, onPick: (n) => onOpenNote(n.id) });
  // Opening a note is an explicit context switch: the next list visit starts
  // unfiltered (also covers palette picks, which bypass the list).
  useEffect(() => {
    list.changeQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // ----- editor state -----
  const [words, setWords] = useState(note?.text ?? "");
  const [, setTick] = useState(0);
  const [focusCalc, setFocusCalc] = useState<string | null>(null);
  const [hint, setHint] = useState(() => {
    try {
      return window.localStorage.getItem(hintKey) !== "1";
    } catch {
      return true;
    }
  });
  const [draft, setDraft] = useState(note?.title ?? "");
  const [simShown, setSimShown] = useState(3);
  const [orphShown, setOrphShown] = useState(4);
  const [tab, setTab] = useState<CtxTab>("links");
  const [moreOpen, setMoreOpen] = useState(false);
  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);

  // Draft syncs only from committed store value (note switch / external rename).
  useEffect(() => {
    setDraft(note?.title ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, note?.title]);

  const commitTitle = () => {
    if (note && draft !== note.title) actions.updateTitle(draft);
  };

  const langRef = useRef(lang);
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: () => tr("editorPh", langRef.current) })],
    content: note?.content,
    onUpdate: ({ editor: e }) => {
      if (!note) return;
      actions.updateDoc(e.getJSON(), e.getText());
      setWords(e.getText());
      syncInlineMenus(e);
    },
  });
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const noteRef = useRef(note);
  noteRef.current = note;

  // Switch document when the active note changes (not on every keystroke).
  useEffect(() => {
    const ed = editorRef.current;
    if (note && ed && !ed.isDestroyed) ed.commands.setContent(note.content, { emitUpdate: false });
    setWords(note?.text ?? "");
    setSimShown(3);
    setOrphShown(4);
    setSuggest(null);
    setSlash(null);
    setMoreOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId]);

  // Keep selection-menu anchor in sync.
  useEffect(() => {
    if (!editor) return;
    const bump = () => setTick((t) => t + 1);
    editor.on("transaction", bump);
    editor.on("selectionUpdate", () => {
      const ed = editorRef.current;
      if (ed && !ed.isDestroyed) syncInlineMenus(ed);
    });
    return () => {
      editor.off("transaction", bump);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Follow UI language in the empty-doc placeholder.
  useEffect(() => {
    langRef.current = lang;
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr);
  }, [editor, lang]);

  const dismissHint = () => {
    setHint(false);
    try {
      window.localStorage.setItem(hintKey, "1");
    } catch {
      /* ignore */
    }
  };

  /** Detect `[[` mentions and a lone `/` at the caret; positions popups at the caret. */
  function syncInlineMenus(e: NonNullable<typeof editor>) {
    const n = noteRef.current;
    if (!n || e.isDestroyed) {
      setSuggest(null);
      setSlash(null);
      return;
    }
    const { from } = e.state.selection;
    if (!e.state.selection.empty) {
      setSuggest(null);
      setSlash(null);
      return;
    }
    // Slash menu: the line so far is exactly `/`.
    const $from = e.state.selection.$from;
    const lineBefore = $from.parent.textBetween(0, $from.parentOffset);
    if (lineBefore === "/") {
      const c = e.view.coordsAtPos(from);
      const p = clampXY(c.left, c.bottom + 6);
      setSlash((s) => ({ slashAt: from - 1, x: p.x, y: p.y, active: s ? Math.min(s.active, SLASH_ITEMS - 1) : 0 }));
      setSuggest(null);
      return;
    }
    setSlash(null);
    const before = e.state.doc.textBetween(0, from, "\n");
    const q = parseBracketQuery(before);
    if (q === null) {
      setSuggest(null);
      return;
    }
    const c = e.view.coordsAtPos(from);
    const p = clampXY(c.left, c.bottom + 6);
    setSuggest((s) => ({
      query: q,
      start: from - 2 - q.length,
      end: from,
      x: p.x,
      y: p.y,
      active: s && s.query === q ? s.active : 0,
    }));
  }

  const suggestItems = useMemo(
    () => (suggest && note ? rankLinkSuggest(notes, note.id, suggest.query).slice(0, SUGGEST_CAP) : []),
    [suggest, notes, note],
  );

  const pickSuggest = (targetId: string | null) => {
    const ed = editorRef.current;
    const n = noteRef.current;
    const sg = suggest;
    if (!ed || ed.isDestroyed || !n || !sg) return;
    // The mention typed text is removed; the link itself is the relation
    // (linkedIds). Inserting the title into the doc would pollute palette
    // and list search with echoed words.
    const title = targetId ? (notes.find((x) => x.id === targetId)?.title ?? "") : sg.query.trim();
    const id = targetId ?? (title ? actions.createLinkedNote(title) : null);
    if (!id) return;
    ed.chain()
      .focus()
      .deleteRange({ from: sg.start, to: sg.end })
      .run();
    if (targetId) actions.addLink(targetId);
    else actions.addLink(id);
    setSuggest(null);
    notify(tr("toastLinked", lang));
  };

  const focusEditorEnd = () => {
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) ed.chain().focus("end").insertContent("[[").run();
  };

  const SLASH_RUNNERS: { testid: string; label: string; run: () => void }[] = useMemo(() => {
    const ed = () => editorRef.current;
    const delSlash = (at: number) => {
      const e = ed();
      if (e && !e.isDestroyed) e.chain().focus().deleteRange({ from: at, to: at + 1 }).run();
    };
    const at = slash?.slashAt ?? 0;
    return [
      { testid: "slash-item-0", label: tr("blkHeading", lang), run: () => { delSlash(at); ed()?.chain().focus().toggleHeading({ level: 3 }).run(); } },
      { testid: "slash-item-1", label: tr("blkList", lang), run: () => { delSlash(at); ed()?.chain().focus().toggleBulletList().run(); } },
      { testid: "slash-item-2", label: tr("snipLecture", lang), run: () => { delSlash(at); insertTpl("lec"); } },
      { testid: "slash-item-3", label: tr("snipEnt", lang), run: () => { delSlash(at); insertTpl("ent"); } },
      { testid: "slash-item-4", label: tr("snipProj", lang), run: () => { delSlash(at); insertTpl("proj"); } },
      { testid: "slash-item-5", label: tr("addCalc", lang), run: () => { delSlash(at); actions.addCalc(); } },
      { testid: "slash-item-6", label: tr("addLinkBtn", lang), run: () => { delSlash(at); focusEditorEnd(); } },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, slash?.slashAt]);
  const SLASH_ITEMS = SLASH_RUNNERS.length;

  // Menu keys are captured at window level so Enter/Esc/arrows never reach
  // the document while a popup is open; typing passes through untouched.
  useEffect(() => {
    if (!suggest && !slash) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest || !t.closest(".tiptap")) return;
      if (suggest) {
        const count = suggestItems.length + (suggest.query.trim() ? 1 : 0);
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setSuggest(null);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          setSuggest((s) => (s ? { ...s, active: (s.active + (e.key === "ArrowDown" ? 1 : count - 1)) % Math.max(count, 1) } : s));
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          const idx = suggest.active;
          if (idx < suggestItems.length) {
            const item = suggestItems[idx];
            if (item) pickSuggest(item.id);
          } else pickSuggest(null);
        }
      } else if (slash) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setSlash(null);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          setSlash((s) => (s ? { ...s, active: (s.active + (e.key === "ArrowDown" ? 1 : SLASH_ITEMS - 1)) % SLASH_ITEMS } : s));
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          const r = SLASH_RUNNERS[slash.active];
          setSlash(null);
          if (r) r.run();
        }
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggest, slash, suggestItems]);

  // `/` focuses the list search when the caret is not in any field (N7).
  // `N` opens a new note. Ctrl+Shift+T files the selection as a task (S3.8).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && !!t.closest && !!t.closest("input, textarea, select, [contenteditable]");
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !inField && !(e.target as HTMLElement)?.closest?.(".g-modal")) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if ((e.key === "n" || e.key === "т") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !inField && !(e.target as HTMLElement)?.closest?.(".g-modal")) {
        e.preventDefault();
        onNew();
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.code === "KeyT" && !e.metaKey && !e.altKey) {
        const blocked = !!t && !!t.closest && !!t.closest("input, textarea, select, .g-modal");
        if (blocked) return;
        e.preventDefault();
        openTaskFromSelection();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // Selection menu hides on scroll (anchor goes stale).
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("scroll", h, true);
    return () => window.removeEventListener("scroll", h, true);
  }, []);

  const selectionText = (): string => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return "";
    const { from, to } = ed.state.selection;
    if (from === to) return "";
    return ed.state.doc.textBetween(from, to, " ").trim();
  };

  const selMenuPos = (): { x: number; y: number } | null => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed || !ed.isFocused) return null;
    const { from, to } = ed.state.selection;
    if (from === to || selectionText() === "" || suggest || slash) return null;
    try {
      const c = ed.view.coordsAtPos(from);
      return clampXY(c.left, c.top - 48);
    } catch {
      return null;
    }
  };
  const selPos = selMenuPos();

  const runOnSelection = (fn: () => void) => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    ed.chain().focus().run();
    fn();
  };

  // S4: no dialog — the task is filed at once with the note attached, the
  // toast offers to open it in the planner (desc/due live in the panel).
  const openTaskFromSelection = () => {
    const n = noteRef.current;
    if (!n) return;
    actions.createTask({ text: selectionText() || n.title, desc: "", noteId: n.id });
    actions.notifyAction(tr("toastTaskAdded", lang), tr("openBtn", lang), onOpenPlan);
  };

  const openLinkFromSelection = () => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    const sel = selectionText();
    ed.chain().focus().deleteSelection().insertContent("[[" + sel).run();
  };

  const insertTpl = (key: string) => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    ed.chain().focus().insertContent(TPL_HTML[key]).run();
    notify(tr("toastSnipApplied", lang));
  };

  const removeLinkUndo = (id: string) => {
    actions.removeLink(id);
  };

  const insertVar = (display: string) => {
    if (!note) return;
    const v = display.replace(/\s+/g, "");
    const targetId = focusCalc ?? note.calcs[note.calcs.length - 1]?.id;
    if (!targetId) return;
    const cur = note.calcs.find((c) => c.id === targetId)?.expr ?? "";
    actions.updateCalc(targetId, { expr: cur + (cur && !/\s$/.test(cur) ? " " : "") + v });
  };

  const varNames = note
    ? [...new Map(note.calcs.map((c) => c.name.trim()).filter((n) => n).map((n) => [n.replace(/\s+/g, ""), n])).values()]
    : [];

  const similar = note ? similarNotes(note, notes, graphs) : [];
  const incoming = note ? notes.filter((n) => n.id !== note.id && n.linkedIds.includes(note.id)) : [];
  const broken = note ? note.linkedIds.filter((id) => !notes.some((n) => n.id === id)) : [];
  const orphans = unlinkedNotes(notes);
  const noteTasks = note ? tasks.filter((t) => t.noteId === note.id) : [];
  const notePrompts = note ? prompts.filter((p) => p.noteId === note.id) : [];
  const wc = words.trim() ? words.trim().split(/\s+/).length : 0;

  const tabDefs: { id: CtxTab; testid: string; label: string }[] = [
    { id: "links", testid: "ctx-tab-links", label: tr("linkedT", lang) },
    { id: "similar", testid: "ctx-tab-similar", label: tr("similarT", lang) },
    { id: "tasks", testid: "ctx-tab-tasks", label: tr("noteTasksT", lang) },
    { id: "prompts", testid: "ctx-tab-prompts", label: tr("promptsT", lang) },
    { id: "snip", testid: "ctx-tab-snip", label: tr("snipT", lang) },
  ];

  return (
    <div className={"n-notes" + (note ? " has-open" : "")}>
      <div className="n-listpane">
        {notes.length === 0 ? (
          <div className="g-empty">
            <div className="g-empty-t">{tr("emptyHomeT", lang)}</div>
            <div className="g-empty-sub">{tr("emptyHomeSub", lang)}</div>
            <button type="button" className="g-btn primary" onClick={onNew}>
              {tr("createFirst", lang)}
            </button>
          </div>
        ) : (
          <>
            <div className="g-notes-tools">
              <input
                ref={searchRef}
                className="g-in"
                data-testid="notes-search"
                value={list.query}
                onChange={(e) => list.changeQuery(e.target.value)}
                onKeyDown={list.nav.onKeyDown}
                placeholder={tr("linkSearchPh", lang)}
                aria-label="filter"
              />
            </div>
            {list.filtered.length === 0 && (
              <div className="g-tpl-empty">
                <div className="muted">{tr("noResults", lang)}</div>
                <button type="button" className="g-btn sm" onClick={() => list.changeQuery("")}>
                  {tr("tplResetFilter", lang)}
                </button>
              </div>
            )}
            {list.filtered.length > 0 && (
              <div className="muted small">
                {tr("listShownOf", lang).replace("{x}", String(list.visible.length)).replace("{y}", String(list.filtered.length))}
              </div>
            )}
            <div className="g-note-list" data-testid="note-list">
              {list.visible.map((n) => (
                <div className={"g-noterow" + (n.id === noteId ? " active" : "")} key={n.id}>
                  <button
                    type="button"
                    className="g-noteopen"
                    data-testid="note-item"
                    data-active={n.id === noteId ? "true" : undefined}
                    onClick={() => onOpenNote(n.id)}
                  >
                    {<Hi text={n.title || tr("newNoteTitle", lang)} q={list.query} />}
                  </button>
                  {n.text.trim() && <div className="g-notesnippet">{<Hi text={n.text} q={list.query} max={PREVIEW_LEN} />}</div>}
                  <div className="g-notemeta">
                    {fmtDate(n.updated, lang)} · {tr("linkedT", lang)}: {n.linkedIds.length}
                  </div>
                </div>
              ))}
              {list.shown < list.filtered.length && (
                <button type="button" className="g-btn sm g-tpl-more" onClick={() => list.showMore()}>
                  {tr("tplShowMore", lang).replace("{n}", String(Math.min(NOTES_PAGE, list.filtered.length - list.shown)))}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {notes.length > 0 && (
      <div className="n-detail">
        {!note ? (
          <div className="g-empty">
            <div className="g-empty-t">{tr("pickNoteT", lang)}</div>
            <button type="button" className="g-btn primary" onClick={onNew}>
              {tr("createFirst", lang)}
            </button>
          </div>
        ) : (
          <section className="n-editor">
            <div className="n-titlebar">
              <input
                className="g-title-in"
                data-testid="title-in"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    // Blur first: commit is synchronous on blur, focusing the
                    // editor alone would leave the draft uncommitted on a
                    // fresh mount (P7-unique race).
                    (e.target as HTMLInputElement).blur();
                    const ed = editorRef.current;
                    if (ed && !ed.isDestroyed) ed.chain().focus().run();
                  }
                  if (e.key === "Escape") setDraft(note.title);
                }}
                aria-label={tr("a11yTitle", lang)}
              />
              <span className="g-wordcount">
                {wc} {tr("words", lang)}
              </span>
              <div className="n-morewrap">
                <button
                  type="button"
                  className="g-btn sm ghost"
                  data-testid="notes-more"
                  title={tr("menu", lang)}
                  aria-label={tr("menu", lang)}
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((v) => !v)}
                >
                  ⋯
                </button>
                {moreOpen && (
                  <div className="n-menu" data-testid="notes-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="n-menuitem"
                      data-testid="notes-menu-export"
                      onClick={() => {
                        setMoreOpen(false);
                        actions.exportMd();
                      }}
                    >
                      {tr("exportMd", lang)}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="n-menuitem"
                      data-testid="notes-menu-duplicate"
                      onClick={() => {
                        setMoreOpen(false);
                        actions.duplicate();
                      }}
                    >
                      {tr("duplicate", lang)}
                    </button>
                    <div className="n-menusep" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="n-menuitem danger"
                      data-testid="notes-menu-trash"
                      onClick={() => {
                        setMoreOpen(false);
                        actions.deleteNote();
                      }}
                    >
                      {tr("deleteNote", lang)}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {hint && (
              <div className="g-hint">
                <span>{tr("hintFirst", lang)}</span>
                <button type="button" className="g-toast-x" onClick={dismissHint} aria-label={tr("closeBtn", lang)}>
                  ×
                </button>
              </div>
            )}

            <div data-testid="editor">
              <EditorContent editor={editor} />
            </div>

            {selPos && (
              <div
                className="n-selmenu"
                data-testid="sel-menu"
                role="toolbar"
                aria-label={tr("menu", lang)}
                style={{ left: selPos.x, top: selPos.y }}
              >
                <button
                  type="button"
                  data-testid="sel-bold"
                  className="n-selbtn strong"
                  title="Bold"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runOnSelection(() => editorRef.current?.chain().focus().toggleBold().run())}
                >
                  B
                </button>
                <button
                  type="button"
                  data-testid="sel-italic"
                  className="n-selbtn em"
                  title="Italic"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runOnSelection(() => editorRef.current?.chain().focus().toggleItalic().run())}
                >
                  I
                </button>
                <button
                  type="button"
                  data-testid="sel-h"
                  className="n-selbtn"
                  title="Heading"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runOnSelection(() => editorRef.current?.chain().focus().toggleHeading({ level: 3 }).run())}
                >
                  H
                </button>
                <button
                  type="button"
                  data-testid="sel-list"
                  className="n-selbtn"
                  title="List"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runOnSelection(() => editorRef.current?.chain().focus().toggleBulletList().run())}
                >
                  ≡
                </button>
                <button
                  type="button"
                  data-testid="sel-task"
                  className="n-selbtn wide"
                  title={tr("makeTask", lang)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openTaskFromSelection}
                >
                  {tr("makeTask", lang)}
                </button>
                <button
                  type="button"
                  data-testid="sel-link"
                  className="n-selbtn wide"
                  title={tr("addLinkBtn", lang)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openLinkFromSelection}
                >
                  {tr("addLinkBtn", lang)}
                </button>
              </div>
            )}

            {suggest && (
              <div
                className="n-suggest"
                data-testid="link-suggest"
                role="listbox"
                style={{ left: suggest.x, top: suggest.y }}
              >
                {suggestItems.map((n, i) => (
                  <button
                    key={n.id}
                    type="button"
                    role="option"
                    aria-selected={i === suggest.active}
                    data-testid={`link-suggest-item-${i}`}
                    className={"n-suggestitem" + (i === suggest.active ? " active" : "")}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggest(n.id)}
                  >
                    <span>{n.title || tr("newNoteTitle", lang)}</span>
                    {note.linkedIds.includes(n.id) && <span className="g-ok">✓</span>}
                  </button>
                ))}
                {suggest.query.trim() && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={suggest.active >= suggestItems.length}
                    data-testid="link-suggest-create"
                    className={"n-suggestitem create" + (suggest.active >= suggestItems.length ? " active" : "")}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggest(null)}
                  >
                    {tr("linkCreate", lang).replace("{q}", suggest.query.trim())}
                  </button>
                )}
                {suggestItems.length === 0 && !suggest.query.trim() && (
                  <div className="muted small" style={{ padding: 8 }}>
                    {tr("noResults", lang)}
                  </div>
                )}
              </div>
            )}

            {slash && (
              <div
                className="n-suggest"
                data-testid="slash-menu"
                role="menu"
                style={{ left: slash.x, top: slash.y }}
              >
                {SLASH_RUNNERS.map((r, i) => (
                  <button
                    key={r.testid}
                    type="button"
                    role="menuitem"
                    data-testid={r.testid}
                    className={"n-suggestitem" + (i === slash.active ? " active" : "")}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSlash(null);
                      r.run();
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}

            <div className="g-card g-calcs">
              <div className="g-card-t">
                {tr("calcsT", lang)} ({note.calcs.length})
              </div>
              {note.calcs.length === 0 && <div className="muted small">{tr("emptyCalcs", lang)}</div>}
              {varNames.length > 0 && (
                <div className="g-vars">
                  <span className="muted small">{tr("varsHint", lang)}</span>
                  {varNames.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="g-varchip mono"
                      title={tr("insertVar", lang)}
                      onClick={() => insertVar(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
              {note.calcs.map((c) => {
                const d = calcDisplay(c, note.calcs, lang);
                return (
                  <div className="g-calcrow" key={c.id}>
                    <input
                      value={c.name}
                      onChange={(e) => actions.updateCalc(c.id, { name: e.target.value })}
                      placeholder={tr("calcNamePh", lang)}
                      className="g-calc-name"
                      aria-label={tr("calcNamePh", lang)}
                    />
                    <input
                      value={c.expr}
                      onChange={(e) => actions.updateCalc(c.id, { expr: e.target.value })}
                      onFocus={() => setFocusCalc(c.id)}
                      placeholder={tr("calcExprPh", lang)}
                      className="g-calc-expr mono"
                      aria-label={tr("calcExprL", lang)}
                    />
                    <code className="g-calc-res" title={d.title}>
                      {d.text}
                    </code>
                    <button
                      type="button"
                      className="g-tdel show"
                      aria-label={tr("closeBtn", lang)}
                      onClick={() => actions.deleteCalc(c.id)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <button type="button" className="g-btn sm g-wide" onClick={actions.addCalc}>
                {tr("addCalc", lang)}
              </button>
            </div>
          </section>
        )}
      </div>
      )}

      {rightOpen ? (
        <aside className="g-right n-ctx">
          <button
            type="button"
            className="g-btn sm ghost"
            title={tr("panelToggle", lang)}
            aria-label={tr("panelToggle", lang)}
            onClick={onToggleRight}
          >
            &#8249;
          </button>
          <div className="n-tabs" data-testid="ctx-tabs" role="tablist">
            {tabDefs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                data-testid={t.testid}
                className={"n-tab" + (tab === t.id ? " active" : "")}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "links" && note && (
            <div className="g-card">
              <div className="g-card-t">
                {tr("linkedT", lang)} ({note.linkedIds.length})
              </div>
              {note.linkedIds.length === 0 && <div className="muted small">{tr("emptyOrphans", lang)}</div>}
              <ul>
                {note.linkedIds.map((id) => (
                  <li key={id} className="g-linkrow-li">
                    <button type="button" className="g-linkbtn" onClick={() => onOpenNote(id)}>
                      {notes.find((n) => n.id === id)?.title ?? id.slice(-4)}
                    </button>
                    <button
                      type="button"
                      className="g-unlink"
                      title={tr("unlinkTitle", lang)}
                      aria-label={tr("unlinkTitle", lang)}
                      onClick={() => removeLinkUndo(id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              {incoming.length > 0 && (
                <>
                  <div className="g-card-t sub">
                    {tr("backlinksT", lang)} ({incoming.length})
                  </div>
                  <ul>
                    {incoming.map((n) => (
                      <li key={n.id}>
                        <button type="button" className="g-linkbtn" onClick={() => onOpenNote(n.id)}>
                          &#8592; {n.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {broken.length > 0 && (
                <>
                  <div className="g-card-t sub">
                    {tr("brokenF", lang)} ({broken.length})
                  </div>
                  <ul>
                    {broken.map((id) => (
                      <li key={id} className="g-linkrow-li">
                        <span className="muted small">? {id.slice(-4)}</span>
                        <button
                          type="button"
                          className="g-unlink"
                          title={tr("unlinkTitle", lang)}
                          aria-label={tr("unlinkTitle", lang)}
                          onClick={() => removeLinkUndo(id)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <button type="button" className="g-btn sm g-wide" onClick={focusEditorEnd}>
                {tr("addLinkBtn", lang)}
              </button>
              {orphans.length > 0 && (
                <>
                  <div className="g-card-t sub">
                    {tr("orphansT", lang)} ({orphans.length})
                  </div>
                  {orphans.slice(0, orphShown).map((n) => (
                    <div className="g-sugg" key={n.id}>
                      <button type="button" className="g-linkbtn" onClick={() => onOpenNote(n.id)}>
                        • {n.title || tr("newNoteTitle", lang)}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          {tab === "similar" && (
            <div className="g-card warn">
              <div className="g-card-t">
                {tr("similarT", lang)} ({similar.length})
              </div>
              {similar.length === 0 && <div className="muted small">{tr("similarEmpty", lang)}</div>}
              {similar.length > 0 && (
                <div className="muted small">
                  {tr("listShownOf", lang).replace("{x}", String(Math.min(simShown, similar.length))).replace("{y}", String(similar.length))}
                </div>
              )}
              {similar.slice(0, simShown).map((s) => (
                <div className="g-sugg" key={s.id}>
                  <button type="button" className="g-linkbtn" onClick={() => onOpenNote(s.id)}>
                    • {s.title}
                  </button>
                  <button type="button" className="g-linkbtn" onClick={() => onOpenNote(s.id)}>
                    [{tr("linkQ", lang)}]
                  </button>
                </div>
              ))}
              {simShown < similar.length && (
                <button type="button" className="g-btn sm g-tpl-more" onClick={() => setSimShown((s) => s + 3)}>
                  {tr("tplShowMore", lang).replace("{n}", String(Math.min(3, similar.length - simShown)))}
                </button>
              )}
            </div>
          )}
          {tab === "tasks" && note && (
            <div className="g-card g-note-tasks">
              <div className="g-card-t">
                {tr("noteTasksT", lang)} ({noteTasks.length})
              </div>
              {noteTasks.length === 0 && <div className="muted small">{tr("emptyNoteTasks", lang)}</div>}
              {noteTasks.map((t) => (
                <div className="g-sugg" key={t.id}>
                  <label className={`g-undone${t.done ? " done" : ""}`}>
                    <input type="checkbox" checked={t.done} onChange={() => actions.toggleTask(t.id)} />
                    <span>
                      {t.text}
                      {t.desc && <div className="g-tdesc">{t.desc}</div>}
                    </span>
                  </label>
                  <span>
                    <button type="button" className="g-linkbtn" onClick={() => actions.deleteTask(t.id)}>
                      [{tr("deleteNote", lang)}]
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {tab === "prompts" && (
            <div className="g-card">
              <div className="g-card-t">
                {tr("promptsT", lang)} ({notePrompts.length})
              </div>
              {notePrompts.length === 0 && <div className="muted small">{tr("notePromptsEmpty", lang)}</div>}
              {notePrompts.map((p) => (
                <div className="g-sugg" key={p.id}>
                  <span>
                    • {p.title} <span className="g-kind">{p.kind}</span>
                  </span>
                  <span>
                    <button type="button" className="g-linkbtn" onClick={() => onOpenPrompt(p.id)}>
                      [{tr("openBtn", lang)}]
                    </button>{" "}
                    <button type="button" className="g-linkbtn" onClick={() => onUnbind(p.id)}>
                      [{tr("unbindBtn", lang)}]
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {tab === "snip" && (
            <div className="g-card">
              <div className="g-card-t">{tr("snipT", lang)}</div>
              <div className="g-tplbtns">
                <button type="button" className="g-chip sm" onClick={() => insertTpl("lec")}>
                  {tr("snipLecture", lang)}
                </button>
                <button type="button" className="g-chip sm" onClick={() => insertTpl("ent")}>
                  {tr("snipEnt", lang)}
                </button>
                <button type="button" className="g-chip sm" onClick={() => insertTpl("proj")}>
                  {tr("snipProj", lang)}
                </button>
              </div>
            </div>
          )}
        </aside>
      ) : (
        <aside className="g-rail-r">
          <button type="button" title={tr("panelToggle", lang)} aria-label={tr("panelToggle", lang)} onClick={onToggleRight}>
            &#8250;
          </button>
        </aside>
      )}

    </div>
  );
}
