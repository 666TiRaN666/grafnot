import { useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { Note } from "./store";
import { Hi } from "./widgets";
import { noteAccessibleName, noteDisplayName } from "./noteName";
import { useFitInViewport } from "./ui/useFitInViewport";
import { matchesQuery } from "./textMatch";
import { usePopover } from "./ui/dismiss";

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const shut = () => {
    setSpot(null);
    setQuery("");
  };
  // Outside press and Esc close, Esc and a pick give the focus back to the button (ui/dismiss).
  const { ref: popRef, close: closePop } = usePopover<HTMLDivElement>(spot !== null, shut, { trigger: triggerRef });
  // Opened near the bottom of a tablet it used to leave the screen.
  useFitInViewport(spot !== null, popRef);
  const recent = useMemo(() => [...notes].sort((a, b) => b.updated - a.updated).slice(0, 5), [notes]);
  const rows = (() => {
    const all = query.trim() ? notes.filter((n) => matchesQuery([n.title, n.text], query)) : recent;
    return all.slice(0, 6);
  })();
  const bound = bindingId ? notes.find((n) => n.id === bindingId) : undefined;

  return (
    <>
      <span className="n-morewrap">
        <button
          ref={triggerRef}
          type="button"
          className="g-btn sm"
          aria-expanded={spot !== null}
          onClick={(e) => {
            if (spot) {
              shut();
              return;
            }
            const r = e.currentTarget.getBoundingClientRect();
            setSpot({ x: r.left, y: r.bottom });
          }}
        >
          {tr("toNote", lang)} ▾
        </button>
      </span>
      {bindingId && (
        <div className="w-notechip">
          <button type="button" className="g-linkbtn" aria-label={bound ? `${tr("boundNoteT", lang)}: ${noteAccessibleName(bound, lang)}` : undefined} onClick={() => onOpenNote(bindingId)}>
            {tr("boundNoteT", lang)}: {bound ? <span className={!bound.title.trim() ? "g-note-derived" : undefined} title={noteAccessibleName(bound, lang)}>{noteDisplayName(bound, lang)}</span> : bindingId.slice(-4)}
          </button>{" "}
          <button type="button" className="g-unlink" title={tr("unbindBtn", lang)} aria-label={tr("unbindBtn", lang)} onClick={onClear}>
            ×
          </button>
        </div>
      )}
      {spot && (
        <div
          ref={popRef}
          className="n-suggest"
          role="listbox"
          style={{ left: spot.x, top: spot.y }}
        >
          <input
            autoFocus
            autoComplete="off"
            className="g-in n-suggest-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("linkSearchPh", lang)}
            aria-label={tr("linkSearchPh", lang)}
          />
          {rows.map((n, ni) => (
            <button
              key={n.id}
              type="button"
              role="option"
              aria-selected={false}
              data-testid={`w-note-pick-${ni}`}
              aria-label={noteAccessibleName(n, lang)}
              className="n-suggestitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(n.id);
                closePop();
              }}
            >
              <span className={!n.title.trim() ? "g-note-derived" : undefined} title={noteAccessibleName(n, lang)}><Hi text={noteDisplayName(n, lang)} q={query} /></span>
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
