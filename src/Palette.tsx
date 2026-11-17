import { useState } from 'react';
import { tr } from './i18n';
import type { Lang } from './i18n';
import { filterPalette, suggestNotes } from './paletteModel';
import type { PaletteGroup, PaletteEntry } from './paletteModel';
import { useListNav } from './useListNav';

/** S2 Quick Add / command palette. Groups of 3-4 (notes, tasks, prompts,
 * commands); Enter runs the highlighted row, Esc closes. Labels come from
 * the caller (already translated), so no new i18n keys live here. */
export function Palette({
  lang,
  notes,
  tasks,
  prompts,
  commands,
  groupName,
  onPick,
  onClose,
}: {
  lang: Lang;
  notes: PaletteEntry[];
  tasks: PaletteEntry[];
  prompts: PaletteEntry[];
  commands: PaletteEntry[];
  groupName: (g: PaletteEntry['group']) => string;
  /** The query travels with the pick: a note opens at its first match. */
  onPick: (e: PaletteEntry, query: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [limits, setLimits] = useState<Partial<Record<PaletteGroup, number>>>({});
  const rows = filterPalette(q, notes, tasks, prompts, commands, limits);
  const all = filterPalette(q, notes, tasks, prompts, commands, { notes: Infinity, tasks: Infinity, prompts: Infinity, commands: Infinity });
  // HE-1 (Lab 7): an empty result is not a dead end — close notes ("Did you
  // mean") plus a create row for the typed text, all reachable by arrows/Enter.
  const query = q.trim();
  const miss = rows.length === 0 && query !== '';
  const suggested = miss ? suggestNotes(query, notes) : [];
  const createRow: PaletteEntry = { id: 'c-create-named', group: 'commands', title: tr('palCreateNamed', lang).replace('{q}', query), sub: '', cmd: 'new-note-named' };
  const shown = miss ? [...suggested, createRow] : rows;
  const nav = useListNav(shown.length, (i) => {
    const r = shown[i];
    if (r) onPick(r, q);
  });
  const item = (r: PaletteEntry, i: number) => (
    <button
      key={r.id}
      type="button"
      data-testid={`palette-item-${i}`}
      title={r.accessibleName ?? r.title}
      aria-label={r.accessibleName ? `${r.accessibleName} · ${r.sub}` : undefined}
      className={`s-pal-item${i === nav.active ? ' active' : ''}`}
      onMouseEnter={() => nav.setActive(i)}
      onClick={() => onPick(r, q)}
    >
      <span className="g-kind">{groupName(r.group)}</span>
      <span className={r.derived ? "g-note-derived" : undefined}>{r.title}</span>
      <span className="muted">{r.sub}</span>
    </button>
  );
  return (
    <div className="s-pal-back" onClick={onClose}>
      <div
        className="s-pal"
        role="dialog"
        aria-modal="true"
        data-testid="palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="s-pal-in"
          data-testid="palette-input"
          autoComplete="off"
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimits({});
            nav.reset();
          }}
          onKeyDown={nav.onKeyDown}
          placeholder={tr('search_ph', lang)}
          aria-label={tr('navSearch', lang)}
        />
        <div className="s-pal-list">
          {rows.length === 0 && !miss && <div className="muted">{tr('noResults', lang)}</div>}
          {miss && (
            <div className="s-pal-miss" data-testid="palette-miss" role="status">
              <p className="s-pal-miss-t">{tr('palNoResultsFor', lang).replace('{q}', query)}</p>
              {suggested.length > 0 && <p className="s-pal-miss-l">{tr('palDidYouMean', lang)}</p>}
            </div>
          )}
          {shown.map(item)}
          {miss && <p className="s-pal-miss-h muted" data-testid="palette-miss-hint">{tr('palSearchHint', lang)}</p>}
          {(['notes', 'tasks', 'prompts', 'commands'] as const).map(group => {
            const remaining = all.filter(r => r.group === group).length - rows.filter(r => r.group === group).length;
            return remaining > 0 ? <button type="button" key={group} className="g-btn sm s-pal-more" data-testid={'palette-more-' + group} onClick={() => setLimits(l => ({ ...l, [group]: (l[group] ?? 4) + 50 }))}>{groupName(group)} · {tr('tplShowMore', lang).replace('{n}', String(Math.min(50, remaining)))}</button> : null;
          })}
        </div>
      </div>
    </div>
  );
}
