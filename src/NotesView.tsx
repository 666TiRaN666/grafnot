import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { Lang } from "./i18n";
import type { LlmTpl } from "./data";
import { tr } from "./i18n";
import type { SelectionBookmark, Transaction } from "@tiptap/pm/state";
import { canPinContext, promptTargetMatches } from "./rolloutModel";
import type { ContextTab, NoteSession, PromptTarget } from "./rolloutModel";
import type { PromptChoice } from "./PromptInsert";
const NoteContext = lazy(() => import("./NoteContext").then(m => ({ default: m.NoteContext })));
const PromptInsert = lazy(() => import("./PromptInsert").then(m => ({ default: m.PromptInsert })));
import type { Graph, Note, PromptSave, TaskItem } from "./store";
import { copyText, Hi } from "./widgets";
import { firstMatchPos } from "./paletteModel";
import { lastNavigationWasTraversal } from "./ui/router";
import { noteAccessibleName, noteDisplayName, noteUpdatedLabel } from "./noteName";
import { PREVIEW_LEN } from "./promptUtils";
import { useListState } from "./useListState";
import { parseBracketQuery, rankLinkSuggest } from "./linkSuggest";

/** Note commands take the id of the note they act on (D1): the shown note,
 * never an app-wide "active" one. */
export interface NotesActions {
  updateTitle: (noteId: string, v: string) => void;
  updateDoc: (noteId: string, doc: Note["content"], text: string) => void;
  createTask: (d: { text: string; desc: string; due?: string; noteId?: string }) => void;
  updateTask: (id: string, patch: { text?: string; desc?: string; due?: string }) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  duplicate: (noteId: string) => void;
  exportMd: (noteId: string) => void;
  deleteNote: (noteId: string) => void;
  addLink: (noteId: string, targetId: string) => void;
  removeLink: (noteId: string, targetId: string) => void;
  addCalc: (noteId: string) => void;
  updateCalc: (noteId: string, calcId: string, patch: { name?: string; expr?: string }) => void;
  deleteCalc: (noteId: string, calcId: string) => void;
  /** Create a note and return its id (used by the `[[` create-row). */
  createLinkedNote: (title: string) => string;
  /** Toast with an action button (Undo / Open). Lives 8s per N4. */
  notifyAction: (text: string, actionLabel: string, fn: () => void) => void;
  toggleMember: (noteId: string, graphId: string) => void;
  savePrompt: (data: Omit<PromptSave, "id" | "created">) => void;
}

