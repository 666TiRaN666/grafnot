import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { Note, TaskItem } from "./store";
import { Hi, Icon, MenuButton } from "./widgets";
import { noteAccessibleName, noteDisplayName } from "./noteName";
import { groupTasks, pageTaskGroups } from "./taskGroups";
import { addDaysISO, fmtDue, todayISO } from "./isoDate";
import type { TaskGroupKey } from "./taskGroups";
import { pageShortcutAllowed } from "./ui/pageKeys";
import { matchesQuery } from "./textMatch";

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
  openId = null,
  onLeaveOpen, createRequest = 0,
  viewSwitch,
}: {
  lang: Lang;
  tasks: TaskItem[];
  notes: Note[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (text: string, opts?: { desc?: string; due?: string }) => void;
  onUpdate: (id: string, patch: { text?: string; desc?: string; due?: string }) => void;
  onOpenNote: (id: string) => void;
  /** Task from the route (#/plan/list/<id>): opened, revealed and highlighted. */
  openId?: string | null;
  /** The panel left `openId` (closed or switched): the route drops the id. */
  onLeaveOpen?: () => void;
  createRequest?: number;
  /** «List | Week» switch: the first item of the page toolbar. */
  viewSwitch?: ReactNode;
}) {
  const today = todayISO();
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(TASKS_PAGE);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["done"]));
  const [, setActiveRow] = useState<string | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
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

  /** Non-empty search: groups open and paging spans the matches. */
  const needle = query.trim();
  const filtered = useMemo(() => (needle ? tasks.filter((t) => matchesQuery([t.text, t.desc], needle)) : tasks), [tasks, needle]);
  const { active, done } = useMemo(() => groupTasks(filtered, today), [filtered, today]);
  // One budget across the expanded groups (Done included); collapsed groups
  // keep their headers and counts and are not paged (taskGroups.ts).
  const page = useMemo(() => pageTaskGroups(active, done, collapsed, !!needle, shown), [active, done, collapsed, needle, shown]);
  const sections = page.sections;
  const doneShut = collapsed.has("done") && !needle;
  const visibleDone = page.done;
  const flatIds = useMemo(() => [...page.sections.flatMap((g) => g.items.map((t) => t.id)), ...page.done.map((t) => t.id)], [page]);
  const renderedCount = page.rendered;

  // Panel follows the task list without an effect: a vanished open task
  // resets its id during render (no cascading render pass).
  if (panelId && !tasks.some((t) => t.id === panelId)) setPanelId(null);
  const panelTask = panelId ? (tasks.find((t) => t.id === panelId) ?? null) : null;

  // A routed task is revealed the same way (during render, no effect): its
  // group expands, a hiding filter clears and the batch grows to reach it.
  const [seenOpenId, setSeenOpenId] = useState<string | null>(null);
  if (openId !== seenOpenId) {
    setSeenOpenId(openId);
    const target = openId ? tasks.find((t) => t.id === openId) : undefined;
    if (target) {
      const keepQuery = !needle || matchesQuery([target.text, target.desc], needle);
      if (!keepQuery) setQuery("");
      const g = groupTasks(keepQuery ? filtered : tasks, today);
      const key = target.done ? "done" : (g.active.find((x) => x.items.includes(target))?.key ?? "done");
      const nextCollapsed = new Set(collapsed);
      nextCollapsed.delete(key);
      setCollapsed(nextCollapsed);
      let idx = g.done.indexOf(target);
      if (!target.done) {
        idx = 0;
        for (const x of g.active) {
          if (x.key === key) {
            idx += x.items.indexOf(target);
            break;
          }
          if (!nextCollapsed.has(x.key) || (keepQuery && needle)) idx += x.items.length;
        }
      }
      setShown((s) => Math.max(s, idx + 1));
      setPanelId(target.id);
      setActiveRow(target.id);
    }
  }
  useEffect(() => {
    if (openId) rowRefs.current.get(openId)?.scrollIntoView({ block: "center" });
  }, [openId]);

  const showPanel = (id: string | null) => {
    setPanelId(id);
    if (openId && id !== openId) onLeaveOpen?.();
  };

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
    // Each task starts without a due date: a kept one silently landed on the next task (focus group).
    setCDue("");
    titleRef.current?.focus();
  };

  const openComposer = () => {
    setCOpen(true);
    titleRef.current?.focus();
  };

  useEffect(() => { if (createRequest) openComposer(); /* same entry as N */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest]);

  // `/` searches, `N` composes (guarded: never inside a field or dialog).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!pageShortcutAllowed(e)) return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if ((e.key === "n" || e.code === "KeyN") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
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
      <button type="button" className="t-chip ghost" aria-expanded={cShowDate} onClick={() => setCShowDate((v) => !v)}>
        {tr("duePick", lang)}
      </button>
    </div>
  );

  const noteOf = (id: string | undefined) => notes.find((n) => n.id === id);

  /** Due chip by state (colour is never the only cue: overdue also says so). */
  const dueChip = (t: TaskItem) => {
    if (!t.due) return null;
    const overdue = !t.done && t.due < today;
    const soon = !t.done && (t.due === today || t.due === addDaysISO(today, 1));
    return (
      <span className={"g-due" + (overdue ? " overdue" : soon ? " soon" : "")} title={t.due}>
        {fmtDue(t.due)}
        {overdue ? ` · ${tr("overdueT", lang)}` : ""}
      </span>
    );
  };

  const renderRow = (t: TaskItem) => {
    const sourceNote = noteOf(t.noteId);
    const src = sourceNote ? noteDisplayName(sourceNote, lang) : undefined;
    const open = panelId === t.id;
    return (
      <div
        key={t.id}
        ref={(el) => {
          if (el) rowRefs.current.set(t.id, el);
          else rowRefs.current.delete(t.id);
        }}
        className={"t-row g-taskline" + (t.done ? " done" : "") + (open ? " active" : "")}
        data-testid="task-row"
        data-due={t.due ?? undefined}
        role="group"
        aria-label={t.text}
        aria-current={open ? "true" : undefined}
        tabIndex={0}
        onFocus={() => setActiveRow(t.id)}
        onClick={() => showPanel(t.id)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
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
            showPanel(t.id);
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
        {/* The whole 36 px square toggles; the row itself opens details. */}
        <label className="t-checkhit" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" className="t-check" checked={t.done} onChange={() => onToggle(t.id)} aria-label={t.text} />
        </label>
        <span className="t-main">
          <span className="t-text">{<Hi text={t.text} q={query} />}</span>
          {t.desc && <span className="g-tdesc">{t.desc}</span>}
        </span>
        <span className="t-meta">
          {t.noteId &&
            (src ? (
              <button
                type="button"
                className={"g-src" + (sourceNote && !sourceNote.title.trim() ? " g-note-derived" : "")}
                aria-label={sourceNote ? `${tr("fromSrc", lang)}: ${noteAccessibleName(sourceNote, lang)}` : undefined}
                title={src}
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
          {dueChip(t)}
        </span>
        <MenuButton
          testid="task-row-menu"
          className="t-menubtn"
          align="right"
          ariaLabel={tr("taskActionsA", lang).replace("{t}", t.text)}
          items={[
            { key: "open", label: tr("openBtn", lang), run: () => showPanel(t.id) },
            { key: "del", testid: "task-menu-del", label: tr("deleteNote", lang), run: () => onDelete(t.id), danger: true, group: true },
          ]}
        >
          ⋯
        </MenuButton>
      </div>
    );
  };

  const groupHead = (key: TaskGroupKey | "done", total: number, open: boolean) => (
    <button type="button" className={"t-grouphead" + (key === "overdue" ? " warn" : "")} aria-expanded={open} onClick={() => toggleCollapse(key)}>
      <span className="t-chev" aria-hidden="true">
        <Icon n="chevR" size={14} />
      </span>
      {groupTitle(key, total, lang)}
    </button>
  );

  const keepOpen = (e: React.FocusEvent<HTMLDivElement>) => {
    // The options stay while focus is inside the composer or a draft exists.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    if (!cTitle.trim() && !cDesc.trim()) setCOpen(false);
  };

  return (
    <div className="g-page t-plan">
      <div className="t-main-col">
        <div className="p-toolbar">
          {viewSwitch}
          <label className="p-search">
            <Icon n="search" size={16} />
            <input
              ref={searchRef}
              data-testid="task-search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (flatIds[0]) focusRow(flatIds[0]);
                } else if (e.key === "Escape" && query) {
                  e.preventDefault();
                  setQuery("");
                }
              }}
              placeholder={tr("taskSearchPh", lang)}
              aria-label={tr("taskSearchPh", lang)}
            />
            {!query && <kbd className="g-kbd" aria-hidden="true">/</kbd>}
          </label>
        </div>

        <div
          className={"t-quickadd" + (cOpen ? " open" : "")}
          data-testid="task-composer"
          onBlur={keepOpen}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setCOpen(false);
              titleRef.current?.blur();
            }
          }}
        >
          <div className="t-qa-row">
            <span className="t-qa-plus" aria-hidden="true">
              <Icon n="plus" size={18} />
            </span>
            <input
              ref={titleRef}
              data-testid="task-composer-title"
              autoComplete="off"
              value={cTitle}
              onFocus={() => setCOpen(true)}
              onChange={(e) => setCTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submitComposer();
                }
              }}
              placeholder={tr("quickAddPh", lang)}
              aria-label={tr("quickAddL", lang)}
              aria-keyshortcuts="Enter"
            />
            {cTitle.trim() && <span className="t-qa-hint" aria-hidden="true">{tr("quickAddEnter", lang)}</span>}
            {cOpen && (
              // An empty name never becomes a task: the button waits for text (Enter does too).
              <button type="button" data-testid="task-add" className="g-btn sm primary t-add" disabled={!cTitle.trim()} onClick={submitComposer}>
                {tr("addTask", lang)}
              </button>
            )}
          </div>
          {cOpen && (
            <div className="t-qa-opts">
              {dueChips("task", cDue, (iso) => setCDue(iso))}
              {cShowDate && (
                <input type="date" className="g-date" value={cDue} onChange={(e) => setCDue(e.target.value)} aria-label={tr("dueDateA", lang)} />
              )}
              {!cShowDesc ? (
                <button type="button" className="t-adddesc" onClick={() => setCShowDesc(true)}>
                  {tr("addDesc", lang)}
                </button>
              ) : (
                <textarea className="g-area" value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder={tr("descPh", lang)} aria-label={tr("descPh", lang)} rows={2} />
              )}
            </div>
          )}
        </div>

        {tasks.length === 0 && (
          <div className="t-empty" data-testid="plan-empty">
            <p className="t-empty-t">{tr("planEmptyT", lang)}</p>
            <p className="t-empty-b">{tr("planEmptyB", lang)}</p>
            <p className="t-empty-k">
              <kbd className="g-kbd">N</kbd> {tr("planEmptyKey", lang)}
            </p>
          </div>
        )}
        {tasks.length > 0 && filtered.length === 0 && (
          <div className="t-empty" data-testid="plan-noresults">
            <p className="t-empty-t">{tr("noResults", lang)}</p>
            <button type="button" className="g-btn sm" onClick={() => setQuery("")}>
              {tr("tplResetFilter", lang)}
            </button>
          </div>
        )}
        {tasks.length > 0 && active.length === 0 && done.length > 0 && !needle && <p className="t-allclear">{tr("planAllDone", lang)}</p>}

        {sections.map((g) => (
          <section key={g.key} className="t-group" data-testid={`task-group-${g.key}`}>
            {groupHead(g.key, g.total, !collapsed.has(g.key) || !!needle)}
            {g.items.map(renderRow)}
          </section>
        ))}
        {done.length > 0 && (
          <section className="t-group" data-testid="task-group-done">
            {groupHead("done", done.length, !doneShut)}
            {visibleDone.map(renderRow)}
          </section>
        )}
        {renderedCount < page.open && (
          <div className="t-more">
            <span className="muted small" aria-live="polite">
              {tr("listShownOf", lang).replace("{x}", String(renderedCount)).replace("{y}", String(page.open))}
            </span>
            <button type="button" className="g-btn sm g-tpl-more" data-testid="tasks-more" onClick={() => setShown((s) => s + TASKS_PAGE)}>
              {tr("tplShowMore", lang).replace("{n}", String(Math.min(TASKS_PAGE, page.open - renderedCount)))}
            </button>
          </div>
        )}
      </div>

      {panelTask && (
        <div className="t-panelwrap">
          <div className="t-backdrop" onClick={() => showPanel(null)} />
          <TaskPanel
            key={panelTask.id}
            lang={lang}
            task={panelTask}
            notes={notes}
            onUpdate={onUpdate}
            onDelete={(id) => {
              showPanel(null);
              onDelete(id);
            }}
            onClose={() => showPanel(null)}
            onOpenNote={onOpenNote}
            today={today}
            focusTitle={panelTask.id === openId}
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
  focusTitle = false,
}: {
  lang: Lang;
  task: TaskItem;
  notes: Note[];
  onUpdate: (id: string, patch: { text?: string; desc?: string; due?: string }) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  today: string;
  /** Routed opens (palette, deep link) put focus in the panel: Esc closes it. */
  focusTitle?: boolean;
}) {
  // Drafts are per-task (key above): the panel is the only same-tab text
  // editor, so no sync effect is needed; cross-tab changes reload the page.
  const [title, setTitle] = useState(task.text);
  const [desc, setDesc] = useState(task.desc ?? "");
  const sourceNote = notes.find((n) => n.id === task.noteId);
  const src = sourceNote ? noteDisplayName(sourceNote, lang) : undefined;

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
        <span className="muted small">{tr("taskNameL", lang)}</span>
        <input
          data-testid="task-panel-title"
          autoFocus={focusTitle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== task.text) onUpdate(task.id, { text: title.trim() });
            else setTitle(task.text);
          }}
          aria-label={tr("taskNameL", lang)}
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
          aria-label={tr("descPh", lang)}
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
          aria-label={tr("dueDateA", lang)}
        />
      </div>
      {task.noteId && (
        <div className="t-field">
          <span className="muted small">{tr("taskSourceL", lang)}</span>
          {src ? (
            <button
              type="button"
              className={"g-src" + (sourceNote && !sourceNote.title.trim() ? " g-note-derived" : "")}
                aria-label={sourceNote ? `${tr("fromSrc", lang)}: ${noteAccessibleName(sourceNote, lang)}` : undefined}
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
