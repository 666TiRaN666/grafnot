import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { LlmTpl } from "./data";
import { LLM_TEMPLATES } from "./data";
import { DATASET_VERSION, TAG_DATA } from "./promptData";
import type { PromptSave } from "./store";
import { Hi } from "./widgets";
import { useListState } from "./useListState";
import { prefKeyFor } from "./prefs";
import { buildLibrary, filterLibrary } from "./promptLibrary";
import type { LibSeg } from "./promptLibrary";

const LIB_PAGE = 50;

function loadDensity(profileId: string): boolean {
  try {
    return window.localStorage.getItem(prefKeyFor("density", profileId)) === "1";
  } catch {
    return false;
  }
}

export function PromptLib({
  lang,
  customTpls,
  saves,
  selectedId,
  onSelect,
  onRenameSave,
  onCreate,
  profileId,
}: {
  lang: Lang;
  customTpls: LlmTpl[];
  saves: PromptSave[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRenameSave: (id: string, title: string) => void;
  onCreate: () => void;
  profileId: string;
}) {
  const [seg, setSeg] = useState<LibSeg>("all");
  const [compact, setCompact] = useState(() => loadDensity(profileId));
  const [moreOpen, setMoreOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const entries = useMemo(() => buildLibrary(LLM_TEMPLATES, customTpls, saves), [customTpls, saves]);
  const select = useCallback((q: string) => filterLibrary(entries, q, seg), [entries, seg]);
  const list = useListState({ key: "prompts", profileId, select, limit: LIB_PAGE, onPick: (e) => onSelect(e.id) });
  const saveCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of saves) {
      if (p.templateId) m.set(p.templateId, (m.get(p.templateId) ?? 0) + 1);
    }
    return m;
  }, [saves]);

  const toggleDensity = () => {
    setCompact((c) => {
      try {
        window.localStorage.setItem(prefKeyFor("density", profileId), c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
    setMoreOpen(false);
  };

  // `/` focuses the library search (same guards as notes/tasks lists).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && !!t.closest && !!t.closest("input, textarea, select, [contenteditable]");
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !inField && !(e.target as HTMLElement)?.closest?.(".g-modal")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const segs: { id: LibSeg; label: string }[] = [
    { id: "all", label: tr("tplFAll", lang) },
    { id: "image", label: tr("tplFImg", lang) },
    { id: "text", label: tr("segTxt", lang) },
    { id: "mine", label: tr("tplFMine", lang) },
    { id: "recent", label: tr("segRecent", lang) },
  ];

  const loc = lang === "KZ" ? "kk-KZ" : lang === "EN" ? "en-US" : "ru-RU";
  const fmtDate = (ts: number) => {
    try {
      return new Date(ts).toLocaleDateString(loc, { day: "2-digit", month: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div className={"p-lib" + (compact ? " compact" : "")} data-testid="prompt-library">
      <div className="p-lib-head">
        <span className="p-lib-title">
          {tr("libT", lang)} ({list.filtered.length})
        </span>
        <button type="button" className="g-btn sm primary" onClick={onCreate}>
          {tr("newTpl", lang)}
        </button>
        <span className="n-morewrap">
          <button
            type="button"
            className="g-btn sm ghost"
            title={tr("menu", lang)}
            aria-label={tr("menu", lang)}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
          >
            ⋯
          </button>
          {moreOpen && (
            <span className="n-menu" role="menu">
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={compact}
                className="n-menuitem"
                onClick={toggleDensity}
              >
                {tr("densT", lang)}: {compact ? tr("densCompact", lang) : tr("densComfy", lang)}
              </button>
            </span>
          )}
        </span>
      </div>
      <input
        ref={searchRef}
        className="g-in"
        data-testid="prompt-search"
        autoComplete="off"
        value={list.query}
        onChange={(e) => list.changeQuery(e.target.value)}
        onKeyDown={list.nav.onKeyDown}
        placeholder={tr("tplSearchPh", lang)}
        aria-label="library search"
      />
      <div className="p-segs" role="group" aria-label="library filter">
        {segs.map((s) => (
          <button
            key={s.id}
            type="button"
            className={"t-chip" + (seg === s.id ? " active" : "")}
            aria-pressed={seg === s.id}
            onClick={() => {
              setSeg(s.id);
              list.resetShown();
              list.resetNavigation();
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <div className="p-lib-empty">
          <button type="button" className="g-btn primary p-lib-cta" onClick={onCreate}>
            {tr("libEmptyImg", lang)}
          </button>
          <button type="button" className="g-btn p-lib-cta" onClick={onCreate}>
            {tr("libEmptyTxt", lang)}
          </button>
        </div>
      ) : (
        <>
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
          <div className="muted small">
            {tr("dsStatic", lang)} {DATASET_VERSION} · {TAG_DATA.length} {tr("dsTags", lang)}
          </div>
          <div className="p-rows">
            {list.visible.map((e) =>
              renamingId === e.id ? (
                <div key={e.id} className="pl-row renaming" data-testid="prompt-item">
                  <span className="pl-ico" aria-hidden="true">
                    {e.type === "image" ? "🎨" : "💬"}
                  </span>
                  <input
                    autoFocus
                    className="pl-rename-in"
                    value={renameDraft}
                    onChange={(ev) => setRenameDraft(ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") {
                        const v = renameDraft.trim();
                        if (v) onRenameSave(e.id, v);
                        setRenamingId(null);
                      }
                      if (ev.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => {
                      const v = renameDraft.trim();
                      if (v) onRenameSave(e.id, v);
                      setRenamingId(null);
                    }}
                    aria-label={tr("renameGo", lang)}
                  />
                </div>
              ) : (
                <button
                  key={e.id}
                  type="button"
                  className={"pl-row" + (e.id === selectedId ? " active" : "")}
                  data-testid="prompt-item"
                  aria-current={e.id === selectedId}
                  onClick={() => onSelect(e.id)}
                >
                  <span className="pl-ico" aria-hidden="true">
                    {e.type === "image" ? "🎨" : "💬"}
                  </span>
                  <span className="pl-body">
                    <span className="pl-title">{<Hi text={e.title} q={list.query} />}</span>
                    <span className="pl-snip">{<Hi text={e.snippet} q={list.query} />}</span>
                  </span>
                  {e.origin === "save" && (
                    <button
                      type="button"
                      data-testid="prompt-rename"
                      className="pl-rename"
                      title={tr("renameGo", lang)}
                      aria-label={tr("renameGo", lang)}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setRenameDraft(e.title);
                        setRenamingId(e.id);
                      }}
                    >
                      ✎
                    </button>
                  )}
                  <span className="pl-badges">
                    <span className="pl-badge">{e.type === "image" ? tr("badgeImg", lang) : tr("segTxt", lang)}</span>
                    <span className="pl-badge">
                      {e.origin === "builtin" ? tr("orgBuiltin", lang) : e.origin === "custom" ? tr("orgMine", lang) : tr("orgSaved", lang)}
                    </span>
                    {e.origin !== "save" && (saveCount.get(e.id) ?? 0) > 0 && (
                      <span className="pl-meta">· {saveCount.get(e.id)}</span>
                    )}
                    {e.origin === "save" && e.ts > 0 && <span className="pl-meta">{fmtDate(e.ts)}</span>}
                  </span>
                </button>
              ),
            )}
            {list.shown < list.filtered.length && (
              <button type="button" className="g-btn sm g-tpl-more" onClick={() => list.showMore()}>
                {tr("tplShowMore", lang).replace("{n}", String(Math.min(LIB_PAGE, list.filtered.length - list.shown)))}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
