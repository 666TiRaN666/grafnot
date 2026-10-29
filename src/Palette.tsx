import { useState } from 'react';
import { tr } from './i18n';
import type { Lang } from './i18n';
import { filterPalette } from './paletteModel';
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
  const nav = useListNav(rows.length, (i) => {
    const r = rows[i];
    if (r) onPick(r, q);
  });
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
          aria-label="search"
        />
        <div className="s-pal-list">
          {rows.length === 0 && <div className="muted">{tr('noResults', lang)}</div>}
          {rows.map((r, i) => (
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
          ))}
          {(['notes', 'tasks', 'prompts', 'commands'] as const).map(group => {
            const remaining = all.filter(r => r.group === group).length - rows.filter(r => r.group === group).length;
            return remaining > 0 ? <button type="button" key={group} className="g-btn sm s-pal-more" data-testid={'palette-more-' + group} onClick={() => setLimits(l => ({ ...l, [group]: (l[group] ?? 4) + 50 }))}>{groupName(group)} · {tr('tplShowMore', lang).replace('{n}', String(Math.min(50, remaining)))}</button> : null;
          })}
        </div>
      </div>
    </div>
  );
}
