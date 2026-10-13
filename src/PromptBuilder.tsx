import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { LlmTpl } from "./data";
import { fillBody, listSlots } from "./promptUtils";
import { requiredSlots } from "./workbenchModel";
import { lintTemplate, nextFieldName } from "./builderModel";

export interface BuilderDraft {
  name: string;
  body: string;
  defaults: Record<string, string>;
  kind?: LlmTpl["kind"];
}

/** Template constructor (S9): body left, live field table right. */
export function PromptBuilder({
  lang,
  title,
  initial,
  onSave,
  onCancel,
}: {
  lang: Lang;
  title: string;
  initial: BuilderDraft;
  onSave: (d: BuilderDraft) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [body, setBody] = useState(initial.body);
  const [defaults, setDefaults] = useState<Record<string, string>>(() => ({ ...initial.defaults }));
  const [kind, setKind] = useState<"text" | "image">(initial.kind === "image" ? "image" : "text");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSel = useRef<{ start: number; end: number } | null>(null);

  const fields = useMemo(() => listSlots(body), [body]);
  const required = useMemo(() => new Set(requiredSlots({ body, defaults })), [body, defaults]);
  const lint = useMemo(() => lintTemplate(body), [body]);
  const preview = fillBody(body, defaults);

  const insertField = () => {
    const ta = bodyRef.current;
    const at = ta ? (ta.selectionStart ?? body.length) : body.length;
    const field = nextFieldName(body);
    const token = `{{${field}}}`;
    setBody(body.slice(0, at) + token + body.slice(ta?.selectionEnd ?? at));
    pendingSel.current = { start: at + 2, end: at + 2 + field.length };
  };

  // DOM-only post-render step (no setState): put the caret on the new name.
  useEffect(() => {
    const sel = pendingSel.current;
    pendingSel.current = null;
    const ta = bodyRef.current;
    if (sel && ta) {
      ta.focus();
      ta.setSelectionRange(sel.start, sel.end);
    }
  });

  // Ctrl+Shift+F inserts a field wherever the caret is not in a dialog.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      if (e.code !== "KeyF") return;
      if (t && t.closest && t.closest(".g-modal")) return;
      e.preventDefault();
      insertField();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  const canSave = name.trim().length > 0;

  return (
    <div className="b-builder" data-testid="prompt-builder">
      <div className="w-whead">
        <div className="w-wtitle">{title}</div>
      </div>
      <label className="t-field">
        <span className="muted small">{tr("fldName", lang)}</span>
        <input
          autoFocus
          data-testid="builder-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={tr("fldName", lang)}
        />
      </label>
      <div className="b-cols">
        <div className="b-left">
          <button
            type="button"
            data-testid="builder-insert"
            className="g-btn sm"
            onClick={insertField}
          >
            {tr("insertField", lang)}
          </button>
          <textarea
            ref={bodyRef}
            data-testid="builder-body"
            className="g-area mono b-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label={tr("fldBody", lang)}
            rows={12}
          />
          {lint.length > 0 && (
            <div className="g-tpl-err" data-testid="builder-errors" role="alert">
              {lint.map((e, i) => (
                <div key={i}>
                  {tr("tplErrLine", lang).replace("{n}", String(e.line))}:{" "}
                  {e.kind === "unclosed" ? tr("tplErrUnclosed", lang) : `${tr("tplErrDup", lang)} «${e.name}»`}
                </div>
              ))}
            </div>
          )}
          <div className="w-prev mono">{preview || "—"}</div>
          <div className="t-duechips" role="group" aria-label={tr("fldType", lang)}>
            {(
              [
                ["text", tr("segTxt", lang)],
                ["image", tr("badgeImg", lang)],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={"t-chip" + (kind === k ? " active" : "")}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="b-right">
          <div className="g-card-t">{tr("fldFields", lang)}</div>
          {fields.length === 0 && <div className="muted small">{tr("fldEmpty", lang)}</div>}
          {fields.map((s) => (
            <div key={s} className="b-frow" data-testid={`builder-field-${s}`}>
              <code className="mono">{s}</code>
              <input
                value={defaults[s] ?? ""}
                onChange={(e) => setDefaults((p) => ({ ...p, [s]: e.target.value }))}
                placeholder={tr("fldDefault", lang)}
                aria-label={s}
              />
              <span className="b-req" title={required.has(s) ? tr("fldReq", lang) : ""}>
                {required.has(s) ? "*" : "–"}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="b-foot">
        <button type="button" className="g-btn ghost" onClick={onCancel}>
          {tr("cancelBtn", lang)}
        </button>
        <button
          type="button"
          className="g-btn primary"
          disabled={!canSave}
          onClick={() =>
            onSave({ name: name.trim(), body, defaults, ...(kind === "image" ? { kind: "image" as const } : {}) })
          }
        >
          {tr("saveBtn", lang)}
        </button>
      </div>
    </div>
  );
}
