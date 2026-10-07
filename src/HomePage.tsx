import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import type { Lang } from './i18n';
import { tr } from './i18n';
import { unlinkedNotes } from './store';
import type { Graph, Note, PromptSave, TaskItem } from './store';
import { LinkDialog } from './LinkDialog';
import { TaskDialog } from './TaskDialog';
import type { TaskDraft } from './TaskDialog';

export interface HomeActions {
  updateTitle: (v: string) => void;
  updateDoc: (doc: Note['content'], text: string) => void;
  createTask: (d: { text: string; desc: string; due?: string; noteId?: string }) => void;
  updateTask: (id: string, patch: { text?: string; desc?: string; due?: string }) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  duplicate: () => void;
  exportMd: () => void;
  deleteNote: () => void;
  addLink: (title: string) => void;
  removeLink: (title: string) => void;
  addCalc: () => void;
  updateCalc: (id: string, patch: { name?: string; expr?: string }) => void;
  deleteCalc: (id: string) => void;

}

const TPL_HTML: Record<string, string> = {
  lec: '<h3>Лекция — план</h3><ul><li>Цель</li><li>Определения</li><li>Примеры</li><li>Вопросы</li></ul>',
  ent: '<h3>ЕНТ — план дня</h3><ul><li>Разобрать 10 заданий</li><li>Повторить формулы</li><li>Пробник на время</li></ul>',
  proj: '<h3>Проект</h3><ul><li>Задача</li><li>Шаги</li><li>Дедлайн</li></ul>',
};

const STOP = new Set(['лекция', 'план', 'как', 'для', 'что', 'это', 'или', 'the', 'and', 'және']);

function wordsOf(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-zа-яёәіңғүұқөһ0-9]+/i)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

/** Notes related to the current one: same notebook or a shared significant word. */
function similarNotes(note: Note, notes: Note[], graphs: Graph[]): Note[] {
  const mine = new Set(wordsOf(note.title));
  const shared = (a: string, b: string) => graphs.some((g) => g.noteIds.includes(a) && g.noteIds.includes(b));
  // No cap here: ranking order is fixed, the card shows the first few with
  // a pager into the rest (silent slice(0, 3) used to hide the tail).
  return notes
    .filter((n) => n.id !== note.id && !note.linkedIds.includes(n.id))
    .filter((n) => shared(note.id, n.id) || wordsOf(n.title).some((w) => mine.has(w)));
}

const normName = (n: string) => n.trim().replace(/\s+/g, '');

