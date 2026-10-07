import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import { LLM_TEMPLATES } from "./data";
import { DATASET_VERSION, GENERATED_AT, TAG_DATA } from "./promptData";
import {
  RISK_THRESHOLD,
  buildTplEntries,
  fillBody,
  filterTplEntries,
  isRisky,
  listSlots,

  makeSnippet,
  missingSlots,
  renderPrompt,
  renderSavedTpl,
  resolveParams,


  splitSlots,
  TPL_LIMITS,
  validateTemplate,
} from "./promptUtils";
import type { TplEntry, TplFilter } from "./promptUtils";
import { useListNav } from "./useListNav";
import { useListState } from "./useListState";
import type { AIModel, LlmTpl } from "./data";
import type { Note, PromptSave } from "./store";
import { Hi, Modal, copyText } from "./widgets";

function TagDot({ rate }: { rate: number }) {
  // One grey ramp fails contrast on one theme or the other (dark dot on dark
  // card, pale dot on white card). Encode the band with theme-aware accents
  // instead: same red/green meaning on both themes, digits and the risky!
  // badge carry the exact value redundantly.
  const band = rate < RISK_THRESHOLD ? 'var(--danger)' : 'var(--ok)';
  return (
    <svg width="14" height="14" viewBox="0 0 10 10" role="img" aria-label={`${rate}%`}>
      <title>{`${rate}%`}</title>
      <circle cx="5" cy="5" r="4" fill={band} stroke="var(--tag-dot-outline)" strokeWidth="1" />
    </svg>
  );
}

const MODELS: AIModel[] = ['Pony', 'SDXL', 'Flux'];
const TAG_SUGGESTIONS = 8;

function TplCard({
  lang,
  tpl,
  notify,
  onSave,
  onDuplicate,
  onEdit,
  onDelete,
  initialValues,
}: {
  lang: Lang;
  tpl: LlmTpl;
  notify: (msg: string) => void;
  onSave: (d: { templateId: string; title: string; params: Record<string, string> }) => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  initialValues?: Record<string, string>;
}) {
  const slots = listSlots(tpl.body);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...tpl.defaults, ...initialValues }));
  const set = (name: string, v: string) => setValues((p) => ({ ...p, [name]: v }));

  const result = fillBody(tpl.body, values);
  const missing = missingSlots(tpl.body, values);
  const [attempted, setAttempted] = useState(false);
  const fillCopy = async () => {
    setAttempted(true);
    await copyText(result);
    notify(tr('toastCopied', lang));
  };

  return (
    <div className="g-tpl">
      <div className="g-tpl-t">{tpl.name}</div>
      <div className="g-tpl-body mono">
        {splitSlots(tpl.body).map((pt, i) =>
          pt.slot ? (
            <code key={i} className="g-ph">{pt.slot}</code>
          ) : (
            <span key={i}>{pt.text}</span>
          ),
        )}
      </div>
      
      {slots.map((s) => (
        <label className="g-tpl-f" key={s}>
          {s}
          <input value={values[s] ?? ''} onChange={(e) => set(s, e.target.value)} />
        </label>
      ))}
      {slots.length === 0 && <div className="muted small">{tr('tplNoSlots', lang)}</div>}
      <div className="g-tpl-prev mono" aria-label="preview">
        → {result}
      </div>
      {attempted && missing.length > 0 && (
        <div className="g-tpl-err">
          {tr('tplEmptySlots', lang)}
          {missing.join(', ')}
        </div>
      )}
      <div className="g-ops">
        <button type="button" className="g-btn" onClick={fillCopy}>
          {tr('fillCopy', lang)}
        </button>
        <button type="button" className="g-btn" onClick={() => onSave({ templateId: tpl.id, title: tpl.name, params: { ...values } })}>
          {tr("saveFilled", lang)}
        </button>
        {onDuplicate && (
          <button type="button" className="g-btn" onClick={onDuplicate}>
            {tr("copyToMine", lang)}
          </button>
        )}
        {onEdit && (
          <button type="button" className="g-linkbtn" onClick={onEdit}>
            [{tr('editBtn', lang)}]
          </button>
        )}
        {onDelete && (
          <button type="button" className="g-linkbtn" onClick={onDelete}>
            [{tr('deleteNote', lang)}]
          </button>
        )}
      </div>
    </div>
  );
}

