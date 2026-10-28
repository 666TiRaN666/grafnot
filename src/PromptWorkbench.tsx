import { useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { LlmTpl } from "./data";
import type { Note } from "./store";
import { copyText } from "./widgets";
import { fillBody, isBlockSlot, listSlots, missingSlots, resolveParams, splitSlots } from "./promptUtils";
import { buildSaveTitle, requiredSlots } from "./workbenchModel";
import { NoteAttach } from "./NoteAttach";
import type { PromptSave } from "./store";

export function PromptWorkbench({
  lang,
  tpl,
  mine,
  save,
  notes,
  onSave,
  onDuplicate,
  onEdit,
  onDelete,
  onUnbindSave,
  onAppendNote,
  onOpenNote,
  notify,
  notifyAction,
}: {
  lang: Lang;
  tpl: LlmTpl;
  mine: boolean;
  /** S9: save mode — values/binding come from the save, no re-saving. */
  save?: PromptSave | null;
  notes: Note[];
  onSave: (d: { kind: "llm"; title: string; templateId: string; params: Record<string, string>; noteId?: string }) => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUnbindSave?: () => void;
  onAppendNote: (noteId: string, text: string) => void;
  onOpenNote: (id: string) => void;
  notify: (msg: string) => void;
  notifyAction: (text: string, actionLabel: string, fn: () => void) => void;
}) {
  const slots = useMemo(() => listSlots(tpl.body), [tpl.body]);
  const required = useMemo(() => new Set(requiredSlots(tpl)), [tpl]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    save ? resolveParams(tpl, save.params ?? {}) : { ...tpl.defaults },
  );
  const [attempted, setAttempted] = useState(false);
  const [binding, setBinding] = useState<string | undefined>(undefined);
  const [moreOpen, setMoreOpen] = useState(false);
  const fieldRefs = useRef<(HTMLElement | null)[]>([]);

  const result = fillBody(tpl.body, values);
  const missing = missingSlots(tpl.body, values);
  const focusIdx = (() => {
    const i = slots.findIndex((s) => required.has(s) && !(values[s] ?? "").trim());
    return i >= 0 ? i : 0;
  })();

  const focusField = (i: number) => fieldRefs.current[i]?.focus();

  const tryCopy = async () => {
    setAttempted(true);
    const miss = missingSlots(tpl.body, values);
    if (miss.length > 0) {
      const i = slots.indexOf(miss[0] as string);
      if (i >= 0) focusField(i);
      return;
    }
    await copyText(result);
    notify(tr("toastCopied", lang));
  };

  const onFieldEnter = (i: number) => {
    if (i < slots.length - 1) focusField(i + 1);
    else void tryCopy();
  };

  const dateStr = (() => {
    try {
      return new Date().toLocaleDateString(lang === "KZ" ? "kk-KZ" : lang === "EN" ? "en-US" : "ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return "";
    }
  })();

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

  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <div className="w-work" data-testid="prompt-workbench">
      <div className="w-whead">
        <div className="w-wtitle-wrap">
          <div className="w-wtitle">{save?.title ?? tpl.name}</div>
          <span className="pl-badges">
            <span className="pl-badge">{tpl.kind === "image" ? tr("badgeImg", lang) : tr("segTxt", lang)}</span>
            <span className="pl-badge">
              {save ? tr("orgSaved", lang) : mine ? tr("orgMine", lang) : tr("orgBuiltin", lang)}
            </span>
          </span>
        </div>
        <span className="n-morewrap">
          <button
            type="button"
            data-testid="prompt-wb-more"
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
              {save ? (
                <>
                  {save.noteId && onUnbindSave && (
                    <button
                      type="button"
                      role="menuitem"
                      className="n-menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        onUnbindSave();
                      }}
                    >
                      {tr("unbindBtn", lang)}
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="n-menuitem danger"
                    onClick={() => {
                      setMoreOpen(false);
                      onDelete();
                    }}
                  >
                    {tr("deleteNote", lang)}
                  </button>
                </>
              ) : mine ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="n-menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      onEdit();
                    }}
                  >
                    {tr("builderEdit", lang)}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="n-menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      onDuplicate();
                    }}
                  >
                    {tr("duplicate", lang)}
                  </button>
                  <div className="n-menusep" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="n-menuitem danger"
                    onClick={() => {
                      setMoreOpen(false);
                      onDelete();
                    }}
                  >
                    {tr("deleteNote", lang)}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="n-menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    onDuplicate();
                  }}
                >
                  {tr("copyToMine", lang)}
                </button>
              )}
            </span>
          )}
        </span>
      </div>

      <div className="w-cols">
        <div
          className="w-form"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void tryCopy();
            }
          }}
        >
          {slots.map((s, i) => {
            // Textarea: Enter breaks the line, Ctrl+Enter copies (form handler).
            const multi = isBlockSlot(tpl.body, s, tpl.defaults[s]);
            return (
              <label key={s} className="t-field">
                <span className="muted small">
                  {s}
                  {required.has(s) ? " *" : ""}
                </span>
                {multi ? (
                  <textarea
                    ref={(el) => {
                      fieldRefs.current[i] = el;
                      grow(el);
                    }}
                    autoFocus={i === focusIdx}
                    className="g-area"
                    value={values[s] ?? ""}
                    onChange={(e) => {
                      setValues((p) => ({ ...p, [s]: e.target.value }));
                      grow(e.target);
                    }}
                    aria-label={s}
                    rows={3}
                  />
                ) : (
                  <input
                    ref={(el) => {
                      fieldRefs.current[i] = el;
                    }}
                    autoFocus={i === focusIdx}
                    value={values[s] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [s]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onFieldEnter(i);
                      }
                    }}
                    aria-label={s}
                  />
                )}
              </label>
            );
          })}
          {attempted && missing.length > 0 && (
            <div className="g-tpl-err">
              {tr("tplEmptySlots", lang)}
              {missing.join(", ")}
            </div>
          )}
        </div>

        <aside className="w-result">
          <div className="w-prev mono" data-testid="prompt-result">
            {splitSlots(tpl.body).map((pt, i) =>
              pt.slot ? (
                (values[pt.slot] ?? "").trim() ? (
                  <span key={i}>{values[pt.slot]}</span>
                ) : (
                  <button
                    key={i}
                    type="button"
                    className="w-miss"
                    title={pt.slot}
                    onClick={() => focusField(slots.indexOf(pt.slot as string))}
                  >
                    {`{{${pt.slot}}}`}
                  </button>
                )
              ) : (
                <span key={i}>{pt.text}</span>
              ),
            )}
          </div>
          <div className="muted small">
            {(result.length ?? 0)} {tr("charsT", lang)}
          </div>
          <button
            type="button"
            data-testid="copy-prompt"
            className="g-btn primary w-copy"
            onClick={() => void tryCopy()}
          >
            {tr("copyPrompt", lang)}
          </button>
          <div className="w-result-row">
            {!save && (
              <button
                type="button"
                className="g-btn sm"
                onClick={() =>
                  onSave({
                    kind: "llm",
                    title: buildSaveTitle(tpl.name, dateStr),
                    templateId: tpl.id,
                    params: { ...values },
                    noteId: binding,
                  })
                }
              >
                {tr("saveFilled", lang)}
              </button>
            )}
            <NoteAttach
              lang={lang}
              notes={notes}
              bindingId={binding ?? save?.noteId}
              onPick={pickNote}
              onClear={() => {
                if (binding) clearBinding();
                else if (save?.noteId && onUnbindSave) onUnbindSave();
              }}
              onOpenNote={onOpenNote}
            />
          </div>
        </aside>
      </div>

    </div>
  );
}
