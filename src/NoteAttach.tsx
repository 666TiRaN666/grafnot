import { useMemo, useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { Note } from "./store";
import { Hi } from "./widgets";

function clampXY(x: number, y: number): { x: number; y: number } {
  const w = window.innerWidth || 1024;
  return { x: Math.max(8, Math.min(x, w - 300)), y: Math.max(8, y) };
}

/** «В заметку ▾» popup (search + 5 recent) plus the binding chip.
 * Shared by both workbenches (S7 text, S8 image). Side effects stay
 * with the caller: onPick appends + binds, onClear unbinds (with Undo). */
export function NoteAttach({
  lang,
  notes,
  bindingId,
  onPick,
  onClear,
  onOpenNote,
}: {
  lang: Lang;
  notes: Note[];
  bindingId: string | undefined;
  onPick: (id: string) => void;
  onClear: () => void;
  onOpenNote: (id: string) => void;
}) {
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const recent = useMemo(() => [...notes].sort((a, b) => b.updated - a.updated).slice(0, 5), [notes]);
  const rows = (() => {
    const needle = query.trim().toLowerCase();
    const all = needle ? notes.filter((n) => `${n.title} ${n.text}`.toLowerCase().includes(needle)) : recent;
    return all.slice(0, 6);
  })();
  const bound = bindingId ? notes.find((n) => n.id === bindingId) : undefined;

  return (
    <>
      <span className="n-morewrap">
        <button
          type="button"
          className="g-btn sm"
          aria-expanded={spot !== null}
          onClick={(e) => {
            if (spot) {
              setSpot(null);
              return;
            }
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const p = clampXY(r.left, r.bottom);
            setSpot({ x: p.x, y: p.y });
          }}
        >
          {tr("toNote", lang)} ▾
        </button>
      </span>
      {bindingId && (
        <div className="w-notechip">
          <button type="button" className="g-linkbtn" onClick={() => onOpenNote(bindingId)}>
            {tr("boundNoteT", lang)}: {bound?.title ?? bindingId.slice(-4)}
          </button>{" "}
          <button type="button" className="g-unlink" title={tr("unbindBtn", lang)} aria-label={tr("unbindBtn", lang)} onClick={onClear}>
            ×
          </button>
        </div>
      )}
      {spot && (
        <div
          className="n-suggest"
          role="listbox"
          style={{ left: spot.x, top: spot.y }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSpot(null);
              setQuery("");
            }
          }}
        >
          <input
            autoFocus
            autoComplete="off"
            className="g-in n-suggest-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("linkSearchPh", lang)}
            aria-label="find note"
          />
          {rows.map((n, ni) => (
            <button
              key={n.id}
              type="button"
              role="option"
              aria-selected={false}
              data-testid={`w-note-pick-${ni}`}
              className="n-suggestitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(n.id);
                setSpot(null);
                setQuery("");
              }}
            >
              <Hi text={n.title} q={query} />
            </button>
          ))}
          {rows.length === 0 && (
            <div className="muted small" style={{ padding: 8 }}>
              {tr("noResults", lang)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
