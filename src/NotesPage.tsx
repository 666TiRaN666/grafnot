import type { Lang } from "./i18n";
import { tr } from "./i18n";
import { useCallback, useMemo } from "react";
import { useArmConfirm } from "./useArmConfirm";
import type { Note } from "./store";
import { Hi } from "./widgets";
import { PREVIEW_LEN } from "./promptUtils";
import { TPL_LIMITS } from "./listPrefs";
import { useListState } from "./useListState";

function fmtDate(u: number, lang: Lang): string {
  if (!u) return "";
  try {
    return new Date(u).toLocaleDateString(lang === "KZ" ? "kk-KZ" : lang === "EN" ? "en-US" : "ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function NotesPage({
  lang,
  notes,
  onOpen,
  onDelete,
  onNew,
  profileId,
}: {
  lang: Lang;
  notes: Note[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  profileId: string;
}) {
  const sorted = useMemo(() => [...notes].sort((a, b) => b.updated - a.updated), [notes]);
  // Row delete is two-step like every other × in the app: first click arms
  // (button turns into confirmDel), second executes. Trash keeps it reversible.
  const delConfirm = useArmConfirm();
  const select = useCallback(
    (q: string) => {
      const needle = q.trim().toLowerCase();
      return needle ? sorted.filter((n) => `${n.title} ${n.text}`.toLowerCase().includes(needle)) : sorted;
    },
    [sorted],
  );
  const list = useListState({
    key: "notes",
    profileId,
    select,
    onPick: (n) => onOpen(n.id),
  });

  if (notes.length === 0) {
    return (
      <div className="g-empty">
        <div className="g-empty-t">{tr("emptyHomeT", lang)}</div>
        <div className="g-empty-sub">{tr("emptyHomeSub", lang)}</div>
        <button type="button" className="g-btn primary" onClick={onNew}>
          {tr("createFirst", lang)}
        </button>
      </div>
    );
  }

  return (
    <div className="g-page">
      <div className="g-page-h">
        <h2 className="g-h2">
          {tr("notebooks", lang)} ({list.filtered.length})
        </h2>
        <button type="button" className="g-btn sm primary" onClick={onNew}>
          {tr("newNote", lang)}
        </button>
      </div>
      <div className="g-notes-tools">
        <input
          className="g-in"
          value={list.query}
          onChange={(e) => list.changeQuery(e.target.value)}
          onKeyDown={list.nav.onKeyDown}
          placeholder={tr("linkSearchPh", lang)}
          aria-label="filter"
        />
        <div className="g-seg" role="group" aria-label="limit">
          {TPL_LIMITS.map((n) => (
            <button
              key={n}
              type="button"
              className={"g-btn sm" + (list.limit === n ? " active" : "")}
              onClick={() => list.changeLimit(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      {list.filtered.length === 0 && (
        <div className="g-tpl-empty">
          <div className="muted">{tr("noResults", lang)}</div>
          <button type="button" className="g-btn sm" onClick={() => list.changeQuery("")}>
            {tr("tplResetFilter", lang)}
          </button>
        </div>
      )}
      {list.filtered.length > 0 && (
        <div className="muted small">
          {tr("listShownOf", lang).replace("{x}", String(list.visible.length)).replace("{y}", String(list.filtered.length))}
        </div>
      )}
      <div className="g-note-list">
        {list.visible.map((n, i) => (
          <div
            className={"g-noterow" + (i === list.nav.active ? " active" : "")}
            key={n.id}
            onMouseEnter={() => list.nav.setActive(i)}
          >
            <div style={{ minWidth: 0 }}>
              <button type="button" className="g-noteopen" onClick={() => onOpen(n.id)}>
                {<Hi text={n.title || tr("newNoteTitle", lang)} q={list.query} />}
              </button>
              {n.text.trim() && <div className="g-notesnippet">{<Hi text={n.text} q={list.query} max={PREVIEW_LEN} />}</div>}
              <div className="g-notemeta">
                {fmtDate(n.updated, lang)} · {tr("linkedT", lang)}: {n.linkedIds.length}
              </div>
            </div>
            <button
              type="button"
              className={"g-notedel" + (delConfirm.isArmed("n:" + n.id) ? " g-danger-arm" : "")}
              title={tr("deleteNote", lang)}
              onClick={() => {
                if (delConfirm.confirm("n:" + n.id)) onDelete(n.id);
              }}
            >
              {delConfirm.isArmed("n:" + n.id) ? tr("confirmTrash", lang) : "×"}
            </button>
          </div>
        ))}
        {list.shown < list.filtered.length && (
          <button
            type="button"
            className="g-btn sm g-tpl-more"
            onClick={() => list.showMore()}
          >
            {tr("tplShowMore", lang).replace("{n}", String(Math.min(list.limit, list.filtered.length - list.shown)))}
          </button>
        )}
      </div>
    </div>
  );
}
