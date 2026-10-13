import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { AIModel } from "./data";
import { TAG_DATA } from "./promptData";
import type { Note } from "./store";
import { Hi, copyText } from "./widgets";
import { prefKeyFor } from "./prefs";
import { renderPrompt } from "./promptUtils";
import { applyWeight, filterTags, moveTag, parseTagInput, stripWeight, tagWeight } from "./imageTags";
import { useListNav } from "./useListNav";
import { NoteAttach } from "./NoteAttach";

const MODELS: AIModel[] = ["Pony", "SDXL", "Flux"];
const SUGGEST_CAP = 8;
const RECENT_CAP = 7;
const DRAG_PX = 4;

function recentKey(profileId: string): string {
  return prefKeyFor("recentTags", profileId);
}

function loadRecent(profileId: string): string[] {
  try {
    const raw = window.localStorage.getItem(recentKey(profileId));
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, RECENT_CAP) : [];
  } catch {
    return [];
  }
}

export function PromptImageWb({
  lang,
  tplName,
  mine,
  notes,
  onSaveTpl,
  onAppendNote,
  onOpenNote,
  notify,
  notifyAction,
  profileId,
}: {
  lang: Lang;
  tplName: string;
  mine: boolean;
  notes: Note[];
  onSaveTpl: (d: { name: string; body: string; defaults: Record<string, string>; kind: "image" }) => void;
  onAppendNote: (noteId: string, text: string) => void;
  onOpenNote: (id: string) => void;
  notify: (msg: string) => void;
  notifyAction: (text: string, actionLabel: string, fn: () => void) => void;
  profileId: string;
}) {
  const [model, setModel] = useState<AIModel>("Pony");
  const [tokens, setTokens] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [menuIdx, setMenuIdx] = useState<number | null>(null);
  const [binding, setBinding] = useState<string | undefined>(undefined);
  const [recent, setRecent] = useState<string[]>(() => loadRecent(profileId));
  const drag = useRef<{ from: number; x0: number; y0: number; on: boolean } | null>(null);
  const chipRefs = useRef(new Map<number, HTMLDivElement>());

  const result = renderPrompt(model, tokens);
  const sugg = useMemo(() => filterTags(TAG_DATA, input).slice(0, SUGGEST_CAP), [input]);

  const remember = (raw: string) => {
    const clean = stripWeight(raw);
    if (!clean) return;
    setRecent((r) => {
      const next = [clean, ...r.filter((x) => x !== clean)].slice(0, RECENT_CAP);
      try {
        window.localStorage.setItem(recentKey(profileId), JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const addToken = (raw: string) => {
    const v = raw.trim();
    if (!v || tokens.some((t) => stripWeight(t).toLowerCase() === stripWeight(v).toLowerCase())) {
      setInput("");
      return;
    }
    setTokens((p) => [...p, v]);
    remember(v);
    setInput("");
  };

  const nav = useListNav(sugg.length, (i) => {
    const hit = sugg[i];
    if (hit) addToken(hit.tag);
  });

  const commitInput = () => {
    const typed = parseTagInput(input);
    const list = typed.length > 0 ? typed : [input.trim()].filter((s) => s.length > 0);
    const fresh: string[] = [];
    for (const part of list) {
      const known = [...tokens, ...fresh].some((t) => stripWeight(t).toLowerCase() === stripWeight(part).toLowerCase());
      if (!known) fresh.push(part);
    }
    if (fresh.length > 0) {
      setTokens((p) => [...p, ...fresh]);
      fresh.forEach(remember);
    }
    setInput("");
    nav.reset();
  };

  const removeToken = (i: number) => {
    const victim = tokens[i];
    if (victim === undefined) return;
    setTokens((p) => p.filter((_, j) => j !== i));
    setMenuIdx(null);
    notifyAction(tr("promptDeleted", lang), tr("undoToast", lang), () =>
      setTokens((p) => {
        const next = [...p];
        next.splice(Math.min(i, next.length), 0, victim);
        return next;
      }),
    );
  };

  const moveChip = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= tokens.length) return;
    setTokens((p) => moveTag(p, i, j));
    requestAnimationFrame(() => chipRefs.current.get(j)?.focus());
  };

  // Pointer drag between chips (keyboard path: Alt+arrows on a chip).
  useEffect(() => {
    const dayAt = (x: number, y: number): number | null => {
      const el = document.elementFromPoint(x, y);
      const hit = el?.closest?.("[data-tag-idx]");
      if (!hit) return null;
      const n = Number(hit.getAttribute("data-tag-idx"));
      return Number.isFinite(n) ? n : null;
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.on && Math.max(Math.abs(e.clientX - d.x0), Math.abs(e.clientY - d.y0)) > DRAG_PX) d.on = true;
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d?.on) return;
      const to = dayAt(e.clientX, e.clientY);
      if (to !== null && to !== d.from) {
        const from = d.from;
        setTokens((p) => moveTag(p, from, to));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const pickNote = (id: string) => {
    onAppendNote(id, result);
    setBinding(id);
  };
  const clearBinding = () => {
    const prev = binding;
    if (!prev) return;
    setBinding(undefined);
    notifyAction(tr("toastUnlinked", lang), tr("undoToast", lang), () => setBinding(prev));
  };

  const saveName = `${tokens.slice(0, 2).join(", ") || "prompt"} (${model})`;

  return (
    <div className="w-work" data-testid="prompt-workbench">
      <div className="w-whead">
        <div className="w-wtitle-wrap">
          <div className="w-wtitle">{tplName}</div>
          <span className="pl-badges">
            <span className="pl-badge">{tr("badgeImg", lang)}</span>
            <span className="pl-badge">{mine ? tr("orgMine", lang) : tr("orgBuiltin", lang)}</span>
          </span>
        </div>
      </div>

      <div className="w-cols">
        <div className="w-form">
          <div className="t-duechips" role="group" aria-label={tr("modelL", lang)}>
            {MODELS.map((m) => (
              <button
                key={m}
                type="button"
                className={"t-chip" + (model === m ? " active" : "")}
                aria-pressed={model === m}
                onClick={() => setModel(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <input
            autoFocus
            data-testid="tag-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              nav.reset();
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (sugg.length > 0) {
                  e.preventDefault();
                  nav.onKeyDown(e);
                }
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                if (sugg.length > 0 && input.trim()) {
                  e.preventDefault();
                  const hit = sugg[nav.active] ?? sugg[0];
                  if (hit) addToken(hit.tag);
                  nav.reset();
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitInput();
                }
                return;
              }
              if (e.key === "," && input.trim()) {
                e.preventDefault();
                commitInput();
                return;
              }
              if (e.key === "Escape") {
                setInput("");
                nav.reset();
                return;
              }
              if (e.key === "Backspace" && !input && tokens.length > 0) {
                e.preventDefault();
                removeToken(tokens.length - 1);
              }
            }}
            placeholder={tr("typeToFilter", lang)}
            aria-label="tag input"
          />
          {input.trim() && sugg.length > 0 && (
            <div className="t-suggest" role="listbox" data-testid="tag-suggest">
              {sugg.map((t, i) => {
                const st = t.perModel[model];
                return (
                  <button
                    key={t.tag}
                    type="button"
                    role="option"
                    aria-selected={i === nav.active}
                    data-testid={`tag-suggest-item-${i}`}
                    className={"t-suggestitem" + (i === nav.active ? " active" : "")}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => nav.setActive(i)}
                    onClick={() => {
                      addToken(t.tag);
                      nav.reset();
                    }}
                  >
                    <Hi text={t.tag} q={input} />
                    <span className="t-risk" title={`${st.samples}`}>
                      {st.rate < 50 ? "⚠" : "●"} {st.rate}%
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="t-chips">
            {tokens.map((t, i) => (
              <div
                key={`${t}#${i}`}
                ref={(el) => {
                  if (el) chipRefs.current.set(i, el);
                  else chipRefs.current.delete(i);
                }}
                className="t-tagchip"
                data-testid="tag-chip"
                data-tag-idx={i}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                    e.preventDefault();
                    moveChip(i, e.key === "ArrowLeft" ? -1 : 1);
                  }
                }}
                onPointerDown={(e) => {
                  if (e.pointerType === "mouse" && e.button !== 0) return;
                  if ((e.target as HTMLElement).closest?.("button")) return;
                  drag.current = { from: i, x0: e.clientX, y0: e.clientY, on: false };
                }}
              >
                <span className="t-tagtext">{t}</span>
                <button
                  type="button"
                  className="t-tagmenu"
                  title={tr("menu", lang)}
                  aria-label={tr("menu", lang)}
                  aria-expanded={menuIdx === i}
                  onClick={() => setMenuIdx((m) => (m === i ? null : i))}
                >
                  ⋯
                </button>
                <button
                  type="button"
                  className="t-tagx"
                  title={`${tr("deleteNote", lang)} ${stripWeight(t)}`}
                  aria-label={`${tr("deleteNote", lang)} ${stripWeight(t)}`}
                  onClick={() => removeToken(i)}
                >
                  ×
                </button>
                {menuIdx === i && (
                  <span className="t-menu" role="menu">
                    {(["low", "normal", "high"] as const).map((w) => (
                      <button
                        key={w}
                        type="button"
                        role="menuitemradio"
                        aria-checked={tagWeight(t) === w}
                        className="t-menuitem"
                        onClick={() => {
                          setTokens((p) => p.map((x, j) => (j === i ? applyWeight(x, w) : x)));
                          setMenuIdx(null);
                        }}
                      >
                        {w === "low" ? tr("tagWLow", lang) : w === "high" ? tr("tagWHigh", lang) : tr("tagWNrm", lang)}
                      </button>
                    ))}
                    <button
                      type="button"
                      role="menuitem"
                      className="t-menuitem danger"
                      onClick={() => removeToken(i)}
                    >
                      {tr("deleteNote", lang)}
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
          {recent.length > 0 && (
            <div className="t-recent" data-testid="tag-recent">
              <span className="muted small">{tr("tagRecent", lang)}:</span>{" "}
              {recent.map((t) => (
                <button key={t} type="button" className="t-chip sm" onClick={() => addToken(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="w-result">
          <div className="w-prev mono" data-testid="prompt-result">
            {result || "—"}
          </div>
          <div className="muted small">
            {result.length} {tr("charsT", lang)}
          </div>
          <button type="button" data-testid="copy-prompt" className="g-btn primary w-copy" onClick={async () => { await copyText(result); notify(tr("toastCopied", lang)); }}>
            {tr("copyPrompt", lang)}
          </button>
          <div className="w-result-row">
            <button
              type="button"
              className="g-btn sm"
              onClick={() =>
                onSaveTpl({ name: saveName, body: result, defaults: {}, kind: "image" })
              }
            >
              {tr("saveAsTpl", lang)}
            </button>
            <NoteAttach
              lang={lang}
              notes={notes}
              bindingId={binding}
              onPick={pickNote}
              onClear={clearBinding}
              onOpenNote={onOpenNote}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