function TplThumb({
  entry,
  lang,
  query,
  open,
  active,
  onToggle,
  onHover,
}: {
  entry: TplEntry;
  lang: Lang;
  query: string;
  open: boolean;
  active: boolean;
  onToggle: () => void;
  onHover: () => void;
}) {
  const t = entry.tpl;
  const slots = listSlots(t.body);
  const snip = makeSnippet(t.body);
  const slotsLabel = tr("tplSlotsN", lang).replace("{n}", String(slots.length));
  return (
    <button
      type="button"
      data-testid={"tpl-mini-" + t.id}
      aria-expanded={open}
      aria-label={t.name}
      className={"g-tpl-mini" + (active ? " active" : "")}
      onClick={onToggle}
      onMouseEnter={onHover}
    >
      <span className="g-tpl-mini-top">
        <span className="g-tpl-ico" aria-hidden="true">
          {entry.kind === "image" ? String.fromCodePoint(0x1F3A8) : String.fromCodePoint(0x1F4AC)}
        </span>
        <span>{t.name}</span>
        {entry.mine && <span className="g-tpl-badge">{tr("tplMineBadge", lang)}</span>}
      </span>
      <span className="g-tpl-snip">
        <Hi text={snip} q={query} />
      </span>
      <span className="g-tpl-meta">
        {slotsLabel} {entry.kind}
      </span>
    </button>
  );
}

function SaveRow({
  lang,
  p,
  noteChip,
  preview,
  onOpen,
  onCopy,
  onToNote,
  onUnbind,
  onDelete,
}: {
  lang: Lang;
  p: PromptSave;
  noteChip: ReactNode;
  preview: string;
  onOpen: () => void;
  onCopy: () => void;
  onToNote: () => void;
  onUnbind?: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="g-sugg-col">
      <div className="g-sugg">
        <span>
          • {p.title} <span className="g-kind">{p.kind}</span> {noteChip}
        </span>
        <span className="g-ops">
          <button type="button" className="g-linkbtn" onClick={onOpen}>
            [{tr("openBtn", lang)}]
          </button>{" "}
          <button type="button" className="g-linkbtn" onClick={onCopy}>
            [{tr("copyPrompt", lang)}]
          </button>{" "}
          <button type="button" className="g-linkbtn" onClick={onToNote}>
            [{tr("toNote", lang)}]
          </button>{" "}
          {onUnbind && (
            <>
              <button type="button" className="g-linkbtn" onClick={onUnbind}>
                [{tr("unbindBtn", lang)}]
              </button>{" "}
            </>
          )}
          <button type="button" className="g-linkbtn" onClick={onDelete}>
            [{tr("deleteNote", lang)}]
          </button>
        </span>
      </div>
      <div className="g-sugg-prev mono">{preview}</div>
    </div>
  );
}

type TplForm = Omit<LlmTpl, 'id'>;

