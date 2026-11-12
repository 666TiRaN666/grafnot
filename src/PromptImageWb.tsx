import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { AIModel, AspectId, TagCat } from "./data";
import { NEGATIVE_PRESET, TAG_DATA } from "./promptData";
import type { Note } from "./store";
import { Hi, MenuPopup, copyText } from "./widgets";
import { prefKeyFor } from "./prefs";
import { filterTags, formatWeight, hasWeights, moveTag, parseTagInput, stepWeight, stripWeight, tagWeight, weightValue } from "./imageTags";
import { ASPECT_IDS, CAT_ORDER, catOf, moveInLane, orderTokens, renderImage } from "./imageModel";
import { estimateTokens } from "./skillModel";
import { useListNav } from "./useListNav";
import { NoteAttach } from "./NoteAttach";

const MODELS: AIModel[] = ["Pony", "SDXL", "Flux", "Midjourney"];
const SUGGEST_CAP = 8;
const RECENT_CAP = 7;
const DRAG_PX = 4;

function catLabel(c: TagCat, lang: Lang): string {
  switch (c) {
    case "quality": return tr("catQuality", lang);
    case "subject": return tr("catSubject", lang);
    case "look": return tr("catLook", lang);
    case "outfit": return tr("catOutfit", lang);
    case "pose": return tr("catPose", lang);
    case "scene": return tr("catScene", lang);
    case "light": return tr("catLight", lang);
    case "style": return tr("catStyle", lang);
    case "camera": return tr("catCamera", lang);
    default: return tr("catOther", lang);
  }
}

function modelHint(m: AIModel, lang: Lang): string {
  return m === "Pony" ? tr("modelHintPony", lang) : m === "SDXL" ? tr("modelHintSdxl", lang) : m === "Flux" ? tr("modelHintFlux", lang) : tr("modelHintMj", lang);
}

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

const sameTag = (a: string, b: string) => stripWeight(a).toLowerCase() === stripWeight(b).toLowerCase();

export interface ImageTplDraft {
  name: string;
  body: string;
  defaults: Record<string, string>;
  kind: "image";
  model: AIModel;
  tokens: string[];
  negative: string[];
  aspect: AspectId;
  ponyScore: boolean;
  tagCats: Record<string, TagCat>;
}

/** Image prompt constructor: tags sorted into lanes in the order a model
 * reads them, a negative prompt, the frame, and per-model syntax. Unlike a
 * text template there are no free-form fields: the prompt is composed. */
