import { useCallback, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { Note, TaskItem } from "./store";
import { filterTasks } from "./store";
import { Hi } from "./widgets";
import { TPL_LIMITS } from "./listPrefs";
import { useListState } from "./useListState";
import { useArmConfirm } from "./useArmConfirm";
import { fmtDue } from "./widgets";
import { TaskDialog } from "./TaskDialog";

type Filter = "active" | "done" | "all";

export function TasksPage({
  lang,
  tasks,
  notes,
  onToggle,
  onDelete,
  onAdd,
  onUpdate,
  onOpenNote,
  profileId,
}: {
  lang: Lang;
  tasks: TaskItem[];
  notes: Note[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (text: string, due?: string) => void;
  onUpdate: (id: string, patch: { text?: string; desc?: string; due?: string }) => void;
  onOpenNote: (id: string) => void;
  profileId: string;
}) {
  const [filter, setFilter] = useState<Filter>("active");
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  // Row delete is two-step like every other × in the app (trash keeps it reversible).
  const delConfirm = useArmConfirm();
  const addRef = useRef<HTMLInputElement>(null);
  const select = useCallback((q: string) => filterTasks(tasks, filter, q), [tasks, filter]);
  const list = useListState({
    key: "tasks",
    profileId,
    select,
    onPick: (t) => onToggle(t.id),
  });
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onAdd(v, due || undefined);
    setText("");
    setDue("");
    if (filter === "done") setFilter("active");
  };
  const titleOf = (id: string | undefined) => notes.find((n) => n.id === id)?.title;
  const editing = tasks.find((t) => t.id === editingId);
  const query = list.query.trim();

  return (
    <div className="g-page">
      <div className="g-page-h">
        <h2 className="g-h2">{tr("nav_tasks", lang)}</h2>
        <div className="g-filters">
          {(["active", "done", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={"g-chipbtn" + (filter === f ? " active" : "")}
              onClick={() => { setFilter(f); list.resetShown(); list.resetNavigation(); }}
            >
              {tr(f === "active" ? "fActive" : f === "done" ? "fDone" : "fAll", lang)}
            </button>
          ))}
        </div>
      </div>

      <div className="g-addtask">
        <input
          ref={addRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={tr("addTaskPh", lang)}
          aria-label="new task"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="due date"
          className="g-date"
        />
        <button type="button" className="g-btn sm" onClick={submit}>
          {tr("addTask", lang)}
        </button>
      </div>

      <div className="g-notes-tools">
        <input
          className="g-in"
          value={list.query}
          onChange={(e) => list.changeQuery(e.target.value)}
          onKeyDown={list.nav.onKeyDown}
          placeholder={tr("taskSearchPh", lang)}
          aria-label="filter tasks"
        />
        <div className="g-seg" role="group" aria-label="limit">
          {TPL_LIMITS.map((n) => (
            <button
              key={n}
              type="button"
              className={"g-btn sm" + (list.limit === n ? " active" : "")}
              onClick={() => list.changeLimit(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {list.filtered.length === 0 &&
        (query ? (
          <div className="g-tpl-empty">
            <div className="muted">{tr("noResults", lang)}</div>
            <button type="button" className="g-btn sm" onClick={() => list.changeQuery("")}>
              {tr("tplResetFilter", lang)}
            </button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="g-empty">
            <div className="g-empty-t">{tr("emptyTasksActive", lang)}</div>
            <button type="button" className="g-btn primary" onClick={() => addRef.current?.focus()}>
              {tr("addFirstTask", lang)}
            </button>
          </div>
        ) : (
          <div className="muted">{tr(filter === "done" ? "emptyTasksDone" : "emptyTasksActive", lang)}</div>
        ))}
      {list.filtered.length > 0 && (
        <div className="muted small">
          {tr("listShownOf", lang).replace("{x}", String(list.visible.length)).replace("{y}", String(list.filtered.length))}
        </div>
      )}
      {list.visible.map((t, i) => {
        const src = titleOf(t.noteId);
        return (
          <label
            key={t.id}
            className={"g-taskline" + (t.done ? " done" : "") + (i === list.nav.active ? " active" : "")}
            onMouseEnter={() => list.nav.setActive(i)}
          >
            <input type="checkbox" checked={t.done} onChange={() => onToggle(t.id)} />
            <span>
              {<Hi text={t.text} q={list.query} />}
              {t.due && (
                <span className="g-due" style={{ marginLeft: 8 }}>
                  {fmtDue(t.due)}
                </span>
              )}
              {t.desc && <div className="g-tdesc">{t.desc}</div>}
            </span>
            {t.noteId &&
              (src ? (
                <button
                  type="button"
                  className="g-src"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenNote(t.noteId as string);
                  }}
                >
                  {tr("fromSrc", lang)}: {src}
                </button>
              ) : (
                <span className="g-src gone">{tr("srcGone", lang)}</span>
              ))}
            <span className="g-tasks-ops">
              <button
                type="button"
                className="g-linkbtn"
                onClick={(e) => {
                  e.preventDefault();
                  setEditingId(t.id);
                }}
              >
                [{tr("editBtn", lang)}]
              </button>
              <button
                type="button"
                className={"g-tdel" + (delConfirm.isArmed("t:" + t.id) ? " g-danger-arm" : "")}
                aria-label={tr("closeBtn", lang)}
                onClick={(e) => {
                  e.preventDefault();
                  if (delConfirm.confirm("t:" + t.id)) onDelete(t.id);
                }}
              >
                {delConfirm.isArmed("t:" + t.id) ? tr("confirmTrash", lang) : "×"}
              </button>
            </span>
          </label>
        );
      })}
      {list.shown < list.filtered.length && (
        <button
          type="button"
          className="g-btn sm g-tpl-more"
          onClick={() => list.showMore()}
        >
          {tr("tplShowMore", lang).replace("{n}", String(Math.min(list.limit, list.filtered.length - list.shown)))}
        </button>
      )}

      {editing && (
        <TaskDialog
          lang={lang}
          title={tr("taskDlgEdit", lang)}
          source={editing.noteId ? titleOf(editing.noteId) : undefined}
          initial={{ text: editing.text, desc: editing.desc ?? "", due: editing.due ?? "" }}
          onClose={() => setEditingId(null)}
          onSave={(d) => {
            onUpdate(editing.id, { text: d.text, desc: d.desc, due: d.due || undefined });
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}