function TplEditor({
  lang,
  editMode,
  initial,
  onClose,
  onSubmit,
}: {
  lang: Lang;
  editMode: boolean;
  initial: TplForm;
  onClose: () => void;
  onSubmit: (d: TplForm) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [body, setBody] = useState(initial.body);
  const [defaults, setDefaults] = useState<Record<string, string>>(initial.defaults);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const slots = listSlots(body);
  const bad = validateTemplate({ name, body });

  const insertVar = () => {
    const taken = new Set(slots);
    let i = slots.length + 1;
    let v = `var${i}`;
    while (taken.has(v)) {
      i += 1;
      v = `var${i}`;
    }
    const ins = `{{${v}}}`;
    const el = areaRef.current;
    if (!el) {
      setBody((b) => `${b}${b && !b.endsWith('\n') ? '\n' : ''}${ins}`);
      return;
    }
    const s = el.selectionStart ?? body.length;
    const e = el.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + ins + body.slice(e));
    const pos = s + ins.length;
    window.setTimeout(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    }, 0);
  };

  const submit = () => {
    const pruned: Record<string, string> = {};
    for (const sl of slots) pruned[sl] = defaults[sl] ?? '';
    onSubmit({ name: name.trim(), body, defaults: pruned, ...(initial.kind ? { kind: initial.kind } : {}) });
  };

  return (
    <Modal title={tr(editMode ? 'editTplT' : 'newTpl', lang)} lang={lang} onClose={onClose}>
      <label className="g-field">
        {tr('tplNameL', lang)}
        <input className="g-in" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="g-field">
        {tr('tplBodyL', lang)}
        <textarea
          ref={areaRef}
          className="g-in g-tbody"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={tr('tplBodyPh', lang)}
        />
      </label>
      <div className="g-tpl-hint">{tr('tplHint', lang)}</div>
      <div className="g-ops">
        <button type="button" className="g-btn sm" onClick={insertVar}>
          {tr('tplAddVar', lang)}
        </button>
      </div>
      {slots.length > 0 && (
        <>
          <div className="g-card-t sub">{tr('tplDefaultsT', lang)}</div>
          {slots.map((s) => (
            <label className="g-field g-defrow" key={s}>
              <code className="g-ph">{s}</code>
              <input
                className="g-in"
                value={defaults[s] ?? ''}
                onChange={(e) => setDefaults((p) => ({ ...p, [s]: e.target.value }))}
              />
            </label>
          ))}
        </>
      )}
      <div className="g-tpl-prev mono" aria-label="preview">
        → {fillBody(body || '…', defaults)}
      </div>
      {bad.includes('name') && <div className="g-tpl-err">{tr('tplBadTitle', lang)}</div>}
      {bad.includes('body') && <div className="g-tpl-err">{tr('tplBadBody', lang)}</div>}
      <div className="g-modal-actions">
        <button type="button" className="g-btn sm" onClick={onClose}>
          {tr('cancelBtn', lang)}
        </button>
        <button type="button" className="g-btn sm primary" disabled={bad.length > 0} onClick={submit}>
          {tr('saveBtn', lang)}
        </button>
      </div>
    </Modal>
  );
}

const EMPTY_DRAFT: TplForm = { name: '', body: '', defaults: {} };