const TPL_HTML: Record<string, string> = {
  lec: "<h3>Лекция — план</h3><ul><li>Цель</li><li>Определения</li><li>Примеры</li><li>Вопросы</li></ul>",
  ent: "<h3>ЕНТ — план дня</h3><ul><li>Разобрать 10 заданий</li><li>Повторить формулы</li><li>Пробник на время</li></ul>",
  proj: "<h3>Проект</h3><ul><li>Задача</li><li>Шаги</li><li>Дедлайн</li></ul>",
};

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
  return { x: Math.max(8, Math.min(x, w - Math.min(330, w - 16) - 8)), y: Math.max(8, y) };
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
  templates, sessionEpoch, sessions, onShowMap,
  focusNoteId,
  onBodyFocused,
  findRequest,
  onFindDone,
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
  templates: LlmTpl[]; sessionEpoch: number; sessions: Map<string, NoteSession>; onShowMap: (id: string) => void;
  focusNoteId: string | null;
  onBodyFocused: () => void;
  /** Palette pick: caret at the query's first match, consumed once. */
  findRequest: { noteId: string; query: string } | null;
  onFindDone: () => void;
  onOpenPlan: (id?: string) => void;
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
  const titleRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<ContextTab>(() => sessions.get(noteId ?? '')?.tab ?? 'links');
  const [ctxOpen, setCtxOpen] = useState(() => rightOpen || (sessions.get(noteId ?? '')?.open ?? false));
  const [insertOpen, setInsertOpen] = useState(false);
  const insertRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!insertOpen) return;
    insertRoot.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (e: PointerEvent) => { if (e.target instanceof Node && !insertRoot.current?.contains(e.target)) setInsertOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.isComposing) { e.preventDefault(); setInsertOpen(false); insertRoot.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [insertOpen]);
  const [promptOpen, setPromptOpen] = useState(false);
  const ctxRoot = useRef<HTMLDivElement>(null);
  const ctxOpener = useRef<HTMLElement | null>(null);
  const mapOpener = useRef<HTMLButtonElement>(null);
  const returnMapFocus = useRef(sessions.get(noteId ?? '')?.returnFocus ?? false);
  const [pinAllowed, setPinAllowed] = useState(false);
  const calcNameRef = useRef<HTMLInputElement>(null);
  const calcFocusNote = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!calcFocusNote.current) return;
    if (calcFocusNote.current === noteId && note?.calcs.length) { calcNameRef.current?.focus(); calcFocusNote.current = null; }
    else if (calcFocusNote.current !== noteId) calcFocusNote.current = null;
  }, [noteId, note?.calcs.length]);
  const promptTarget = useRef<(PromptTarget & { bookmark: SelectionBookmark }) | null>(null);
  useLayoutEffect(() => {
    const root = ctxRoot.current;
    if (!root) return;
    const update = () => setPinAllowed(canPinContext(root.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const [moreOpen, setMoreOpen] = useState(false);
  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);

  // Draft syncs only from committed store value (note switch / external rename).
  useEffect(() => {
    setDraft(note?.title ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, note?.title]);

  const commitTitle = () => {
    if (note && draft !== note.title) actions.updateTitle(note.id, draft);
  };

  const langRef = useRef(lang);
  // The editor instance outlives note switches: its handlers read the note
  // currently shown through this ref, never a stale render closure (D1).
  const noteRef = useRef(note);
  noteRef.current = note;
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: () => tr("editorPh", langRef.current) })],
    content: note?.content,
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": tr("a11yNoteBody", lang) },
      handleKeyDown: (_view, event) => event.isComposing || event.keyCode === 229,
    },
    onUpdate: ({ editor: e }) => {
      const cur = noteRef.current;
      if (!cur) return;
      actions.updateDoc(cur.id, e.getJSON(), e.getText());
      setWords(e.getText());
      syncInlineMenus(e);
    },
  });
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const revealCaret = () => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed || !ed.isFocused || !window.matchMedia('(max-width: 760px)').matches) return;
    const viewport = window.visualViewport;
    const coords = ed.view.coordsAtPos(ed.state.selection.from);
    const headerBottom = document.querySelector('.s-header')?.getBoundingClientRect().bottom ?? 0;
    const footer = document.querySelector('.s-tabbar');
    const footerTop = footer && getComputedStyle(footer).display !== 'none' ? footer.getBoundingClientRect().top : Infinity;
    const top = Math.max((viewport?.offsetTop ?? 0) + 12, headerBottom + 12);
    const bottom = Math.min((viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight), footerTop) - 12;
    if (coords.bottom > bottom) window.scrollBy(0, coords.bottom - bottom);
    else if (coords.top < top) window.scrollBy(0, coords.top - top);
  };
  useEffect(() => {
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', revealCaret);
    return () => viewport?.removeEventListener('resize', revealCaret);
    // The handler reads the current editor through its ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);


  // Self-heal (P4): the mounted doc must converge to the store doc. A
  // delete→undo cycle (or chunk/remount timing) can leave a stale or empty
  // doc mounted while the store holds content; without this guard the stale
  // doc then overwrites the store via onUpdate (data loss). The text-equality
  // guard keeps typing intact: while the user types, editor and store agree.
  useLayoutEffect(() => {
    const ed = editorRef.current;
    if (note && ed && !ed.isDestroyed && ed.getText() !== (note.text ?? "")) {
      ed.commands.setContent(note.content, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId, notes]);

  // Switch document before paint and before any first input can arrive.
  useLayoutEffect(() => {
    const ed = editorRef.current;
    if (note && ed && !ed.isDestroyed) ed.commands.setContent(note.content, { emitUpdate: false });
    setWords(note?.text ?? "");
    setSuggest(null);
    setSlash(null);
    setMoreOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId]);

  useLayoutEffect(() => {
    if (focusNoteId !== noteId || !note || !editor || editor.isDestroyed) return;
    if (window.location.hash !== '#/notes/' + note.id) return;
    editor.commands.setTextSelection(0);
    editor.view.focus();
    revealCaret();
    onBodyFocused();
    // The request is consumed once, never when revisiting an existing note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId, focusNoteId]);

  // Keep selection-menu anchor in sync.
  useEffect(() => {
    if (!editor) return;
    const bump = ({ transaction }: { transaction: Transaction }) => {
      setTick(t => t + 1);
      const target = promptTarget.current;
      if (target && target.noteId === noteRef.current?.id) target.bookmark = target.bookmark.map(transaction.mapping);
    };
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
    actions.addLink(n.id, targetId ?? id);
    setSuggest(null);
    notify(tr("toastLinked", lang));
  };

  const focusEditorEnd = () => {
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) ed.chain().focus().insertContent("[[").run();
  };

  const closeContext = () => {
    setCtxOpen(false);
    if (rightOpen) onToggleRight();
    // A panel restored on return has no opener: focus goes back to the text.
    const opener = ctxOpener.current;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    else if (editorRef.current && !editorRef.current.isDestroyed) editorRef.current.view.focus();
  };
  const openContext = (next: ContextTab, opener: HTMLElement) => {
    ctxOpener.current = opener;
    returnMapFocus.current = false;
    setTab(next);
    setCtxOpen(true);
  };
  const requestCalculation = () => { const n = noteRef.current; if (n) { calcFocusNote.current = n.id; actions.addCalc(n.id); } };
  const openPrompt = () => {
    const ed = editorRef.current, n = noteRef.current;
    if (!ed || ed.isDestroyed || !n) return;
    promptTarget.current = { profileId, epoch: sessionEpoch, noteId: n.id, bookmark: ed.state.selection.getBookmark() };
    setInsertOpen(false);
    setCtxOpen(false);
    setPromptOpen(true);
  };
  // An implicit close (another note, section or session) never writes; the
  // filled result stays reachable through a copy action (Stage2 §7.8).
  const promptDraft = useRef('');
  const keepPromptDraft = useCallback((text: string) => { promptDraft.current = text; }, []);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const offerPromptCopy = () => {
    const text = promptDraft.current;
    promptDraft.current = '';
    if (!text) return;
    const l = langRef.current;
    actionsRef.current.notifyAction(tr('promptNotInserted', l), tr('copyResult', l), () => {
      void copyText(text).then((ok) => { if (ok) notifyRef.current(tr('toastCopied', langRef.current)); });
    });
  };
  useEffect(() => {
    offerPromptCopy();
    setPromptOpen(false);
    promptTarget.current = null;
    // offerPromptCopy reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, sessionEpoch, noteId]);
  // Leaving the section unmounts the window: same offer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => offerPromptCopy(), []);
  /** Explicit cancel: nothing written, caret back where the window opened. */
  const closePrompt = () => {
    const ed = editorRef.current, target = promptTarget.current;
    setPromptOpen(false);
    promptTarget.current = null;
    promptDraft.current = '';
    if (!ed || ed.isDestroyed) return;
    if (target && target.noteId === noteRef.current?.id) ed.view.dispatch(ed.state.tr.setSelection(target.bookmark.resolve(ed.state.doc)));
    ed.view.focus();
  };
  const insertPrompt = (choice: PromptChoice, bind: boolean) => {
    const ed = editorRef.current, n = noteRef.current, target = promptTarget.current;
    if (!ed || ed.isDestroyed || !n || !target || !choice.text || !promptTargetMatches(target, { profileId, epoch: sessionEpoch, noteId: n.id })) {
      notify(tr('promptInsertInvalid', lang));
      return;
    }
    const selection = target.bookmark.resolve(ed.state.doc);
    ed.chain().focus().insertContentAt({ from: selection.from, to: selection.to }, { type: 'codeBlock', content: [{ type: 'text', text: choice.text }] }).run();
    if (bind) actions.savePrompt(choice.source ? { ...choice.source, noteId: n.id } : { kind: choice.kind ?? 'llm', title: choice.title, templateId: choice.templateId, params: choice.params, model: choice.model, tokens: choice.tokens, noteId: n.id });
    setPromptOpen(false);
    promptTarget.current = null;
    promptDraft.current = '';
  };
  // §7.12: caret, scroll and panel of a note live in session memory and come
  // back on any return (another note, Map, Plan, Prompts, Back/Forward).
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const ctxOpenRef = useRef(ctxOpen);
  ctxOpenRef.current = ctxOpen;
  const sessionKey = `${profileId}:${sessionEpoch}`;
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  // Last scroll seen while this view was shown: by the time a departure is
  // recorded, removed siblings may already have shifted window.scrollY.
  const lastScroll = useRef(window.scrollY);
  useEffect(() => {
    const onScroll = () => { lastScroll.current = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const rememberNote = (id: string, returnFocus?: boolean) => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    const { from, to } = ed.state.selection;
    sessions.set(id, { from, to, scroll: lastScroll.current, tab: tabRef.current, open: ctxOpenRef.current, returnFocus: returnFocus ?? sessions.get(id)?.returnFocus ?? false });
  };
  // Leaving a note (switch or unmount) records it, within the same session.
  // Keyed on the note only: a recreated editor instance is not a departure.
  useLayoutEffect(() => {
    const key = sessionKey;
    return () => { if (noteId && key === sessionKeyRef.current) rememberNote(noteId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);
  const showOnMap = () => {
    const n = noteRef.current;
    if (!n) return;
    rememberNote(n.id, true);
    onShowMap(n.id);
  };
  const shownNote = useRef<string | null>(null);
  useLayoutEffect(() => {
    const ed = editorRef.current, saved = noteId ? sessions.get(noteId) : undefined;
    // A temporary panel comes back on a return from another section (mount,
    // see useState above) or on Back/Forward; opening another note closes it.
    if (shownNote.current !== null && shownNote.current !== noteId) {
      setCtxOpen(rightOpen || (lastNavigationWasTraversal() && (saved?.open ?? false)));
      setTab(saved?.tab ?? 'links');
    }
    shownNote.current = noteId;
    // New notes and palette picks place their own caret.
    if (saved && ed && !ed.isDestroyed && focusNoteId !== noteId && findRequest?.noteId !== noteId) {
      const max = ed.state.doc.content.size;
      ed.commands.setTextSelection({ from: Math.min(saved.from, max), to: Math.min(saved.to, max) });
      // The editor DOM may attach after this effect: scroll on the next frame.
      const y = saved.scroll;
      lastScroll.current = y;
      window.scrollTo(0, y);
      requestAnimationFrame(() => window.scrollTo(0, y));
      if (saved.returnFocus) {
        returnMapFocus.current = true;
        mapOpener.current?.focus({ preventScroll: true });
        saved.returnFocus = false;
      }
    }
    // A note's transient state is restored only when its document mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId]);

  // §7.5: a palette pick opens the note with the caret at the first match.
  useLayoutEffect(() => {
    if (!findRequest || findRequest.noteId !== noteId || !editor || editor.isDestroyed) return;
    if (window.location.hash !== '#/notes/' + findRequest.noteId) return;
    const blocks: { pos: number; text: string }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      blocks.push({ pos: pos + 1, text: node.textBetween(0, node.content.size, '\n', '￼') });
      return false;
    });
    editor.chain().setTextSelection(firstMatchPos(blocks, findRequest.query) ?? 0).scrollIntoView().run();
    editor.view.focus();
    revealCaret();
    onFindDone();
    // The request is consumed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId, findRequest]);

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
      { testid: "slash-item-5", label: tr("addCalc", lang), run: () => { delSlash(at); requestCalculation(); } },
      { testid: "slash-item-6", label: tr("addLinkBtn", lang), run: () => { delSlash(at); focusEditorEnd(); } },
      { testid: "slash-item-7", label: tr("insertPrompt", lang), run: () => { delSlash(at); openPrompt(); } },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, slash?.slashAt]);
  const SLASH_ITEMS = SLASH_RUNNERS.length;

  // Menu keys are captured at window level so Enter/Esc/arrows never reach
  // the document while a popup is open; typing passes through untouched.
  useEffect(() => {
    if (!suggest && !slash) return;
    const h = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
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
  // `N` opens a new note. Ctrl+Alt+T files the selection as a task (S3.8, P2:
  // Chrome reserves the old combination, so the hotkey moved; the ⋯/sel button stays).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
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
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyT") {
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
    actions.createTask({ text: selectionText() || noteDisplayName(n, lang), desc: "", noteId: n.id });
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

  const insertVar = (display: string) => {
    if (!note) return;
    const v = display.replace(/\s+/g, "");
    const targetId = focusCalc ?? note.calcs[note.calcs.length - 1]?.id;
    if (!targetId) return;
    const cur = note.calcs.find((c) => c.id === targetId)?.expr ?? "";
    actions.updateCalc(note.id, targetId, { expr: cur + (cur && !/\s$/.test(cur) ? " " : "") + v });
  };

  const varNames = note
    ? [...new Map(note.calcs.map((c) => c.name.trim()).filter((n) => n).map((n) => [n.replace(/\s+/g, ""), n])).values()]
    : [];

  const incoming = note ? notes.filter((n) => n.id !== note.id && n.linkedIds.includes(note.id)) : [];
  const noteTasks = note ? tasks.filter((t) => t.noteId === note.id) : [];
  const notePrompts = note ? prompts.filter((p) => p.noteId === note.id) : [];
  const wc = words.trim() ? words.trim().split(/\s+/).length : 0;

  return (
    <div ref={ctxRoot} className={"n-notes" + (note ? " has-open" : "") + (ctxOpen && rightOpen && pinAllowed ? " has-pinned-context" : "")}>
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
                autoComplete="off"
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
                    data-note-id={n.id}
                    aria-label={`${noteAccessibleName(n, lang)} · ${noteUpdatedLabel(n, lang)}`}
                    onClick={() => onOpenNote(n.id)}
                  >
                    <span className={!n.title.trim() ? "g-note-derived" : undefined}>{<Hi text={noteDisplayName(n, lang)} q={list.query} />}</span>
                  </button>
                  {n.text.trim() && <div className="g-notesnippet">{<Hi text={n.text} q={list.query} max={PREVIEW_LEN} />}</div>}
                  <div className="g-notemeta">
                    {noteUpdatedLabel(n, lang)} · {tr("linkedT", lang)}: {n.linkedIds.length}
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
                ref={titleRef}
                autoComplete="off"
                value={draft}
                placeholder={tr("untitledNote", lang)}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
              <div className="n-morewrap" ref={insertRoot}>
                <button type="button" className="g-btn sm" data-testid="insert-open" aria-expanded={insertOpen} onClick={() => setInsertOpen(v => !v)}>{tr('insertMenu', lang)} ▾</button>
                {insertOpen && <div className="n-menu" data-testid="insert-menu" role="menu" onKeyDown={e => {
                  if (e.key === 'Escape') { setInsertOpen(false); e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[data-testid="insert-open"]')?.focus(); }
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
                    const at = items.indexOf(document.activeElement as HTMLButtonElement);
                    items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
                  }
                }}>
                  <button type="button" role="menuitem" className="n-menuitem" data-testid="insert-item-prompt" onClick={openPrompt}>{tr('insertPrompt', lang)}</button>
                  <button type="button" role="menuitem" className="n-menuitem" data-testid="insert-item-calc" onClick={() => { setInsertOpen(false); requestCalculation(); }}>{tr('addCalc', lang)}</button>
                  <button type="button" role="menuitem" className="n-menuitem" data-testid="insert-item-link" onClick={() => { setInsertOpen(false); focusEditorEnd(); }}>{tr('addLinkBtn', lang)}</button>
                  <div className="n-menusep" role="separator" />
                  <div className="muted small">{tr('snipT', lang)}</div>
                  <button type="button" role="menuitem" className="n-menuitem" data-testid="insert-item-lec" onClick={() => { setInsertOpen(false); insertTpl('lec'); }}>{tr('snipLecture', lang)}</button>
                  <button type="button" role="menuitem" className="n-menuitem" data-testid="insert-item-ent" onClick={() => { setInsertOpen(false); insertTpl('ent'); }}>{tr('snipEnt', lang)}</button>
                  <button type="button" role="menuitem" className="n-menuitem" data-testid="insert-item-proj" onClick={() => { setInsertOpen(false); insertTpl('proj'); }}>{tr('snipProj', lang)}</button>
                </div>}
              </div>
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
                        if (note) actions.exportMd(note.id);
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
                        if (note) actions.duplicate(note.id);
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
                        if (note) actions.deleteNote(note.id);
                      }}
                    >
                      {tr("deleteNote", lang)}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div data-testid="ctx-block" className="note-context-block">
              <div className="note-context-links">
                <span className="muted small">{tr('linkedT', lang)}: </span>
                {note.linkedIds.length + incoming.length === 0 && <span className="muted small">{tr('ctxNoLinks', lang)}</span>}
                {[...notes.filter(n => note.linkedIds.includes(n.id)), ...incoming].filter((n, i, all) => all.findIndex(x => x.id === n.id) === i).slice(0, 3).map(n =>
                  <button type="button" className="g-linkbtn" key={n.id} aria-label={noteAccessibleName(n, lang)} onClick={() => onOpenNote(n.id)}>{incoming.some(x => x.id === n.id) && '← '}{noteDisplayName(n, lang)}</button>)}
                <button type="button" className="g-btn sm" data-testid="ctx-all-links" onClick={e => openContext('links', e.currentTarget)}>{tr('ctxAllLinks', lang)} ({note.linkedIds.length + incoming.length})</button>
              </div>
              <div className="note-context-tools">
                <button type="button" className="g-btn sm" data-testid="ctx-open-tasks" onClick={e => openContext('tasks', e.currentTarget)}>{tr('noteTasksT', lang)}{noteTasks.length ? ' · ' + noteTasks.length : ''}</button>
                <button type="button" className="g-btn sm" data-testid="ctx-open-prompts" onClick={e => openContext('prompts', e.currentTarget)}>{tr('promptsT', lang)}{notePrompts.length ? ' · ' + notePrompts.length : ''}</button>
                <button ref={mapOpener} type="button" className="g-linkbtn" data-testid="ctx-show-map" onClick={showOnMap}>{tr('ctxShowMap', lang)}</button>
                {graphs.filter(g => g.noteIds.includes(note.id)).map(g => <span className="g-kind" key={g.id}>{g.title}</span>)}
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

            <div data-testid="editor" onKeyDown={(e) => {
              // Keep handled editor keys (e.g. list outdent); otherwise visit
              // the title before the body in the reverse keyboard path.
              if (e.key === "Tab" && e.shiftKey && !e.defaultPrevented && !e.nativeEvent.isComposing) {
                e.preventDefault();
                titleRef.current?.focus();
              }
            }}>
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
                    aria-label={`${noteAccessibleName(n, lang)} · ${noteUpdatedLabel(n, lang)}`}
                    className={"n-suggestitem" + (i === suggest.active ? " active" : "")}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggest(n.id)}
                  >
                    <span className={!n.title.trim() ? "g-note-derived" : undefined} title={noteAccessibleName(n, lang)}>{noteDisplayName(n, lang)}<small className="muted"> · {noteUpdatedLabel(n, lang)} · {n.text.slice(0, PREVIEW_LEN)}</small></span>
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
                {[SLASH_RUNNERS.slice(0, 2), SLASH_RUNNERS.slice(2)].map((group) => <div role="group" className="n-slash-group" key={group[0]?.testid}>{group.map((r) => (
                  <button
                    key={r.testid}
                    type="button"
                    role="menuitem"
                    data-testid={r.testid}
                    className={"n-suggestitem" + (SLASH_RUNNERS.indexOf(r) === slash.active ? " active" : "")}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSlash(null);
                      r.run();
                    }}
                  >
                    {r.label}
                  </button>
                ))}</div>)}
              </div>
            )}

            {note.calcs.length > 0 && <div className="g-card g-calcs" data-testid="calc-block">
              <div className="g-card-t">
                {tr("calcsT", lang)} ({note.calcs.length})
              </div>
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
              {note.calcs.map((c, calcIndex) => {
                const d = calcDisplay(c, note.calcs, lang);
                return (
                  <div className="g-calcrow" key={c.id}>
                    <input
                      ref={calcIndex === note.calcs.length - 1 ? calcNameRef : undefined}
                      data-testid="calc-name"
                      value={c.name}
                      onChange={(e) => actions.updateCalc(note.id, c.id, { name: e.target.value })}
                      placeholder={tr("calcNamePh", lang)}
                      className="g-calc-name"
                      aria-label={tr("calcNamePh", lang)}
                    />
                    <input
                      value={c.expr}
                      onChange={(e) => actions.updateCalc(note.id, c.id, { expr: e.target.value })}
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
                      onClick={() => actions.deleteCalc(note.id, c.id)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <button type="button" className="g-btn sm g-wide" onClick={requestCalculation}>
                {tr("addCalc", lang)}
              </button>
            </div>}
          </section>
        )}
      </div>
      )}

      {ctxOpen && note && <Suspense fallback={<div role="status">{tr('ctxTitle', lang)}…</div>}>
        <NoteContext lang={lang} note={note} notes={notes} graphs={graphs} tasks={tasks} prompts={prompts} actions={actions} tab={tab} onTab={setTab}
          pinned={rightOpen && pinAllowed} canPin={pinAllowed} onPin={onToggleRight} onClose={closeContext} autoFocus={!returnMapFocus.current}
          onOpenNote={onOpenNote} onOpenPlan={onOpenPlan} onOpenPrompt={onOpenPrompt} onUnbind={onUnbind}
          onAddLink={() => { closeContext(); focusEditorEnd(); }} onTask={openTaskFromSelection} onInsertPrompt={openPrompt} onShowMap={showOnMap} />
      </Suspense>}
      {promptOpen && note && <Suspense fallback={<div role="status">{tr('insertPrompt', lang)}…</div>}>
        <PromptInsert lang={lang} templates={templates} saves={prompts}
          valid={!!promptTarget.current && promptTargetMatches(promptTarget.current, { profileId, epoch: sessionEpoch, noteId: note.id })}
          onInsert={insertPrompt} onClose={closePrompt} onDraft={keepPromptDraft} />
      </Suspense>}

    </div>
  );
}
