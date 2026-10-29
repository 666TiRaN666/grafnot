import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Lang } from './i18n';
import { tr } from './i18n';
import type { Graph, Note, PromptSave, TaskItem } from './store';
import type { NotesActions } from './NotesView';
import type { ContextTab } from './rolloutModel';
import { noteAccessibleName, noteDisplayName } from './noteName';

export function NoteContext({ lang, note, notes, graphs, tasks, prompts, actions, tab, onTab, pinned, canPin, onPin, onClose, onOpenNote, onOpenPlan, onOpenPrompt, onUnbind, onAddLink, onTask, onInsertPrompt, onShowMap, autoFocus }: {
  lang: Lang; note: Note; notes: Note[]; graphs: Graph[]; tasks: TaskItem[]; prompts: PromptSave[]; actions: NotesActions;
  tab: ContextTab; onTab: (tab: ContextTab) => void; pinned: boolean; canPin: boolean; onPin: () => void; onClose: () => void;
  onOpenNote: (id: string) => void; onOpenPlan: (id?: string) => void; onOpenPrompt: (id: string) => void; onUnbind: (id: string) => void;
  onAddLink: () => void; onTask: () => void; onInsertPrompt: () => void; onShowMap: () => void; autoFocus: boolean;
}) {
  const box = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(6);
  const tabs: { id: ContextTab; label: string }[] = [{ id: 'links', label: tr('linkedT', lang) }, { id: 'tasks', label: tr('noteTasksT', lang) }, { id: 'prompts', label: tr('promptsT', lang) }];
  const incoming = notes.filter(n => n.id !== note.id && n.linkedIds.includes(note.id));
  const outgoing = note.linkedIds.map(id => notes.find(n => n.id === id)).filter((n): n is Note => !!n);
  const broken = note.linkedIds.filter(id => !notes.some(n => n.id === id));
  const words = new Set(note.title.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const candidates = notes.filter(n => n.id !== note.id && !note.linkedIds.includes(n.id));
  const related = (n: Note) => graphs.some(g => g.noteIds.includes(note.id) && g.noteIds.includes(n.id)) || n.title.toLowerCase().split(/\s+/).some(w => words.has(w));
  const proposals = [...candidates.filter(related), ...candidates.filter(n => !related(n) && !n.linkedIds.length && !notes.some(x => x.linkedIds.includes(n.id)))];
  const noteTasks = tasks.filter(t => t.noteId === note.id);
  const notePrompts = prompts.filter(p => p.noteId === note.id);
  useLayoutEffect(() => {
    if (autoFocus) box.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && !pinned) {
        const items = Array.from(box.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]') ?? []);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose, pinned]);
  const label = (n: Note) => <span className={!n.title.trim() ? 'g-note-derived' : undefined}>{noteDisplayName(n, lang)}</span>;
  const open = (n: Note) => <button type="button" className="g-linkbtn" aria-label={noteAccessibleName(n, lang)} onClick={() => onOpenNote(n.id)}>{label(n)}</button>;
  const links = (items: Note[], incomingLinks = false) => <ul className="ctx-links">{items.map(n => <li key={n.id}>
    {incomingLinks && <span aria-label={tr('backlinksT', lang)}>← </span>}{open(n)}
    {!incomingLinks && <button type="button" className="g-unlink" aria-label={tr('unlinkTitle', lang)} onClick={() => actions.removeLink(note.id, n.id)}>×</button>}
  </li>)}</ul>;
  return <>
    {!pinned && <div className="ctx-scrim" aria-hidden="true" onPointerDown={onClose} />}
    <aside ref={box} data-testid="ctx-panel" className={'note-context ' + (pinned ? 'is-pinned' : 'is-temporary')} role={pinned ? 'complementary' : 'dialog'} aria-label={tr('ctxTitle', lang)}>
      <div className="ctx-heading">
        <span>{tr('ctxTitle', lang)}</span>
        <button type="button" className="g-btn sm ghost" data-testid="ctx-pin" disabled={!canPin} title={!canPin ? tr('ctxPinUnavailable', lang) : undefined} aria-pressed={pinned} onClick={onPin}>{pinned ? tr('ctxUnpin', lang) : tr('ctxPin', lang)}</button>
        <button type="button" className="g-modal-x" data-testid="ctx-close" aria-label={tr('closeBtn', lang)} onClick={onClose}>×</button>
      </div>
      <div className="n-tabs" data-testid="ctx-tabs" role="tablist" onKeyDown={e => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const at = tabs.findIndex(t => t.id === tab);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (at + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? 2 : 1)) % 3;
        const chosen = tabs[next];
        if (chosen) { onTab(chosen.id); box.current?.querySelector<HTMLButtonElement>('[data-testid="ctx-tab-' + chosen.id + '"]')?.focus(); }
      }}>
        {tabs.map(t => <button key={t.id} type="button" role="tab" id={'context-tab-' + t.id} data-testid={'ctx-tab-' + t.id} className={'n-tab' + (tab === t.id ? ' active' : '')} aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => onTab(t.id)}>{t.label}</button>)}
      </div>
      <div role="tabpanel" aria-labelledby={'context-tab-' + tab} className="ctx-content">
        {tab === 'links' && <>
          <div className="ctx-graphs"><span className="muted small">{tr('graphMembers', lang)}</span>
            {graphs.map(g => <button type="button" key={g.id} className="g-btn sm" aria-pressed={g.noteIds.includes(note.id)} onClick={() => actions.toggleMember(note.id, g.id)}>{g.title}</button>)}
            <button type="button" className="g-linkbtn" data-testid="ctx-panel-map" onClick={onShowMap}>{tr('ctxShowMap', lang)}</button>
          </div>
          <h3>{tr('linkedT', lang)} ({outgoing.length})</h3>
          {!outgoing.length && !incoming.length && <p className="muted">{tr('ctxNoLinks', lang)}</p>}
          {links(outgoing)}
          {!!incoming.length && <><h3>{tr('backlinksT', lang)} ({incoming.length})</h3>{links(incoming, true)}</>}
          {!!broken.length && <div className="muted small">{tr('brokenF', lang)}: {broken.map(id => <button key={id} type="button" className="g-linkbtn" onClick={() => actions.removeLink(note.id, id)}>× {id.slice(-4)}</button>)}</div>}
          <button type="button" className="g-btn sm" onClick={onAddLink}>{tr('addLinkBtn', lang)}</button>
          <h3>{tr('ctxSuggestions', lang)}</h3>
          <p className="muted small">{tr('similarT', lang)} · {tr('orphansT', lang)}</p>
          {proposals.length === 0 && <p className="muted small">{tr('similarEmpty', lang)}</p>}
          {proposals.slice(0, shown).map(n => <div className="g-sugg" key={n.id}>{open(n)}<button type="button" className="g-linkbtn" onClick={() => actions.addLink(note.id, n.id)}>{tr('linkQ', lang)}</button></div>)}
          {shown < proposals.length && <button type="button" className="g-btn sm" onClick={() => setShown(v => v + 6)}>{tr('tplShowMore', lang).replace('{n}', String(Math.min(6, proposals.length - shown)))}</button>}
        </>}
        {tab === 'tasks' && <>
          <h3>{tr('noteTasksT', lang)} ({noteTasks.length})</h3>
          {!noteTasks.length && <p className="muted">{tr('emptyNoteTasks', lang)}</p>}
          {noteTasks.map(t => <div className="g-sugg" key={t.id}>
            <label className={'g-undone' + (t.done ? ' done' : '')}><input type="checkbox" checked={t.done} onChange={() => actions.toggleTask(t.id)} /><span>{t.text}</span></label>
            <button type="button" className="g-linkbtn" onClick={() => onOpenPlan(t.id)}>{tr('openBtn', lang)}</button>
            <button type="button" className="g-linkbtn" onClick={() => actions.deleteTask(t.id)}>{tr('deleteNote', lang)}</button>
          </div>)}
          <button type="button" className="g-btn sm" onClick={onTask}>{tr('makeTask', lang)}</button>
        </>}
        {tab === 'prompts' && <>
          <h3>{tr('promptsT', lang)} ({notePrompts.length})</h3>
          {!notePrompts.length && <p className="muted">{tr('notePromptsEmpty', lang)}</p>}
          {notePrompts.map(p => <div className="g-sugg" key={p.id}><span>{p.title} <span className="g-kind">{p.kind}</span></span><span>
            <button type="button" className="g-linkbtn" onClick={() => onOpenPrompt(p.id)}>{tr('openBtn', lang)}</button>{' '}
            <button type="button" className="g-linkbtn" onClick={() => onUnbind(p.id)}>{tr('unbindBtn', lang)}</button>
          </span></div>)}
          <button type="button" className="g-btn sm primary" onClick={onInsertPrompt}>{tr('insertPrompt', lang)}</button>
          <button type="button" className="g-linkbtn" onClick={() => onOpenPrompt('')}>{tr('nav_prompt', lang)}</button>
        </>}
      </div>
    </aside>
  </>;
}