export function PromptPage({
  lang,
  notify,
  prompts,
  notes,
  activePrompt,
  customTpls,
  tplLimit,
  onTplLimit,
  onSave,
  onDelete,
  onBind,
  onUnbind,
  onOpenNote,
  onConsumed,
  onSaveTpl,
  onUpdateTpl,
  onDeleteTpl,
  profileId,
}: {
  lang: Lang;
  notify: (msg: string) => void;
  prompts: PromptSave[];
  notes: Note[];
  activePrompt: PromptSave | null;
  customTpls: LlmTpl[];
  tplLimit: number;
  onTplLimit: (n: number) => void;
  onSave: (d: Omit<PromptSave, 'id' | 'created'>) => void;
  onDelete: (id: string) => void;
  onBind: (promptId: string, noteId: string, text: string) => void;
  onUnbind: (id: string) => void;
  onOpenNote: (id: string) => void;
  onConsumed: () => void;
  onSaveTpl: (d: TplForm) => string;
  onUpdateTpl: (id: string, d: TplForm) => void;
  onDeleteTpl: (id: string) => void;
  profileId: string;
}) {
  const [model, setModel] = useState<AIModel>('Pony');
  const [typed, setTyped] = useState('blue');
  const [tokens, setTokens] = useState<string[]>([]);
  const [risk, setRisk] = useState<{ tag: string; rate: number } | null>(null);

  const [pick, setPick] = useState<PromptSave | null>(null);
  const [pickQ, setPickQ] = useState('');
  const [pickShown, setPickShown] = useState(8);

  const [loadedTpl, setLoadedTpl] = useState<{ id: string; values: Record<string, string>; tick: number } | null>(null);
  const [editingTpl, setEditingTpl] = useState<{ id: string | null; draft: TplForm } | null>(null);
  const appliedRef = useRef<string | null>(null);
  const tickRef = useRef(0);

  const findTpl = useCallback(
    (id: string | undefined): LlmTpl | undefined =>
      (id ? customTpls.find((x) => x.id === id) : undefined) ?? LLM_TEMPLATES.find((x) => x.id === id),
    [customTpls],
  );

  const buildText = (p: PromptSave) => {
    if (p.kind === 'image') return renderPrompt(p.model ?? model, p.tokens ?? []);
    const t = findTpl(p.templateId);
    if (!t) return p.title;
    return renderSavedTpl(t, p.params ?? {});
  };

  const noteChip = (p: PromptSave) => {
    if (!p.noteId) return null;
    const t = notes.find((n) => n.id === p.noteId)?.title;
    if (!t) return null;
    const id = p.noteId;
    return (
      <button type="button" className="g-linkbtn" onClick={() => onOpenNote(id)}>
        → {t}
      </button>
    );
  };

  // Default slice stays 8, but the cut is never silent: title+text match,
  // honest counter, pager into the rest.
  const pickNotesAll = notes.filter((n) => {
    const needle = pickQ.trim().toLowerCase();
    return `${n.title} ${n.text}`.toLowerCase().includes(needle);
  });
  const pickNotes = pickNotesAll.slice(0, pickShown);
  const copySave = async (p: PromptSave) => {
    await copyText(buildText(p));
    notify(tr('toastCopied', lang));
  };

  const tplSaves = (id: string) => prompts.filter((p) => p.templateId === id);
  const orphanSaves = prompts.filter((p) => p.templateId && !findTpl(p.templateId));

  const totalSamples = TAG_DATA.reduce((s, t) => s + t.perModel[model].samples, 0);
  const tags = TAG_DATA.map((t) => ({ tag: t.tag, ...t.perModel[model] })).filter((t) =>
    t.tag.toLowerCase().includes(typed.trim().toLowerCase()),
  );

  const addTag = (tag: string, rate: number) => {
    if (!tokens.includes(tag)) setTokens((p) => [...p, tag]);
    setRisk(isRisky(rate) ? { tag, rate } : null);
  };



  const shownTags = tags.slice(0, TAG_SUGGESTIONS);
  const tagNav = useListNav(shownTags.length, (i) => {
  const t = shownTags[i];
  if (t) addTag(t.tag, t.rate);
});

const promptStr = [renderPrompt(model, tokens), typed.trim()].filter((x) => x).join(', ');

  const copyPrompt = async () => {
    await copyText(promptStr);
    notify(tr('toastCopied', lang));
  };

  const saveTemplate = () => {
    const name = `${tokens.slice(0, 2).join(', ') || typed || 'prompt'} (${model})`;
    setEditingTpl({ id: null, draft: { name, body: promptStr, defaults: {}, kind: 'image' } });
  };

  const submitTplEditor = (d: TplForm) => {
    if (!editingTpl) return;
    if (editingTpl.id === null) {
      const id = onSaveTpl(d);
      const existingEntries = buildTplEntries(LLM_TEMPLATES, customTpls);
      const index = d.kind === 'image'
        ? existingEntries.filter((entry) => entry.kind === 'image').length
        : existingEntries.length;
      setTplFilter(d.kind === 'image' ? 'image' : 'all');
      tpl.changeQuery('');
      tpl.ensureVisible(index);
      setExpanded((prev) => new Set(prev).add(id));
      window.setTimeout(() => {
        document.getElementById('tplcard-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    } else {
      onUpdateTpl(editingTpl.id, d);
    }
    setEditingTpl(null);
  };

  const [tplFilter, setTplFilter] = useState<TplFilter>("all");

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string) => {
    setExpanded((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const tplEntries = useMemo(() => buildTplEntries(LLM_TEMPLATES, customTpls), [customTpls]);
  const select = useCallback((q: string) => filterTplEntries(tplEntries, q, tplFilter), [tplEntries, tplFilter]);
  const tpl = useListState({
    key: "prompts",
    profileId,
    select,
    limit: tplLimit,
    onLimitChange: onTplLimit,
    onPick: (e) => toggleExpand(e.tpl.id),
  });
  const resetTplFilter = () => {
    tpl.changeQuery("");
    setTplFilter("all");
  };
  useEffect(() => {
    if (loadedTpl) setExpanded((p) => new Set(p).add(loadedTpl.id));
  }, [loadedTpl]);
  // A save already visible on this page reloads straight into the editor
  // (same paths as activePrompt, but nothing to consume). Always scrolls
  // to the target and toasts, so the click visibly does something even
  // when the values already match. tick forces a card reset on repeat.
  const loadSaved = useCallback((p: PromptSave) => {
    if (p.kind === 'image') {
      if (p.model) setModel(p.model);
      setTokens([...(p.tokens ?? [])]);
      setTyped('');
      setRisk(null);
      window.setTimeout(() => {
        document.getElementById("prompt-tokens")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      notify(tr('tplLoaded', lang));
      return;
    }
    if (p.templateId) {
      const tid: string = p.templateId;
      const t = findTpl(tid);
      if (!t) {
        notify(tr("tplGone", lang));
        return;
      }
      setLoadedTpl({ id: tid, values: resolveParams(t, p.params ?? {}), tick: ++tickRef.current });
      const idxAll = tplEntries.findIndex((e) => e.tpl.id === tid);
      const idxVis = tpl.filtered.findIndex((e) => e.tpl.id === tid);
      if (idxVis < 0) {
        tpl.changeQuery("");
        setTplFilter("all");
      }
      setExpanded((prev) => new Set(prev).add(tid));
      tpl.ensureVisible(idxAll);
      window.setTimeout(() => {
        const el = document.getElementById("tplcard-" + tid);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      notify(tr("tplLoaded", lang));
    }

  }, [findTpl, notify, tpl, lang, tplEntries]);

  // A prompt opened from a note ("Открыть" in the note card) or from global
  // search lands here once via activePrompt, then the id is consumed.
  // Reuses loadSaved so search opens get the same scroll, expand and toast.
  useEffect(() => {
    if (!activePrompt || appliedRef.current === activePrompt.id) return;
    appliedRef.current = activePrompt.id;
    loadSaved(activePrompt);
    onConsumed();
  }, [activePrompt, loadSaved, onConsumed]);

  const tplKey = (id: string) => `${id}:${loadedTpl?.id === id ? loadedTpl.tick : 0}`;

  return (
    <div className="g-prompt">
      <h2 className="g-h2">{tr('promptTitle', lang)}</h2>
      <div className="g-prow">
        <div className="g-card">
          <div className="g-card-t">{tr('modelL', lang)}</div>
          {MODELS.map((m) => (
            <label className="g-radio" key={m}>
              <input
                type="radio"
                name="model"
                checked={model === m}
                onChange={() => {
                  setModel(m);
                  setRisk(null);
                  tagNav.reset();
                }}
              />
              {m}
            </label>
          ))}
          <div className="muted small">{tr('modelL', lang)} Pony / SDXL / Flux</div>
        </div>

        <div className="g-card grow">
          {tokens.length > 0 && (
            <div className="g-tokens" id="prompt-tokens">
              {tokens.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="g-chip sm"
                  onClick={() => setTokens((p) => p.filter((x) => x !== t))}
                  title="×"
                >
                  {t} ×
                </button>
              ))}
            </div>
          )}
          <input
            className="g-in"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              tagNav.reset();
            }}
            onKeyDown={tagNav.onKeyDown}
            placeholder={tr('typeToFilter', lang)}
            aria-label="prompt"
          />
          <div className="g-drop">
            {tags.length === 0 && <div className="muted">{tr('noResults', lang)}</div>}
            {shownTags.map((t, i) => (
              <button
                key={t.tag}
                type="button"
                className={`g-tagrow${i === tagNav.active ? ' active' : ''}`}
                onMouseEnter={() => tagNav.setActive(i)}
                onClick={() => addTag(t.tag, t.rate)}
              >
                <span>{t.tag}</span>
                <TagDot rate={t.rate} />
                <span className="mono">{t.rate}%</span>
                {t.rate < 50 && <span className="g-risk">risky!</span>}
              </button>
            ))}
          </div>
          <div className="muted small">
            {tr('tagLegend', lang)}
          </div>
          <div className="g-modal-actions">
            <button type="button" className="g-btn sm" onClick={copyPrompt}>
              [{tr('copyPrompt', lang)}]
            </button>
            <button type="button" className="g-btn sm" onClick={saveTemplate}>
              {tr("saveAsTpl", lang)}
            </button>
          </div>
          {risk && (
            <div className="g-banner-warn">
              {tr('riskT', lang)} {risk.rate}{tr('riskT2', lang)}
            </div>
          )}
          <div className="g-card-t">{tr("llmT", lang)} ({tpl.filtered.length})</div>
          <div className="g-tpl-hint">{tr("tplHint", lang)}</div>
          <div className="g-tpl-tools">
            <input
              className="g-in"
              value={tpl.query}
              onChange={(ev) => tpl.changeQuery(ev.target.value)}
              onKeyDown={tpl.nav.onKeyDown}
              placeholder={tr("tplSearchPh", lang)}
              aria-label="tpl search"
            />
            <div className="g-tpl-row">
              <div className="g-tpl-chips" role="group" aria-label="tpl filter">
                {(
                  [
                    { id: "all", key: "tplFAll" },
                    { id: "mine", key: "tplFMine" },
                    { id: "llm", key: "tplFLlm" },
                    { id: "image", key: "tplFImg" },
                  ] as { id: TplFilter; key: string }[]
                ).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={"g-chipbtn" + (tplFilter === c.id ? " active" : "")}
                    onClick={() => { setTplFilter(c.id); tpl.resetShown(); tpl.resetNavigation(); }}
                  >
                    {tr(c.key, lang)}
                  </button>
                ))}
              </div>
            </div>
            <div className="g-tpl-row">
              <span className="muted small">{tr("tplLimitL", lang)}</span>
              <div className="g-seg" role="group" aria-label="limit">
                {TPL_LIMITS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={"g-btn sm" + (tpl.limit === n ? " active" : "")}
                    onClick={() => tpl.changeLimit(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {tpl.filtered.length === 0 && (
            <div className="g-tpl-empty">
              <div>{tr("noResults", lang)}</div>
              <button type="button" className="g-btn sm" onClick={resetTplFilter}>
                {tr("tplResetFilter", lang)}
              </button>
            </div>
          )}
          {tpl.filtered.length > 0 && (
            <div className="muted small">
              {tr("listShownOf", lang).replace("{x}", String(tpl.visible.length)).replace("{y}", String(tpl.filtered.length))}
            </div>
          )}
          <div className="g-tpl-list">
            {tpl.visible.map((e, i) => {
              const t = e.tpl;
              const isOpen = expanded.has(t.id);
              return (
                <div key={tplKey(t.id)} id={"tplcard-" + t.id} data-testid={"tpl-card-" + t.id}>
                  <TplThumb
                    entry={e}
                    lang={lang}
                    query={tpl.query}
                    open={isOpen}
                    active={i === tpl.nav.active}
                    onToggle={() => toggleExpand(t.id)}
                    onHover={() => tpl.nav.setActive(i)}
                  />
                  {isOpen && (
                    <TplCard
                      lang={lang}
                      tpl={t}
                      notify={notify}
                      initialValues={loadedTpl && loadedTpl.id === t.id ? loadedTpl.values : undefined}
                      onSave={(d) => onSave({ kind: "llm", title: d.title, templateId: d.templateId, params: d.params })}
                      onDuplicate={e.mine ? undefined : () => onSaveTpl({ name: t.name, body: t.body, defaults: { ...t.defaults }, ...(e.kind === 'image' ? { kind: 'image' as const } : {}) })}
                      onEdit={e.mine ? () => setEditingTpl({ id: t.id, draft: { name: t.name, body: t.body, defaults: { ...t.defaults }, ...(t.kind ? { kind: t.kind } : {}) } }) : undefined}
                      onDelete={e.mine ? () => onDeleteTpl(t.id) : undefined}
                    />
                  )}
                  {isOpen && tplSaves(t.id).length > 0 && tplSaves(t.id).map((p) => (
                    <SaveRow
                      key={p.id}
                      lang={lang}
                      p={p}
                      noteChip={noteChip(p)}
                      preview={buildText(p) || "—"}
                      onOpen={() => loadSaved(p)}
                      onCopy={() => copySave(p)}
                      onToNote={() => { setPick(p); setPickShown(8); }}
                      onUnbind={p.noteId ? () => onUnbind(p.id) : undefined}
                      onDelete={() => onDelete(p.id)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
          {tpl.shown < tpl.filtered.length && (
            <button
              type="button"
              className="g-btn sm g-tpl-more"
              onClick={() => tpl.showMore()}
            >
              {tr("tplShowMore", lang).replace("{n}", String(Math.min(tpl.limit, tpl.filtered.length - tpl.shown)))}
            </button>
          )}
          <div className="g-ops">
            <button
              type="button"
              className="g-btn sm"
              onClick={() => setEditingTpl({ id: null, draft: { ...EMPTY_DRAFT } })}
            >
              {tr("newTpl", lang)}
            </button>
          </div>
          {orphanSaves.length > 0 && (
            <>
              <div className="g-card-t">
                {tr("orphanSaves", lang)} ({orphanSaves.length})
              </div>
              {orphanSaves.map((p) => (
                <SaveRow
                  key={p.id}
                  lang={lang}
                  p={p}
                  noteChip={noteChip(p)}
                  preview={buildText(p) || "—"}
                  onOpen={() => loadSaved(p)}
                  onCopy={() => copySave(p)}
                  onToNote={() => { setPick(p); setPickShown(8); }}
                  onUnbind={p.noteId ? () => onUnbind(p.id) : undefined}
                  onDelete={() => onDelete(p.id)}
                />
              ))}
            </>
          )}
        </div>

        <div className="g-tpls">
          <div className="g-card ok">
            <div className="g-card-t">{tr('cacheT', lang)}</div>
            <div className="muted small">
              {tr('dsStatic', lang)} {DATASET_VERSION} · {TAG_DATA.length} {tr('dsTags', lang)} ·{' '}
              {totalSamples.toLocaleString('ru-RU')} {tr('dsSamples', lang)} · {GENERATED_AT}
            </div>
          </div>
        </div>
      </div>
      <div className="g-flow">{tr('flowT', lang)}</div>
      {pick && (
        <Modal title={tr('pickNoteT', lang)} lang={lang} onClose={() => setPick(null)}>
          <div className="g-sugg-prev mono">→ {buildText(pick)}</div>
          <input
            className="g-in"
            value={pickQ}
            onChange={(e) => {
              setPickQ(e.target.value);
              setPickShown(8);
            }}
            placeholder={tr('linkSearchPh', lang)}
            aria-label="pick note"
          />
          <div className="g-linklist">
            {pickNotes.length === 0 && <div className="muted small" style={{ padding: 12 }}>{tr('linkEmpty', lang)}</div>}
            {pickNotesAll.length > 0 && (
              <div className="muted small" style={{ padding: '4px 12px 0' }}>
                {tr('listShownOf', lang).replace('{x}', String(pickNotes.length)).replace('{y}', String(pickNotesAll.length))}
              </div>
            )}
            {pickNotes.map((n) => (
              <button
                key={n.id}
                type="button"
                className="g-linkitem"
                onClick={() => {
                  onBind(pick.id, n.id, buildText(pick));
                  setPick(null);
                }}
              >
                <span>{n.title || tr('newNoteTitle', lang)}</span>
              </button>
            ))}
            {pickShown < pickNotesAll.length && (
              <button type="button" className="g-btn sm g-tpl-more" onClick={() => setPickShown((s) => s + 8)}>
                {tr('tplShowMore', lang).replace('{n}', String(Math.min(8, pickNotesAll.length - pickShown)))}
              </button>
            )}
          </div>
        </Modal>
      )}
      {editingTpl && (
        <TplEditor
          lang={lang}
          editMode={editingTpl.id !== null}
          initial={editingTpl.draft}
          onClose={() => setEditingTpl(null)}
          onSubmit={submitTplEditor}
        />
      )}
    </div>
  );
}
