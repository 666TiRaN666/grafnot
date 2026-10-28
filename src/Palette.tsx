import { useState } from 'react';
import { tr } from './i18n';
import type { Lang } from './i18n';
import { filterPalette } from './paletteModel';
import type { PaletteEntry } from './paletteModel';
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
  onPick: (e: PaletteEntry) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const rows = filterPalette(q, notes, tasks, prompts, commands);
  const nav = useListNav(rows.length, (i) => {
    const r = rows[i];
    if (r) onPick(r);
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
              className={`s-pal-item${i === nav.active ? ' active' : ''}`}
              onMouseEnter={() => nav.setActive(i)}
              onClick={() => onPick(r)}
            >
              <span className="g-kind">{groupName(r.group)}</span>
              <span>{r.title}</span>
              <span className="muted">{r.sub}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
