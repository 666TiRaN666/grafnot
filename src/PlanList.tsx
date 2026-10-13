import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { Note, TaskItem } from "./store";
import { Hi, fmtDue } from "./widgets";
import { addDaysISO, groupTasks, todayISO } from "./taskGroups";
import type { TaskGroupKey } from "./taskGroups";

/** N9 batch for long task lists (no limit selector). */
const TASKS_PAGE = 50;
/** Horizontal swipe distance that deletes a row on touch. */
const SWIPE_DEL_PX = 48;

function groupTitle(key: TaskGroupKey | "done", n: number, lang: Lang): string {
  const base =
    key === "overdue" ? tr("overdueT", lang)
    : key === "today" ? tr("today", lang)
    : key === "tomorrow" ? tr("dueTomorrow", lang)
    : key === "week" ? tr("weekT", lang)
    : key === "later" ? tr("laterT", lang)
    : key === "undated" ? tr("undated", lang)
    : tr("doneT", lang);
  return `${base} (${n})`;
}

export function PlanList({
  lang,
  tasks,
  notes,
  onToggle,
  onDelete,
  onAdd,
  onUpdate,
  onOpenNote,
}: {
  lang: Lang;
  tasks: TaskItem[];
  notes: Note[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (text: string, opts?: { desc?: string; due?: string }) => void;
  onUpdate: (id: string, patch: { text?: string; desc?: string; due?: string }) => void;
  onOpenNote: (id: string) => void;
}) {
  const today = todayISO();
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(TASKS_PAGE);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["done"]));
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  // Composer draft survives collapse (Esc never eats text).
  const [cOpen, setCOpen] = useState(false);
  const [cTitle, setCTitle] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cShowDesc, setCShowDesc] = useState(false);
  const [cDue, setCDue] = useState("");
  const [cShowDate, setCShowDate] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const touchX = useRef<number | null>(null);

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (needle ? tasks.filter((t) => `${t.text} ${t.desc ?? ""}`.toLowerCase().includes(needle)) : tasks),
    [tasks, needle],
  );
  const { active, done } = useMemo(() => groupTasks(filtered, today), [filtered, today]);
  // One flat budget across expanded groups; collapsed groups keep their
  // headers (with counts) so they can be reopened. Search force-expands.
  const sections = useMemo(() => {
    let rest = shown;
    return active.map((g) => {
      const shut = collapsed.has(g.key) && !needle;
      const items = shut ? [] : g.items.slice(0, Math.max(rest, 0));
      if (!shut) rest -= items.length;
      return { key: g.key, total: g.items.length, items };
    });
  }, [active, shown, collapsed, needle]);
  const doneShut = collapsed.has("done") && !needle;
  const visibleDone = doneShut ? [] : done.slice(0, shown);
  const flatIds = useMemo(() => {
    const vd = doneShut ? [] : done.slice(0, shown);
    return [...sections.flatMap((g) => g.items.map((t) => t.id)), ...vd.map((t) => t.id)];
  }, [sections, done, shown, doneShut]);
  const renderedCount = sections.reduce((n, g) => n + g.items.length, 0) + visibleDone.length;

  // Panel follows the task list without an effect: a vanished open task
  // resets its id during render (no cascading render pass).
  if (panelId && !tasks.some((t) => t.id === panelId)) setPanelId(null);
  const panelTask = panelId ? (tasks.find((t) => t.id === panelId) ?? null) : null;

  const toggleCollapse = (key: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const focusRow = (id: string | null) => {
    setActiveRow(id);
    if (id) rowRefs.current.get(id)?.focus();
  };

  const submitComposer = () => {
    const v = cTitle.trim();
    if (!v) return;
    onAdd(v, { desc: cDesc.trim() || undefined, due: cDue || undefined });
    setCTitle("");
    setCDesc("");
    // Due stays: serial entry usually shares the deadline.
    titleRef.current?.focus();
  };

  const openComposer = () => {
    if (!cOpen) setCOpen(true);
    else titleRef.current?.focus();
  };

  // `/` searches, `N` composes (guarded: never inside a field or dialog).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && !!t.closest && !!t.closest("input, textarea, select, [contenteditable]");
      const inModal = !!t && !!t.closest && !!t.closest(".g-modal");
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !inField && !inModal) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !inField && !inModal) {
        e.preventDefault();
        openComposer();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cOpen]);

  const dueChips = (prefix: string, value: string, onPick: (due: string) => void) => (
    <div className="t-duechips" role="group" aria-label={tr("duePick", lang)}>
      {(
        [
          ["today", tr("today", lang), today],
          ["tomorrow", tr("dueTomorrow", lang), addDaysISO(today, 1)],
          ["week", tr("dueWeek", lang), addDaysISO(today, 7)],
          ["none", tr("undated", lang), ""],
        ] as const
      ).map(([k, label, iso]) => (
        <button
          key={k}
          type="button"
          data-testid={`${prefix}-due-${k}`}
          className={"t-chip" + (value === iso ? " active" : "")}
          aria-pressed={value === iso}
          onClick={() => onPick(iso)}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        className="t-chip ghost"
        onClick={() => setCShowDate((v) => !v)}
      >
        {tr("duePick", lang)}
      </button>
    </div>
  );

  const titleOf = (id: string | undefined) => notes.find((n) => n.id === id)?.title;

  const renderRow = (t: TaskItem) => {
    const src = titleOf(t.noteId);
    const overdue = t.due !== undefined && t.due !== "" && t.due < today;
    return (
      <div
        key={t.id}
        ref={(el) => {
          if (el) rowRefs.current.set(t.id, el);
          else rowRefs.current.delete(t.id);
        }}
        className={"t-row g-taskline" + (t.done ? " done" : "") + (activeRow === t.id ? " active" : "")}
        data-testid="task-row"
        data-due={t.due ?? undefined}
        tabIndex={0}
        onClick={() => setPanelId(t.id)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const i = flatIds.indexOf(t.id);
            const next = flatIds[i + (e.key === "ArrowDown" ? 1 : -1)];
            if (next) focusRow(next);
            else if (e.key === "ArrowUp") searchRef.current?.focus();
          } else if (e.key === " ") {
            e.preventDefault();
            onToggle(t.id);
          } else if (e.key === "Enter") {
            e.preventDefault();
            setPanelId(t.id);
          } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onDelete(t.id);
          }
        }}
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touchX.current;
          touchX.current = null;
          if (start === null) return;
          const dx = (e.changedTouches[0]?.clientX ?? start) - start;
          if (dx <= -SWIPE_DEL_PX) onDelete(t.id);
        }}
      >
        <input
          type="checkbox"
          className="t-check"
          checked={t.done}
          onChange={() => onToggle(t.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={t.text}
        />
        <span className="t-main">
          <span className="t-text">{<Hi text={t.text} q={query} />}</span>
          {t.due && (
            <span className="g-due" title={t.due}>
              {fmtDue(t.due)}
              {overdue ? ` (${tr("overdueT", lang)})` : ""}
            </span>
          )}
          {t.noteId &&
            (src ? (
              <button
                type="button"
                className="g-src"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenNote(t.noteId as string);
                }}
              >
                {tr("fromSrc", lang)}: {src}
              </button>
            ) : (
              <span className="g-src gone">{tr("srcGone", lang)}</span>
            ))}
          {t.desc && <div className="g-tdesc">{t.desc}</div>}
        </span>
        <span className="t-menuwrap">
          <button
            type="button"
            data-testid="task-row-menu"
            className="t-menubtn"
            title={tr("menu", lang)}
            aria-label={tr("menu", lang)}
            aria-expanded={menuId === t.id}
            onClick={(e) => {
              e.stopPropagation();
              setMenuId((m) => (m === t.id ? null : t.id));
            }}
          >
            ⋯
          </button>
          {menuId === t.id && (
            <span className="t-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="t-menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuId(null);
                  setPanelId(t.id);
                }}
              >
                {tr("openBtn", lang)}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="task-menu-del"
                className="t-menuitem danger"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuId(null);
                  onDelete(t.id);
                }}
              >
                {tr("deleteNote", lang)}
              </button>
            </span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="g-page t-plan">
      <div className="t-main-col">
        <div
          className="g-addtask t-composer"
          data-testid="task-composer"
          onKeyDown={(e) => {
            if (e.key === "Escape") setCOpen(false);
          }}
        >
          {!cOpen ? (
            <button type="button" className="t-collapsed" onClick={() => setCOpen(true)}>
              {tr("addTaskPh", lang)}
            </button>
          ) : (
            <>
              <input
                ref={titleRef}
                autoFocus
                data-testid="task-composer-title"
                value={cTitle}
                onChange={(e) => setCTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitComposer();
                  }
                }}
                placeholder={tr("addTaskPh", lang)}
                aria-label="new task"
              />
              {!cShowDesc && (
                <button type="button" className="t-adddesc" onClick={() => setCShowDesc(true)}>
                  {tr("addDesc", lang)}
                </button>
              )}
              {cShowDesc && (
                <textarea
                  className="g-area"
                  value={cDesc}
                  onChange={(e) => setCDesc(e.target.value)}
                  placeholder={tr("descPh", lang)}
                  aria-label="description"
                  rows={2}
                />
              )}
              {dueChips("task", cDue, (iso) => setCDue(iso))}
              {cShowDate && (
                <input
                  type="date"
                  className="g-date"
                  value={cDue}
                  onChange={(e) => setCDue(e.target.value)}
                  aria-label="due date"
                />
              )}
              <button type="button" data-testid="task-add" className="g-btn primary t-add" onClick={submitComposer}>
                {tr("addTask", lang)}
              </button>
            </>
          )}
        </div>

        <div className="g-notes-tools">
          <input
            ref={searchRef}
            className="g-in"
            data-testid="task-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (flatIds[0]) focusRow(flatIds[0]);
              } else if (e.key === "Escape") {
                setQuery("");
              }
            }}
            placeholder={tr("taskSearchPh", lang)}
            aria-label="filter tasks"
          />
        </div>

        {tasks.length === 0 && (
          <div className="g-empty">
            <div className="g-empty-t">{tr("emptyTasksActive", lang)}</div>
            <button type="button" className="g-btn primary" onClick={openComposer}>
              {tr("addFirstTask", lang)}
            </button>
          </div>
        )}
        {tasks.length > 0 && filtered.length === 0 && (
          <div className="g-tpl-empty">
            <div className="muted">{tr("noResults", lang)}</div>
            <button type="button" className="g-btn sm" onClick={() => setQuery("")}>
              {tr("tplResetFilter", lang)}
            </button>
          </div>
        )}
        {filtered.length > 0 && (
          <div className="muted small">
            {tr("listShownOf", lang).replace("{x}", String(renderedCount)).replace("{y}", String(filtered.length))}
          </div>
        )}

        {sections.map((g) => (
          <section key={g.key} data-testid={`task-group-${g.key}`}>
            <button
              type="button"
              className="t-grouphead"
              aria-expanded={!collapsed.has(g.key) || !!needle}
              onClick={() => toggleCollapse(g.key)}
            >
              {groupTitle(g.key, g.total, lang)}
            </button>
            {g.items.map(renderRow)}
          </section>
        ))}
        {done.length > 0 && (
          <section data-testid="task-group-done">
            <button
              type="button"
              className="t-grouphead"
              aria-expanded={!doneShut}
              onClick={() => toggleCollapse("done")}
            >
              {groupTitle("done", done.length, lang)}
            </button>
            {visibleDone.map(renderRow)}
          </section>
        )}
        {renderedCount < filtered.length && (
          <button
            type="button"
            className="g-btn sm g-tpl-more"
            onClick={() => setShown((s) => s + TASKS_PAGE)}
          >
            {tr("tplShowMore", lang).replace("{n}", String(Math.min(TASKS_PAGE, filtered.length - renderedCount)))}
          </button>
        )}
      </div>

      {panelTask && (
        <div className="t-panelwrap">
          <div className="t-backdrop" onClick={() => setPanelId(null)} />
          <TaskPanel
            key={panelTask.id}
            lang={lang}
            task={panelTask}
            notes={notes}
            onUpdate={onUpdate}
            onDelete={(id) => {
              setPanelId(null);
              onDelete(id);
            }}
            onClose={() => setPanelId(null)}
            onOpenNote={onOpenNote}
            today={today}
          />
        </div>
      )}
    </div>
  );
}