/** Safe arithmetic with named variables, no eval. Throws on cycle / unknown names. */
function evalExpr(src: string, blocks: { name: string }[], lookup: (name: string) => number): number {
  const s = src.replace(/\s+/g, '').replace(/,/g, '.');
  const names = blocks
    .map((b) => normName(b.name))
    .filter((n) => n.length > 0)
    .sort((a, b) => b.length - a.length);
  let i = 0;
  function parseExpr(): number {
    let v = parseTerm();
    while (s[i] === '+' || s[i] === '-') {
      const op = s[i++];
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (s[i] === '*' || s[i] === '/' || s[i] === '%') {
      const op = s[i++];
      const r = parseFactor();
      if (op === '*') v *= r;
      else if (op === '/') {
        if (!r) throw new Error('div0');
        v /= r;
      } else v %= r;
    }
    return v;
  }
  function parseFactor(): number {
    const c = s[i];
    if (c === '(') {
      i++;
      const v = parseExpr();
      if (s[i] !== ')') throw new Error('paren');
      i++;
      return v;
    }
    if (c === '-') {
      i++;
      return -parseFactor();
    }
    if (c === '+') {
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
    throw new Error('unknown:' + (idm ? idm[0] : (c ?? '')));
  }
  if (!s) throw new Error('empty');
  const v = parseExpr();
  if (i !== s.length) throw new Error('end');
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
  if (visiting.has(id)) throw new Error('cycle');
  const b = blocks.find((x) => x.id === id);
  if (!b) throw new Error('unknown:');
  visiting.add(id);
  try {
    const v = evalExpr(b.expr, blocks, (name) => {
      const t = blocks.find((x) => normName(x.name) === name);
      if (!t) throw new Error('unknown:' + name);
      return resolveBlock(t.id, blocks, memo, visiting);
    });
    memo.set(id, v);
    return v;
  } finally {
    visiting.delete(id);
  }
}

function calcDisplay(c: CalcLike, blocks: CalcLike[], lang: Lang): { text: string; title: string } {
  if (!c.expr.trim()) return { text: '', title: '' };
  try {
    const v = resolveBlock(c.id, blocks, new Map(), new Set());
    if (!Number.isFinite(v)) return { text: '—', title: '' };
    return { text: '= ' + (Math.round(v * 100) / 100).toLocaleString('ru-RU'), title: '' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'cycle') return { text: '—', title: tr('calcCycle', lang) };
    if (msg.startsWith('unknown:')) return { text: '—', title: tr('calcUnknown', lang) + msg.slice(8) };
    return { text: '—', title: '' };
  }
}

type TaskDlgState =
  | { mode: 'new'; text: string }
  | { mode: 'edit'; id: string; text: string; desc: string; due: string };

export function HomePage({
  lang,
  hintKey,
  note,
  notes,
  tasks,



  graphs,
  onOpenNote,
  prompts,
  onOpenPrompt,
  onUnbind,
  rightOpen,
  onToggleRight,
  actions,
  notify,
}: {
  lang: Lang;
  hintKey: string;
  note: Note;
  notes: Note[];
  tasks: TaskItem[];



  graphs: Graph[];
  onOpenNote: (id: string) => void;
  prompts: PromptSave[];
  onOpenPrompt: (id: string) => void;
  onUnbind: (id: string) => void;
  rightOpen: boolean;
  onToggleRight: () => void;
  actions: HomeActions;
  notify: (msg: string) => void;
}) {
  const [words, setWords] = useState(note.text);
  const [, setTick] = useState(0);
  const [linkQuery, setLinkQuery] = useState<string | null>(null);
  const [taskDlg, setTaskDlg] = useState<TaskDlgState | null>(null);
  const [focusCalc, setFocusCalc] = useState<string | null>(null);
  const [hint, setHint] = useState(() => {
    try {
      return window.localStorage.getItem(hintKey) !== '1';
    } catch {
      return true;
    }
  });
  const [draft, setDraft] = useState(note.title);
  const [simShown, setSimShown] = useState(3);
  const [orphShown, setOrphShown] = useState(4);
  // Draft syncs only from committed store value (note switch / external rename).
  useEffect(() => {
    setDraft(note.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.title]);

  const commitTitle = () => {
    if (draft !== note.title) actions.updateTitle(draft);
  };

  // Placeholder text follows the UI language through the extension API (a
  // function option), not by poking extension internals. The ref keeps the
  // closure fresh; an empty transaction re-renders the decoration on switch.
  const langRef = useRef(lang);
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: () => tr('editorPh', langRef.current) })],
    content: note.content,
    onUpdate: ({ editor: e }) => {
      actions.updateDoc(e.getJSON(), e.getText());
      setWords(e.getText());
    },
  });

  // Switch document when the active note changes (not on every keystroke).
  // A destroyed instance (tiptap recreates the editor across mounts, and a
  // lazy boundary shifts that timing) has no command manager: skip it, the
  // recreated instance re-syncs through this same effect.
  const noteId = note.id;
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.setContent(note.content, { emitUpdate: false });
    setWords(note.text);
    setSimShown(3);
    setOrphShown(4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId]);

  // Keep toolbar buttons (active states, undo availability) in sync.
  useEffect(() => {
    if (!editor) return;
    const bump = () => setTick((t) => t + 1);
    editor.on('transaction', bump);
    return () => {
      editor.off('transaction', bump);
    };
  }, [editor]);

  // Follow UI language in the empty-doc placeholder.
  useEffect(() => {
    langRef.current = lang;
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr);
  }, [editor, lang]);

  const dismissHint = () => {
    setHint(false);
    try {
      window.localStorage.setItem(hintKey, '1');
    } catch {
      /* ignore */
    }
  };

  const tbtn = (label: string, title: string, isActive: boolean, disabled: boolean, fn: () => void) => (
    <button
      key={label}
      type="button"
      className={`g-tbtn${isActive ? ' active' : ''}`}
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={fn}
    >
      {label}
    </button>
  );

  const makeTask = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const sel = editor.state.doc.textBetween(from, to, ' ').trim();
    setTaskDlg({ mode: 'new', text: sel || note.title });
  };

  const saveTaskDlg = (d: TaskDraft) => {
    if (!taskDlg) return;
    if (taskDlg.mode === 'new') {
      actions.createTask({ text: d.text, desc: d.desc, due: d.due || undefined, noteId: note.id });
    } else {
      actions.updateTask(taskDlg.id, { text: d.text, desc: d.desc, due: d.due || undefined });
    }
    setTaskDlg(null);
  };

  const insertTpl = (key: string) => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.insertContent(TPL_HTML[key]);
    editor.commands.focus();
    notify(tr("toastSnipApplied", lang));
  };

  const confirmLink = (id: string) => {
    actions.addLink(id);
    setLinkQuery(null);
    notify(tr('toastLinked', lang));
  };

  const insertVar = (display: string) => {
    const v = display.replace(/\s+/g, '');
    const targetId = focusCalc ?? note.calcs[note.calcs.length - 1]?.id;
    if (!targetId) return;
    const cur = note.calcs.find((c) => c.id === targetId)?.expr ?? '';
    actions.updateCalc(targetId, { expr: cur + (cur && !/\s$/.test(cur) ? ' ' : '') + v });
  };

  const varNames = [...new Map(note.calcs.map((c) => c.name.trim()).filter((n) => n).map((n) => [n.replace(/\s+/g, ''), n])).values()];

  const similar = similarNotes(note, notes, graphs);
  const homeTitle = graphs.find((g) => g.noteIds.includes(note.id))?.title ?? tr('ungrouped', lang);
  const incoming = notes.filter((n) => n.id !== note.id && n.linkedIds.includes(note.id));
  const orphans = unlinkedNotes(notes);
  const noteTasks = tasks.filter((t) => t.noteId === note.id);
  const wc = words.trim() ? words.trim().split(/\s+/).length : 0;

  return (
    <div className="g-cols">
      <section className="g-center">
        <div className="g-dochead">
          <div className="g-crumb">
            {homeTitle} / {note.title}
          </div>
          <div className="g-docactions">
            <span className="g-wordcount">
              {wc} {tr('words', lang)}
            </span>
            <button type="button" className="g-abtn" onClick={actions.exportMd}>
              {tr('exportMd', lang)}
            </button>
            <button type="button" className="g-abtn" onClick={actions.duplicate}>
              {tr('duplicate', lang)}
            </button>
            <button type="button" className="g-abtn danger" onClick={actions.deleteNote}>
              {tr('deleteNote', lang)}
            </button>
          </div>
        </div>

        <input
          className="g-title-in"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setDraft(note.title);
          }}
          aria-label={tr('a11yTitle', lang)}
        />

        <div className="g-tbar" role="toolbar" aria-label={tr('a11yFormat', lang)}>
          {tbtn('B', 'Bold', !!editor?.isActive('bold'), !editor, () => editor?.chain().focus().toggleBold().run())}
          {tbtn('I', 'Italic', !!editor?.isActive('italic'), !editor, () => editor?.chain().focus().toggleItalic().run())}
          {tbtn('H', 'Heading', !!editor?.isActive('heading', { level: 3 }), !editor, () =>
            editor?.chain().focus().toggleHeading({ level: 3 }).run(),
          )}
          {tbtn('≡', 'List', !!editor?.isActive('bulletList'), !editor, () => editor?.chain().focus().toggleBulletList().run())}
          {tbtn('↩', 'Undo', false, !editor?.can().undo(), () => editor?.chain().focus().undo().run())}
          {tbtn('↪', 'Redo', false, !editor?.can().redo(), () => editor?.chain().focus().redo().run())}
          <button
            type="button"
            className="g-tbtn wide"
            title={tr('makeTask', lang)}
            disabled={!editor}
            onMouseDown={(e) => e.preventDefault()}
            onClick={makeTask}
          >
            {tr('makeTask', lang)}
          </button>
        </div>

        {hint && (
          <div className="g-hint">
            <span>{tr('hintFirst', lang)}</span>
            <button type="button" onClick={dismissHint} aria-label={tr('closeBtn', lang)}>
              ×
            </button>
          </div>
        )}

        <EditorContent editor={editor} />

        {noteTasks.length > 0 && (
          <div className="g-card g-note-tasks">
            <div className="g-card-t">
              {tr('noteTasksT', lang)} ({noteTasks.length})
            </div>
            {noteTasks.map((t) => (
              <div className="g-sugg" key={t.id}>
                <label className={`g-undone${t.done ? ' done' : ''}`}>
                  <input type="checkbox" checked={t.done} onChange={() => actions.toggleTask(t.id)} />
                  <span>
                    {t.text}
                    {t.desc && <div className="g-tdesc">{t.desc}</div>}
                  </span>
                </label>
                <span>
                  <button
                    type="button"
                    className="g-linkbtn"
                    onClick={() => setTaskDlg({ mode: 'edit', id: t.id, text: t.text, desc: t.desc ?? '', due: t.due ?? '' })}
                  >
                    [{tr('editBtn', lang)}]
                  </button>{' '}
                  <button type="button" className="g-linkbtn" onClick={() => actions.deleteTask(t.id)}>
                    [{tr('deleteNote', lang)}]
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="g-card g-calcs">
          <div className="g-card-t">
            {tr('calcsT', lang)} ({note.calcs.length})
          </div>
          {note.calcs.length === 0 && <div className="muted small">{tr('emptyCalcs', lang)}</div>}
          {varNames.length > 0 && (
            <div className="g-vars">
              <span className="muted small">{tr('varsHint', lang)}</span>
              {varNames.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="g-varchip mono"
                  title={tr('insertVar', lang)}
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
                  placeholder={tr('calcNamePh', lang)}
                  className="g-calc-name"
                  aria-label={tr('calcNamePh', lang)}
                />
                <input
                  value={c.expr}
                  onChange={(e) => actions.updateCalc(c.id, { expr: e.target.value })}
                  onFocus={() => setFocusCalc(c.id)}
                  placeholder={tr('calcExprPh', lang)}
                  className="g-calc-expr mono"
                  aria-label={tr('calcExprL', lang)}
                />
                <code className="g-calc-res" title={d.title}>
                  {d.text}
                </code>
                <button
                  type="button"
                  className="g-tdel show"
                  aria-label={tr('closeBtn', lang)}
                  onClick={() => actions.deleteCalc(c.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button type="button" className="g-btn sm g-wide" onClick={actions.addCalc}>
            {tr('addCalc', lang)}
          </button>
        </div>
      </section>

      {rightOpen ? (
      <aside className="g-right">
        <button type="button" className="g-btn sm ghost" title={tr('panelToggle', lang)} aria-label={tr('panelToggle', lang)} onClick={onToggleRight}>
          &#8249;
        </button>
        <div className="g-card">
          <div className="g-card-t">
            {tr('linkedT', lang)} ({note.linkedIds.length})
          </div>
          {note.linkedIds.length === 0 && <div className="muted small">{tr('emptyOrphans', lang)}</div>}
          <ul>
            {note.linkedIds.map((id) => (
              <li key={id} className="g-linkrow-li">
                <button type="button" className="g-linkbtn" onClick={() => onOpenNote(id)}>
                  {notes.find((n) => n.id === id)?.title ?? id.slice(-4)}
                </button>
                <button
                  type="button"
                  className="g-unlink"
                  title={tr('unlinkTitle', lang)}
                  onClick={() => actions.removeLink(id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {incoming.length > 0 && (
            <>
              <div className="g-card-t sub">
                {tr('backlinksT', lang)} ({incoming.length})
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
          <button type="button" className="g-btn sm g-wide" onClick={() => setLinkQuery('')}>
            {tr('addLinkBtn', lang)}
          </button>
        </div>
        <div className="g-card warn">
          <div className="g-card-t">{tr('similarT', lang)} ({similar.length})</div>
          {similar.length === 0 && <div className="muted small">{tr('similarEmpty', lang)}</div>}
          {similar.length > 0 && (
            <div className="muted small">
              {tr('listShownOf', lang).replace('{x}', String(Math.min(simShown, similar.length))).replace('{y}', String(similar.length))}
            </div>
          )}
          {similar.slice(0, simShown).map((s) => (
            <div className="g-sugg" key={s.id}>
              <button type="button" className="g-linkbtn" onClick={() => onOpenNote(s.id)}>
                • {s.title}
              </button>
              <button type="button" className="g-linkbtn" onClick={() => setLinkQuery(s.title)}>
                [{tr('linkQ', lang)}]
              </button>
            </div>
          ))}
          {simShown < similar.length && (
            <button type="button" className="g-btn sm g-tpl-more" onClick={() => setSimShown((s) => s + 3)}>
              {tr('tplShowMore', lang).replace('{n}', String(Math.min(3, similar.length - simShown)))}
            </button>
          )}
        </div>
        <div className="g-card">
          <div className="g-card-t">
            {tr('promptsT', lang)} ({prompts.filter((p) => p.noteId === note.id).length})
          </div>
          {prompts.filter((p) => p.noteId === note.id).length === 0 && (
            <div className="muted small">{tr('notePromptsEmpty', lang)}</div>
          )}
          {prompts
            .filter((p) => p.noteId === note.id)
            .map((p) => (
              <div className="g-sugg" key={p.id}>
                <span>
                  • {p.title} <span className="g-kind">{p.kind}</span>
                </span>
                <span>
                  <button type="button" className="g-linkbtn" onClick={() => onOpenPrompt(p.id)}>
                    [{tr('openBtn', lang)}]
                  </button>{' '}
                  <button type="button" className="g-linkbtn" onClick={() => onUnbind(p.id)}>
                    [{tr('unbindBtn', lang)}]
                  </button>
                </span>
              </div>
            ))}
        </div>
        <div className="g-card danger">
          <div className="g-card-t">
            {tr('orphansT', lang)} ({orphans.length})
          </div>
          {orphans.length === 0 && <div className="g-empty-ok">{tr('emptyOrphans', lang)}</div>}
          {orphans.length > 0 && (
            <div className="muted small">
              {tr('listShownOf', lang).replace('{x}', String(Math.min(orphShown, orphans.length))).replace('{y}', String(orphans.length))}
            </div>
          )}
          {orphans.slice(0, orphShown).map((n) => (
            <div className="g-sugg" key={n.id}>
              <button type="button" className="g-linkbtn" onClick={() => onOpenNote(n.id)}>
                • {n.title || tr('newNoteTitle', lang)}
              </button>
            </div>
          ))}
          {orphShown < orphans.length && (
            <button type="button" className="g-btn sm g-tpl-more" onClick={() => setOrphShown((s) => s + 4)}>
              {tr('tplShowMore', lang).replace('{n}', String(Math.min(4, orphans.length - orphShown)))}
            </button>
          )}
        </div>
        <div className="g-card">
          <div className="g-card-t">{tr("snipT", lang)}</div>
          <div className="g-tplbtns">
            <button type="button" className="g-chip sm" onClick={() => insertTpl('lec')}>
              {tr("snipLecture", lang)}
            </button>
            <button type="button" className="g-chip sm" onClick={() => insertTpl('ent')}>
              {tr("snipEnt", lang)}
            </button>
            <button type="button" className="g-chip sm" onClick={() => insertTpl('proj')}>
              {tr("snipProj", lang)}
            </button>
          </div>
        </div>
      </aside>
      ) : (
        <aside className="g-rail-r">
          <button type="button" title={tr('panelToggle', lang)} aria-label={tr('panelToggle', lang)} onClick={onToggleRight}>
            &#8250;
          </button>
        </aside>
      )}

      {linkQuery !== null && (
        <LinkDialog
          lang={lang}
          source={note.title}
          notes={notes}
          linkedIds={note.linkedIds}
          excludeId={note.id}
          initialQuery={linkQuery}
          onConfirm={confirmLink}
          onClose={() => setLinkQuery(null)}
        />
      )}

      {taskDlg && (
        <TaskDialog
          lang={lang}
          title={tr(taskDlg.mode === 'new' ? 'taskDlgNew' : 'taskDlgEdit', lang)}
          source={note.title}
          initial={
            taskDlg.mode === 'new'
              ? { text: taskDlg.text, desc: '', due: '' }
              : { text: taskDlg.text, desc: taskDlg.desc, due: taskDlg.due }
          }
          onClose={() => setTaskDlg(null)}
          onSave={saveTaskDlg}
        />
      )}
    </div>
  );
}