export function PromptImageWb({
  lang,
  tplName,
  initModel,
  initTokens,
  initNegative,
  initAspect,
  initPonyScore,
  initTagCats,
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
  /** UX-03: the template's constructor state (stored or parsed, see imageInit). */
  initModel: AIModel;
  initTokens: string[];
  initNegative: string[];
  initAspect: AspectId;
  initPonyScore: boolean;
  initTagCats: Record<string, TagCat>;
  mine: boolean;
  notes: Note[];
  onSaveTpl: (d: ImageTplDraft) => void;
  onAppendNote: (noteId: string, text: string) => void;
  onOpenNote: (id: string) => void;
  notify: (msg: string) => void;
  notifyAction: (text: string, actionLabel: string, fn: () => void) => void;
  profileId: string;
}) {
  const [model, setModel] = useState<AIModel>(initModel);
  const [tagCats, setTagCats] = useState<Record<string, TagCat>>(initTagCats);
  const [tokens, setTokensRaw] = useState<string[]>(() => orderTokens(initTokens, initTagCats));
  const [negative, setNegative] = useState<string[]>(initNegative);
  const [aspect, setAspect] = useState<AspectId>(initAspect);
  const [ponyScore, setPonyScore] = useState(initPonyScore);
  const [saveAs, setSaveAs] = useState("");
  const [input, setInput] = useState("");
  const [negInput, setNegInput] = useState("");
  const [binding, setBinding] = useState<string | undefined>(undefined);
  const [recent, setRecent] = useState<string[]>(() => loadRecent(profileId));
  const drag = useRef<{ from: number; x0: number; y0: number; on: boolean } | null>(null);
  const chipRefs = useRef(new Map<number, HTMLDivElement>());
  // Lane choices for handlers outside React's render (drag listeners).
  const catsRef = useRef(tagCats);
  useEffect(() => {
    catsRef.current = tagCats;
  }, [tagCats]);

  // Tokens are always kept in lane order: what you see is what gets copied.
  const setTokens = (fn: (p: string[]) => string[], cats = catsRef.current) => setTokensRaw((p) => orderTokens(fn(p), cats));

  const r = renderImage({ model, tokens, negative, aspect, ponyScore, tagCats });
  const sugg = useMemo(() => filterTags(TAG_DATA, input).slice(0, SUGGEST_CAP), [input]);

  const remember = (raw: string) => {
    const clean = stripWeight(raw);
    if (!clean) return;
    setRecent((cur) => {
      const next = [clean, ...cur.filter((x) => x !== clean)].slice(0, RECENT_CAP);
      try {
        window.localStorage.setItem(recentKey(profileId), JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const addTokens = (list: string[]) => {
    const fresh: string[] = [];
    for (const v of list.map((s) => s.trim()).filter(Boolean)) {
      if (![...tokens, ...fresh].some((t) => sameTag(t, v))) fresh.push(v);
    }
    if (fresh.length) {
      setTokens((p) => [...p, ...fresh]);
      fresh.forEach(remember);
    }
    setInput("");
  };

  const nav = useListNav(sugg.length, (i) => {
    const hit = sugg[i];
    if (hit) addTokens([hit.tag]);
  });

  const commitInput = () => {
    const typed = parseTagInput(input);
    addTokens(typed.length > 0 ? typed : [input]);
    nav.reset();
  };

  const removeToken = (i: number) => {
    const victim = tokens[i];
    if (victim === undefined) return;
    setTokens((p) => p.filter((_, j) => j !== i));
    notifyAction(tr("promptDeleted", lang), tr("undoToast", lang), () => setTokens((p) => [...p, victim]));
  };

  const setCat = (i: number, cat: TagCat) => {
    const tok = tokens[i];
    if (tok === undefined) return;
    const next = { ...tagCats, [stripWeight(tok).toLowerCase()]: cat };
    setTagCats(next);
    setTokens((p) => p, next);
  };

  const moveChip = (i: number, dir: -1 | 1) => {
    const next = moveInLane(tokens, i, dir, tagCats);
    if (next === tokens) return;
    setTokensRaw(next);
    const moved = tokens[i];
    const j = next.findIndex((t, k) => t === moved && k !== i);
    requestAnimationFrame(() => chipRefs.current.get(j >= 0 ? j : i)?.focus());
  };

  // Pointer drag between chips; a drop on another lane moves the tag there.
  useEffect(() => {
    const idxAt = (x: number, y: number): number | null => {
      const hit = document.elementFromPoint(x, y)?.closest?.("[data-tag-idx]");
      if (!hit) return null;
      const n = Number(hit.getAttribute("data-tag-idx"));
      return Number.isFinite(n) ? n : null;
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (d && !d.on && Math.max(Math.abs(e.clientX - d.x0), Math.abs(e.clientY - d.y0)) > DRAG_PX) d.on = true;
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d?.on) return;
      const to = idxAt(e.clientX, e.clientY);
      if (to === null || to === d.from) return;
      setTokensRaw((p) => {
        const from = p[d.from], target = p[to];
        if (from === undefined || target === undefined) return p;
        const cats = catsRef.current;
        const lane = catOf(target, cats);
        const nextCats = catOf(from, cats) === lane ? cats : { ...cats, [stripWeight(from).toLowerCase()]: lane };
        if (nextCats !== cats) setTagCats(nextCats);
        return orderTokens(moveTag(p, d.from, to), nextCats);
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const addNegative = (list: string[]) => {
    const fresh = list.map((s) => s.trim()).filter((v) => v && !negative.some((t) => sameTag(t, v)));
    if (fresh.length) setNegative((p) => [...p, ...fresh.filter((v, i) => fresh.indexOf(v) === i)]);
    setNegInput("");
  };
  const removeNegative = (i: number) => {
    const victim = negative[i];
    if (victim === undefined) return;
    setNegative((p) => p.filter((_, j) => j !== i));
    notifyAction(tr("promptDeleted", lang), tr("undoToast", lang), () => setNegative((p) => [...p, victim]));
  };

  const full = r.negative ? `${r.positive}\nNegative prompt: ${r.negative}` : r.positive;
  const pickNote = (id: string) => {
    onAppendNote(id, full);
    setBinding(id);
  };
  const clearBinding = () => {
    const prev = binding;
    if (!prev) return;
    setBinding(undefined);
    notifyAction(tr("toastUnlinked", lang), tr("undoToast", lang), () => setBinding(prev));
  };

  const saveName = `${tokens.slice(0, 2).map((t) => stripWeight(t)).join(", ") || "prompt"} (${model})`;
  const draft = (): ImageTplDraft => ({ name: saveAs.trim() || saveName, body: r.positive, defaults: {}, kind: "image", model, tokens: [...tokens], negative: [...negative], aspect, ponyScore, tagCats });

  // Changes are kept only by "Save as template": leaving with edits offers
  // that save instead of dropping them silently (focus group).
  const [initSnap] = useState(() => JSON.stringify({ model: initModel, tokens: orderTokens(initTokens, initTagCats), negative: initNegative, aspect: initAspect, ponyScore: initPonyScore, tagCats: initTagCats }));
  const dirty = JSON.stringify({ model, tokens, negative, aspect, ponyScore, tagCats }) !== initSnap;
  const leave = useRef<{ dirty: boolean; saved: boolean; draft: () => ImageTplDraft }>({ dirty: false, saved: false, draft });
  useEffect(() => {
    leave.current.dirty = dirty;
    leave.current.draft = draft;
  });
  useEffect(() => {
    const l = leave.current;
    return () => {
      if (l.dirty && !l.saved) {
        const d = l.draft();
        notifyAction(tr("imgUnsavedToast", lang), tr("saveAsTpl", lang), () => onSaveTpl(d));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saveTpl = () => {
    leave.current.saved = true;
    onSaveTpl(draft());
  };
  const copy = async (text: string) => {
    await copyText(text);
    notify(tr("toastCopied", lang));
  };

  const lanes = CAT_ORDER.map((cat) => ({ cat, items: tokens.map((t, i) => ({ t, i })).filter(({ t }) => catOf(t, tagCats) === cat) })).filter((l) => l.items.length > 0);

  return (
    <div className="w-work i-work" data-testid="prompt-workbench">
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
        <div className="w-form i-form">
          <div className="i-sec">
            <div className="i-sec-h">{tr("modelL", lang)}</div>
            <div className="t-duechips" role="group" aria-label={tr("modelL", lang)}>
              {MODELS.map((m) => (
                <button key={m} type="button" className={"t-chip" + (model === m ? " active" : "")} aria-pressed={model === m} onClick={() => setModel(m)}>
                  {m}
                </button>
              ))}
            </div>
            <p className="muted small i-hint" data-testid="model-hint">{modelHint(model, lang)}</p>
            {model === "Pony" && (
              <label className="g-undone i-opt">
                <input type="checkbox" data-testid="pony-score" checked={ponyScore} onChange={(e) => setPonyScore(e.target.checked)} />
                <span>{tr("ponyScoreL", lang)} <code className="mono">score_9, score_8_up…</code></span>
              </label>
            )}
          </div>

          <div className="i-sec">
            <div className="i-sec-h">{tr("frameL", lang)}</div>
            <div className="i-aspects" role="group" aria-label={tr("frameL", lang)}>
              {ASPECT_IDS.map((a) => {
                const [w, h] = a.split(":").map(Number);
                return (
                  <button key={a} type="button" data-testid={`aspect-${a}`} className={"i-aspect" + (aspect === a ? " active" : "")} aria-pressed={aspect === a} onClick={() => setAspect(a)}>
                    <span className="i-frame" style={{ aspectRatio: `${w} / ${h}` }} aria-hidden="true" />
                    <span>{a}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="i-sec">
            <div className="i-sec-h">{tr("tagsL", lang)}</div>
            <div className="i-inwrap">
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
                      if (hit) addTokens([hit.tag]);
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
                aria-label={tr("tagInputA", lang)}
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
                          addTokens([t.tag]);
                          nav.reset();
                        }}
                      >
                        <Hi text={t.tag} q={input} />
                        <span className="i-catbadge">{catLabel(t.cat, lang)}</span>
                        {st && (
                          <span className="t-risk" title={`${st.samples}`}>
                            {st.rate < 50 ? "⚠" : "●"} {st.rate}% · {tr("tagSampleRate", lang)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {lanes.length === 0 && <p className="muted small">{tr("tagsEmpty", lang)}</p>}
            <div className="i-lanes">
              {lanes.map((lane) => (
                <div key={lane.cat} className="i-lane" data-testid={`lane-${lane.cat}`}>
                  <span className="i-lane-h">{catLabel(lane.cat, lang)}</span>
                  <div className="t-chips">
                    {lane.items.map(({ t, i }) => (
                      <div
                        // Identity is the tag, not its weight: a weight step must not remount the chip (its menu would close).
                        key={`${stripWeight(t)}#${i}`}
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
                          if ((e.target as HTMLElement).closest?.("button, select")) return;
                          drag.current = { from: i, x0: e.clientX, y0: e.clientY, on: false };
                        }}
                      >
                        <span className="t-tagtext">{t}</span>
                        <button type="button" className="t-tagx" title={`${tr("deleteNote", lang)} ${stripWeight(t)}`} aria-label={`${tr("deleteNote", lang)} ${stripWeight(t)}`} onClick={() => removeToken(i)}>
                          ×
                        </button>
                        <MenuPopup label="⋯" ariaLabel={tr("menu", lang)} className="t-tagmenu" menuClassName="t-menu">
                          {(close) => (<>
                            {/* Reorder without a keyboard (touch): same move as Alt+arrows. */}
                            <button type="button" role="menuitem" className="t-menuitem" onClick={() => { moveChip(i, -1); close(); }}>
                              {tr("tagEarlier", lang)}
                            </button>
                            <button type="button" role="menuitem" className="t-menuitem" onClick={() => { moveChip(i, 1); close(); }}>
                              {tr("tagLater", lang)}
                            </button>
                            {hasWeights(model) &&
                              (["low", "normal", "high"] as const).map((w) => (
                                <button
                                  key={w}
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={tagWeight(t) === w}
                                  className="t-menuitem"
                                  onClick={() => {
                                    setTokens((p) => p.map((x, j) => (j === i ? formatWeight(model, x, w) : x)));
                                    close();
                                  }}
                                >
                                  {w === "low" ? tr("tagWLow", lang) : w === "high" ? tr("tagWHigh", lang) : tr("tagWNrm", lang)}
                                </button>
                              ))}
                            {hasWeights(model) && (
                              // Fine steps beside the presets (focus group: three steps were too coarse).
                              <div className="t-menuitem t-wstep" role="group" aria-label={tr("tagWeightL", lang)}>
                                <span>{tr("tagWeightL", lang)}</span>
                                <button type="button" className="g-btn sm" data-testid="tag-w-down" aria-label={tr("tagWDown", lang)} onClick={() => setTokens((p) => p.map((x, j) => (j === i ? stepWeight(x, -1) : x)))}>
                                  −
                                </button>
                                <output data-testid="tag-w-value">{weightValue(t).toFixed(1)}</output>
                                <button type="button" className="g-btn sm" data-testid="tag-w-up" aria-label={tr("tagWUp", lang)} onClick={() => setTokens((p) => p.map((x, j) => (j === i ? stepWeight(x, 1) : x)))}>
                                  +
                                </button>
                              </div>
                            )}
                            <label className="t-menuitem i-catpick">
                              {tr("catL", lang)}
                              <select data-testid="tag-cat" value={catOf(t, tagCats)} onChange={(e) => { setCat(i, e.target.value as TagCat); close(); }}>
                                {CAT_ORDER.map((c) => (
                                  <option key={c} value={c}>{catLabel(c, lang)}</option>
                                ))}
                              </select>
                            </label>
                            <button type="button" role="menuitem" className="t-menuitem danger" onClick={() => removeToken(i)}>
                              {tr("deleteNote", lang)}
                            </button>
                          </>)}
                        </MenuPopup>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {recent.length > 0 && (
              <div className="t-recent" data-testid="tag-recent">
                <span className="muted small">{tr("tagRecent", lang)}:</span>{" "}
                {recent.map((t) => (
                  <button key={t} type="button" className="t-chip sm" onClick={() => addTokens([t])}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={"i-sec i-neg" + (r.negativeSupported ? "" : " off")} data-testid="neg-block">
            <div className="i-sec-h">{tr("negL", lang)}</div>
            {!r.negativeSupported && <p className="muted small">{tr("negFlux", lang)}</p>}
            <div className="i-negrow">
              <input
                data-testid="neg-input"
                value={negInput}
                disabled={!r.negativeSupported}
                onChange={(e) => setNegInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === ",") && negInput.trim()) {
                    e.preventDefault();
                    addNegative(parseTagInput(negInput).length ? parseTagInput(negInput) : [negInput]);
                  }
                }}
                placeholder={tr("negPh", lang)}
                aria-label={tr("negL", lang)}
              />
              <button type="button" className="g-btn sm" data-testid="neg-preset" disabled={!r.negativeSupported} onClick={() => addNegative(NEGATIVE_PRESET)}>
                {tr("negPreset", lang)}
              </button>
            </div>
            <div className="t-chips">
              {negative.map((t, i) => (
                <div key={`${t}#${i}`} className="t-tagchip neg" data-testid="neg-chip">
                  <span className="t-tagtext">{t}</span>
                  <button type="button" className="t-tagx" aria-label={`${tr("deleteNote", lang)} ${t}`} onClick={() => removeNegative(i)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="w-result">
          <div className="i-res-h">{tr("posL", lang)}</div>
          <div className="w-prev mono" data-testid="prompt-result">
            {r.positive || "—"}
          </div>
          {r.negativeSupported && model !== "Midjourney" && (
            <>
              <div className="i-res-h">{tr("negL", lang)}</div>
              <div className="w-prev mono i-negprev" data-testid="prompt-negative">
                {r.negative || "—"}
              </div>
            </>
          )}
          <div className="muted small" data-testid="prompt-params">
            {r.size ? `${tr("sizeL", lang)}: ${r.size[0]} × ${r.size[1]} px (${aspect})` : `${tr("frameL", lang)}: --ar ${aspect}`}
          </div>
          <div className="muted small">
            {r.positive.length} {tr("charsT", lang)} · ≈ {estimateTokens(r.positive)} {tr("tokensT", lang)}
          </div>
          <button type="button" data-testid="copy-prompt" className="g-btn primary w-copy" onClick={() => void copy(r.positive)}>
            {tr("copyPrompt", lang)}
          </button>
          {r.negative && (
            <button type="button" data-testid="copy-negative" className="g-btn sm" onClick={() => void copy(r.negative)}>
              {tr("copyNeg", lang)}
            </button>
          )}
          {!mine && dirty && <p className="muted small" role="status" data-testid="img-builtin-dirty">{tr("imgBuiltinHint", lang)}</p>}
          <label className="t-field">
            <span className="muted small">{tr("tplNameL", lang)}</span>
            <input data-testid="img-tpl-name" value={saveAs} placeholder={saveName} onChange={(e) => setSaveAs(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveTpl(); }} />
          </label>
          <div className="w-result-row">
            <button type="button" className="g-btn sm" data-testid="img-save-tpl" onClick={saveTpl}>
              {tr("saveAsTpl", lang)}
            </button>
            <NoteAttach lang={lang} notes={notes} bindingId={binding} onPick={pickNote} onClear={clearBinding} onOpenNote={onOpenNote} />
          </div>
        </aside>
      </div>
    </div>
  );
}