/** Shared with the week view (S5): one panel component in both places. */
export function TaskPanel({
  lang,
  task,
  notes,
  onUpdate,
  onDelete,
  onClose,
  onOpenNote,
  today,
}: {
  lang: Lang;
  task: TaskItem;
  notes: Note[];
  onUpdate: (id: string, patch: { text?: string; desc?: string; due?: string }) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  today: string;
}) {
  // Drafts are per-task (key above): the panel is the only same-tab text
  // editor, so no sync effect is needed; cross-tab changes reload the page.
  const [title, setTitle] = useState(task.text);
  const [desc, setDesc] = useState(task.desc ?? "");
  const src = notes.find((n) => n.id === task.noteId)?.title;

  return (
    <aside
      className="t-panel"
      data-testid="task-panel"
      role="dialog"
      aria-label={task.text}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <button type="button" data-testid="task-panel-close" className="t-panel-x" aria-label={tr("closeBtn", lang)} onClick={onClose}>
        ×
      </button>
      <label className="t-field">
        <span className="muted small">{tr("addTaskPh", lang)}</span>
        <input
          data-testid="task-panel-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== task.text) onUpdate(task.id, { text: title.trim() });
            else setTitle(task.text);
          }}
          aria-label="title"
        />
      </label>
      <label className="t-field">
        <span className="muted small">{tr("descPh", lang)}</span>
        <textarea
          data-testid="task-panel-desc"
          className="g-area"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => {
            if (desc !== (task.desc ?? "")) onUpdate(task.id, { desc: desc || undefined });
          }}
          rows={3}
          aria-label="description"
        />
      </label>
      <div className="t-field">
        <span className="muted small">{tr("duePick", lang)}</span>
        <div className="t-duechips" role="group" aria-label={tr("duePick", lang)}>
          {(
            [
              ["today", tr("today", lang), today],
              ["tomorrow", tr("dueTomorrow", lang), addDaysISO(today, 1)],
              ["week", tr("dueWeek", lang), addDaysISO(today, 7)],
              ["none", tr("undated", lang), ""],
            ] as const
          ).map(([k, label, iso]) => (
            <button
              key={k}
              type="button"
              data-testid={`task-panel-due-${k}`}
              className={"t-chip" + ((task.due ?? "") === iso ? " active" : "")}
              aria-pressed={(task.due ?? "") === iso}
              onClick={() => onUpdate(task.id, { due: iso || undefined })}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="date"
          className="g-date"
          value={task.due ?? ""}
          onChange={(e) => onUpdate(task.id, { due: e.target.value || undefined })}
          aria-label="due date"
        />
      </div>
      {task.noteId && (
        <div className="t-field">
          <span className="muted small">{tr("noteTasksT", lang)}</span>
          {src ? (
            <button
              type="button"
              className="g-src"
              onClick={() => {
                onClose();
                onOpenNote(task.noteId as string);
              }}
            >
              {tr("fromSrc", lang)}: {src}
            </button>
          ) : (
            <span className="g-src gone">{tr("srcGone", lang)}</span>
          )}
        </div>
      )}
      <div className="t-pansep" role="separator" />
      <button
        type="button"
        data-testid="task-panel-delete"
        className="g-btn t-panel-del"
        onClick={() => onDelete(task.id)}
      >
        {tr("deleteNote", lang)}
      </button>
    </aside>
  );
}
