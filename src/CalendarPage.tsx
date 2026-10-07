import { useRef, useState } from 'react';
import type { Lang } from './i18n';
import { tr } from './i18n';
import type { TaskItem } from './store';
import { fmtDue } from './widgets';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const mondayOf = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

export function CalendarPage({
  lang,
  tasks,
  onToggle,
  onAdd,
  onSetDue,
}: {
  lang: Lang;
  tasks: TaskItem[];
  onToggle: (id: string) => void;
  onAdd: (text: string, due?: string) => void;
  onSetDue: (id: string, due: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [text, setText] = useState('');
  const [due, setDue] = useState(() => toISO(new Date()));
  const addRef = useRef<HTMLInputElement>(null);

  const loc = lang === 'KZ' ? 'kk-KZ' : lang === 'EN' ? 'en-US' : 'ru-RU';
  const start = addDays(mondayOf(new Date()), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const todayISO = toISO(new Date());

  const byDue = new Map<string, TaskItem[]>();
  const undated: TaskItem[] = [];
  for (const t of tasks) {
    if (t.due && ISO.test(t.due)) {
      const arr = byDue.get(t.due) ?? [];
      arr.push(t);
      byDue.set(t.due, arr);
    } else {
      undated.push(t);
    }
  }

  const monthTitle = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(start);
  const wd = (d: Date) => new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(d);

  const submit = () => {
    const v = text.trim();
    if (!v || !due) return;
    onAdd(v, due);
    setText('');
  };

  return (
    <div className="g-page">
      <div className="g-page-h">
        <h2 className="g-h2" style={{ textTransform: 'capitalize' }}>
          {monthTitle}
        </h2>
        <div className="g-cal-nav">
          <button type="button" className="g-btn sm" onClick={() => setOffset((o) => o - 1)} aria-label="‹">
            ‹
          </button>
          <button type="button" className="g-btn sm" onClick={() => setOffset(0)}>
            {tr('today', lang)}
          </button>
          <button type="button" className="g-btn sm" onClick={() => setOffset((o) => o + 1)} aria-label="›">
            ›
          </button>
        </div>
      </div>

      <div className="g-addtask">
        <input
          ref={addRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder={tr('addTaskPh', lang)}
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
          {tr('addTask', lang)} · {fmtDue(due)}
        </button>
      </div>

      {tasks.length === 0 && (
        <div className="g-empty">
          <div className="g-empty-t">{tr('emptyTasksActive', lang)}</div>
          <button type="button" className="g-btn primary" onClick={() => addRef.current?.focus()}>
            {tr('addFirstTask', lang)}
          </button>
        </div>
      )}

      <div className="g-cal-scroll">
      <div className="g-cal-grid">
        {days.map((d) => {
          const iso = toISO(d);
          const list = byDue.get(iso) ?? [];
          return (
            <div key={iso} className={`g-day${iso === todayISO ? ' today' : ''}${iso === due ? ' sel' : ''}`}>
              <button type="button" className="g-day-head" onClick={() => setDue(iso)} title={iso}>
                <span>{wd(d)}</span>
                <strong>{d.getDate()}</strong>
              </button>
              {list.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`g-taskchip${t.done ? ' done' : ''}`}
                  onClick={() => onToggle(t.id)}
                  title={t.text}
                >
                  <span className="g-mini-check">{t.done ? '✓' : ''}</span>
                  <span>{t.text}</span>
                </button>
              ))}
              <button type="button" className="g-day-add" onClick={() => setDue(iso)} aria-label="+">
                +
              </button>
            </div>
          );
        })}
      </div>
      </div>

      {undated.length > 0 && (
        <div className="g-undated">
          <div className="g-card-t">{tr('undated', lang)}</div>
          {undated.map((t) => (
            <div className="g-sugg" key={t.id}>
              <label className={`g-undone${t.done ? ' done' : ''}`}>
                <input type="checkbox" checked={t.done} onChange={() => onToggle(t.id)} />
                <span>{t.text}</span>
              </label>
              <input
                type="date"
                className="g-date sm"
                value=""
                onChange={(e) => {
                  if (e.target.value) onSetDue(t.id, e.target.value);
                }}
                aria-label="due date"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
