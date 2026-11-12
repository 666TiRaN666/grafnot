import { useEffect, useRef, useState } from 'react';
import { tr } from './i18n';
import type { Lang } from './i18n';
import { noteAccessibleName, noteDisplayName } from './noteName';
import type { Note, TaskItem } from './store';
import { ConfirmDialog } from './ui/primitives';
import { pageShortcutAllowed } from './ui/pageKeys';
import { matchesQuery } from './textMatch';
import { parseTrashDays } from './prefs';
import type { TrashDays } from './prefs';

/** Trash as its own section (#/trash): deleted notes and tasks, restore or
 * delete forever. Deleting forever is the one confirmed action (N4). */
export function TrashPage({
  lang,
  trash,
  trashTasks,
  onRestoreNote,
  onRestoreTask,
  onPurgeNote,
  onPurgeTask,
  autoDays,
  onAutoDays,
}: {
  lang: Lang;
  /** Auto-cleanup period in days, 0 = off (per-profile pref). */
  autoDays: TrashDays;
  onAutoDays: (days: TrashDays) => void;
  trash: Note[];
  trashTasks: TaskItem[];
  onRestoreNote: (id: string) => void;
  onRestoreTask: (id: string) => void;
  onPurgeNote: (id: string) => void;
  onPurgeTask: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // `/` focuses the search, as in every other list.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && pageShortcutAllowed(e)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const [pending, setPending] = useState<{ kind: 'note' | 'task'; id: string; title: string } | null>(null);
  const notes = trash.filter((n) => matchesQuery([n.title, n.text], q));
  const tasks = trashTasks.filter((t) => matchesQuery([t.text, t.desc], q));
  const empty = trash.length === 0 && trashTasks.length === 0;

  return (
    <div className="g-page" data-testid="trash-page">
      <p className="muted">{tr('trashHint', lang)}</p>
      <label className="g-field t-autoclean">
        {tr('trashAutoLabel', lang)}
        <select className="g-in" data-testid="trash-autoclean" value={String(autoDays)} onChange={(e) => onAutoDays(parseTrashDays(e.target.value))}>
          <option value="0">{tr('trashAutoOff', lang)}</option>
          <option value="30">{tr('trashAuto30', lang)}</option>
          <option value="90">{tr('trashAuto90', lang)}</option>
        </select>
        {autoDays > 0 && <span className="muted small">{tr('trashAutoHint', lang)}</span>}
      </label>
      {!empty && (
        <div className="g-notes-tools">
          <input
            ref={searchRef}
            type="search"
            className="g-in"
            data-testid="trash-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr('trashSearchPh', lang)}
            aria-label={tr('trashSearchPh', lang)}
          />
        </div>
      )}
      {notes.length === 0 && tasks.length === 0 && <div className="muted">{tr('emptyTrash', lang)}</div>}
      {notes.length > 0 && <div className="g-card-t sub">{tr('notebooks', lang)}</div>}
      {notes.map((n) => (
        <div className="g-sugg" key={n.id}>
          <span className={!n.title.trim() ? 'g-note-derived' : undefined} title={noteAccessibleName(n, lang)}>{noteDisplayName(n, lang)}</span>
          <span>
            <button type="button" className="g-btn sm" onClick={() => onRestoreNote(n.id)}>
              {tr('restoreBtn', lang)}
            </button>{' '}
            <button type="button" className="g-btn sm ghost danger" onClick={() => setPending({ kind: 'note', id: n.id, title: noteDisplayName(n, lang) })}>
              {tr('delForever', lang)}
            </button>
          </span>
        </div>
      ))}
      {tasks.length > 0 && <div className="g-card-t sub">{tr('tasks', lang)}</div>}
      {tasks.map((t) => (
        <div className="g-sugg" key={t.id}>
          <span>{t.text}</span>
          <span>
            <button type="button" className="g-btn sm" onClick={() => onRestoreTask(t.id)}>
              {tr('restoreBtn', lang)}
            </button>{' '}
            <button type="button" className="g-btn sm ghost danger" onClick={() => setPending({ kind: 'task', id: t.id, title: t.text })}>
              {tr('delForever', lang)}
            </button>
          </span>
        </div>
      ))}
      {pending && (
        <ConfirmDialog
          title={tr('delForever', lang)}
          message={pending.title}
          confirmLabel={tr('confirmPurge', lang)}
          cancelLabel={tr('cancelBtn', lang)}
          danger
          onConfirm={() => {
            if (pending.kind === 'note') onPurgeNote(pending.id);
            else onPurgeTask(pending.id);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
