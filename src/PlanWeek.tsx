import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { Note, TaskItem } from "./store";
import { todayISO } from "./taskGroups";
import { weekRange } from "./weekCal";
import { TaskPanel } from "./PlanList";
import { useMedia } from "./ui/useMedia";

/** Pointer travel that turns a press into a drag (S10 map uses the same). */
const DRAG_PX = 4;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function clampXY(x: number, y: number): { x: number; y: number } {
  const w = window.innerWidth || 1024;
  const h = window.innerHeight || 768;
  return { x: Math.max(8, Math.min(x, w - 300)), y: Math.max(8, Math.min(y, h - 320)) };
}

export function PlanWeek({
  lang,
  tasks,
  notes,
  onToggle,
  onMove,
  onAdd,
  onUpdate,
  onDelete,
  onOpenNote,
}: {
  lang: Lang;
  tasks: TaskItem[];
  notes: Note[];
  onToggle: (id: string) => void;
  onMove: (id: string, due?: string) => void;
  onAdd: (text: string, opts?: { desc?: string; due?: string }) => void;
  onUpdate: (id: string, patch: { text?: string; desc?: string; due?: string }) => void;
  onDelete: (id: string) => void;
  onOpenNote: (id: string) => void;
}) {
  const today = todayISO();
  const [offset, setOffset] = useState(0);
  const [popup, setPopup] = useState<{ iso: string; x: number; y: number } | null>(null);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [mDayState, setMDayState] = useState<string | null>(null);
  const [mTab, setMTab] = useState<"day" | "inbox">("day");
  const drag = useRef<{ id: string; x0: number; y0: number; on: boolean } | null>(null);
  const suppressClick = useRef(false);
  const touchX = useRef<number | null>(null);
  // Mobile agenda and desktop grid never share the DOM: duplicate testids
  // and hidden chips would otherwise poison selectors and hit-testing.
  const narrow = useMedia("(max-width: 760px)");

  const loc = lang === "KZ" ? "kk-KZ" : lang === "EN" ? "en-US" : "ru-RU";
  const days = useMemo(() => weekRange(offset, today), [offset, today]);
  const mDay = mDayState && days.includes(mDayState) ? mDayState : days.includes(today) ? today : (days[0] ?? today);

  const byDue = useMemo(() => {
    const m = new Map<string, TaskItem[]>();
    for (const t of tasks) {
      if (t.due && ISO.test(t.due)) {
        const arr = m.get(t.due) ?? [];
        arr.push(t);
        m.set(t.due, arr);
      }
    }
    return m;
  }, [tasks]);
  const inbox = useMemo(() => tasks.filter((t) => !(t.due && ISO.test(t.due))), [tasks]);

  if (panelId && !tasks.some((t) => t.id === panelId)) setPanelId(null);
  const panelTask = panelId ? (tasks.find((t) => t.id === panelId) ?? null) : null;

  const monthTitle = useMemo(() => {
    const [y, m, d] = days[0]?.split("-").map(Number) ?? [2026, 1, 1];
    return new Intl.DateTimeFormat(loc, { month: "long", year: "numeric" }).format(new Date(y, (m || 1) - 1, d || 1));
  }, [days, loc]);
  const wd = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat(loc, { weekday: "short" }).format(new Date(y, (m || 1) - 1, d || 1));
  };
  const dayNum = (iso: string) => Number(iso.split("-")[2]);
  const openAt = (iso: string, x: number, y: number) => {
    const p = clampXY(x, y + 8);
    setPopup({ iso, x: p.x, y: p.y });
  };

  // ‹/›/T travel the weeks (never inside a field or dialog).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && !!t.closest && !!t.closest("input, textarea, select, [contenteditable]");
      const inModal = !!t && !!t.closest && !!t.closest(".g-modal");
      if (inField || inModal || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setOffset((o) => o - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setOffset((o) => o + 1);
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setOffset(0);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Pointer drag: window-level move/up so fast drags never lose the gesture.
  useEffect(() => {
    const dayAt = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y);
      const hit = el?.closest?.("[data-day]");
      return hit ? (hit.getAttribute("data-day") as string | null) : null;
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.on && Math.max(Math.abs(e.clientX - d.x0), Math.abs(e.clientY - d.y0)) > DRAG_PX) {
        d.on = true;
      }
      if (d.on) setDropDay(dayAt(e.clientX, e.clientY));
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      setDropDay(null);
      if (!d?.on) return;
      suppressClick.current = true;
      const iso = dayAt(e.clientX, e.clientY);
      if (iso !== null) onMove(d.id, iso === "" ? undefined : iso);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderChip = (t: TaskItem) => (
    <span key={t.id} className="w-chipwrap" data-day={t.due && ISO.test(t.due) ? t.due : ""}>
      <input
        type="checkbox"
        className="w-chipcheck"
        checked={t.done}
        onChange={() => onToggle(t.id)}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={t.text}
      />
      <button
        type="button"
        className={`g-taskchip${t.done ? " done" : ""}`}
        title={t.text}
        onPointerDown={(e) => {
          suppressClick.current = false;
          if (e.pointerType === "mouse" && e.button !== 0) return;
          drag.current = { id: t.id, x0: e.clientX, y0: e.clientY, on: false };
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          setPanelId(t.id);
        }}
      >
        <span className="w-chiptext">{t.text}</span>
      </button>
    </span>
  );

  return (
    <div className="g-page w-week" data-testid="plan-week">
      <div className="g-page-h">
        <h2 className="g-h2 w-month">{monthTitle}</h2>
        <div className="g-cal-nav">
          <button type="button" className="g-btn sm" onClick={() => setOffset((o) => o - 1)} aria-label="‹">
            ‹
          </button>
          <button type="button" className="g-btn sm" onClick={() => setOffset(0)}>
            {tr("today", lang)}
          </button>
          <button type="button" className="g-btn sm" onClick={() => setOffset((o) => o + 1)} aria-label="›">
            ›
          </button>
        </div>
      </div>

      {tasks.length === 0 && (
        <div className="g-empty">
          <div className="g-empty-t">{tr("emptyTasksActive", lang)}</div>
          <button type="button" className="g-btn primary" onClick={() => openAt(today, window.innerWidth / 2, 200)}>
            {tr("addFirstTask", lang)}
          </button>
        </div>
      )}

      {!narrow ? (
      <div className="w-grid">
        <section className={"w-inbox" + (dropDay === "" ? " drop" : "")} data-testid="week-inbox" data-day="">
          <div className="t-grouphead">{tr("inboxT", lang)} ({inbox.length})</div>
          <div className="w-inbox-list">{inbox.map(renderChip)}</div>
        </section>
        {days.map((iso) => (
          <div
            key={iso}
            className={`w-day g-day${iso === today ? " today" : ""}${dropDay === iso ? " drop" : ""}`}
            data-testid={`day-cell-${iso}`}
            data-day={iso}
            onClick={(e) => {
              const hit = (e.target as HTMLElement).closest?.(".g-taskchip, .w-chipcheck, .g-day-head, .w-add");
              if (!hit) openAt(iso, e.clientX, e.clientY);
            }}
          >
            <button type="button" className="g-day-head" title={iso} onClick={(e) => { e.stopPropagation(); openAt(iso, e.clientX, e.clientY); }}>
              <span>{wd(iso)}</span>
              <strong>{dayNum(iso)}</strong>
            </button>
            {(byDue.get(iso) ?? []).map(renderChip)}
            <span className="w-spacer" />
            <button
              type="button"
              className="w-add"
              data-testid={`day-add-${iso}`}
              onClick={(e) => {
                e.stopPropagation();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                openAt(iso, r.left, r.bottom);
              }}
            >
              + {tr("addTask", lang)}
            </button>
          </div>
        ))}
      </div>
      ) : (
      <div className="w-mobile">
        <div className="g-seg" role="group" aria-label="week view">
          {(["day", "inbox"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={"g-btn sm" + (mTab === v ? " active" : "")}
              onClick={() => setMTab(v)}
            >
              {v === "day" ? wd(mDay) : tr("inboxT", lang)}
            </button>
          ))}
        </div>
        {mTab === "day" ? (
          <>
            <div className="w-mstrip" role="group" aria-label="days">
              {days.map((iso) => (
                <button
                  key={iso}
                  type="button"
                  className={"w-mday" + (iso === mDay ? " active" : "") + (iso === today ? " today" : "")}
                  onClick={() => setMDayState(iso)}
                >
                  <span>{wd(iso)}</span>
                  <strong>{dayNum(iso)}</strong>
                </button>
              ))}
            </div>
            <div
              className="w-agenda"
              onTouchStart={(e) => {
                touchX.current = e.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(e) => {
                const start = touchX.current;
                touchX.current = null;
                if (start === null) return;
                const dx = (e.changedTouches[0]?.clientX ?? start) - start;
                const i = days.indexOf(mDay);
                if (dx <= -SWIPE_DAY_PX && i < days.length - 1) setMDayState(days[i + 1] as string);
                else if (dx >= SWIPE_DAY_PX && i > 0) setMDayState(days[i - 1] as string);
              }}
            >
              {(byDue.get(mDay) ?? []).map(renderChip)}
              <button type="button" className="w-add" data-testid={`day-add-${mDay}`} onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                openAt(mDay, r.left, r.bottom);
              }}>
                + {tr("addTask", lang)}
              </button>
            </div>
          </>
        ) : (
          <div className="w-agenda">{inbox.map(renderChip)}</div>
        )}
      </div>
      )}

      {popup && (
        <DayPopup
          key={popup.iso}
          lang={lang}
          x={popup.x}
          y={popup.y}
          title={(() => {
            const [y, m, d] = popup.iso.split("-").map(Number);
            const s = new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric" }).format(new Date(y, (m || 1) - 1, d || 1));
            return `${tr("dayTaskT", lang)} · ${s}`;
          })()}
          onAdd={(text, desc) => onAdd(text, { desc: desc || undefined, due: popup.iso })}
          onClose={() => setPopup(null)}
        />
      )}

      {panelTask && (
        <div className="w-panelwrap">
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

const SWIPE_DAY_PX = 48;

function DayPopup({
  lang,
  x,
  y,
  title,
  onAdd,
  onClose,
}: {
  lang: Lang;
  x: number;
  y: number;
  title: string;
  onAdd: (text: string, desc: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [showDesc, setShowDesc] = useState(false);
  const submit = () => {
    const v = name.trim();
    if (!v) return;
    onAdd(v, desc.trim());
    setName("");
    setDesc("");
  };
  return (
    <div
      className="w-popup"
      data-testid="day-popup"
      role="dialog"
      aria-label={title}
      style={{ left: x, top: y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="w-popup-t">{title}</div>
      <input
        autoFocus
        data-testid="day-popup-title"
        autoComplete="off"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={tr("addTaskPh", lang)}
        aria-label="new task"
      />
      {!showDesc && (
        <button type="button" className="t-adddesc" onClick={() => setShowDesc(true)}>
          {tr("addDesc", lang)}
        </button>
      )}
      {showDesc && (
        <textarea
          className="g-area"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={tr("descPh", lang)}
          aria-label="description"
          rows={2}
        />
      )}
      <div className="w-popup-actions">
        <button type="button" data-testid="day-popup-add" className="g-btn primary sm" onClick={submit}>
          {tr("addTask", lang)}
        </button>
        <button type="button" className="g-btn sm" onClick={onClose}>
          {tr("cancelBtn", lang)}
        </button>
      </div>
    </div>
  );
}
