import { useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { SkillFormat, SkillSpec } from "./data";
import { copyText } from "./clipboard";
import { estimateTokens, lintSkill, renderSkill, SKILL_DESC_MAX, skillDescription, skillFileName, slugify } from "./skillModel";
import type { SkillIssueId } from "./skillModel";

const FORMATS: SkillFormat[] = ["skill", "system", "agents"];
const FILE_LANGS: [Lang, string][] = [["RU", "Русский"], ["EN", "English"], ["KZ", "Қазақша"]];

function formatLabel(f: SkillFormat, lang: Lang): string {
  return f === "skill" ? tr("skFmtSkill", lang) : f === "system" ? tr("skFmtSystem", lang) : tr("skFmtAgents", lang);
}
function formatHint(f: SkillFormat, lang: Lang): string {
  return f === "skill" ? tr("skHintSkill", lang) : f === "system" ? tr("skHintSystem", lang) : tr("skHintAgents", lang);
}
function issueText(id: SkillIssueId, lang: Lang): string {
  switch (id) {
    case "name": return tr("skErrName", lang);
    case "desc": return tr("skErrDesc", lang);
    case "descLong": return tr("skErrDescLong", lang);
    case "when": return tr("skWarnWhen", lang);
    default: return tr("skWarnSteps", lang);
  }
}

/** Plain-text file download (the markdown the user takes to an agent). */
function downloadText(text: string, filename: string): boolean {
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
    return true;
  } catch {
    return false;
  }
}

/** Skill builder: one structured description of a task for a neural
 * network, rendered live as SKILL.md, a system prompt or AGENTS.md. */
export function SkillBuilder({
  lang,
  title,
  initial,
  saveLabel,
  onSave,
  onCancel,
  notify,
}: {
  lang: Lang;
  title: string;
  initial: SkillSpec;
  saveLabel: string;
  onSave: (spec: SkillSpec, body: string) => void;
  onCancel: () => void;
  notify: (msg: string) => void;
}) {
  const [spec, setSpec] = useState<SkillSpec>(initial);
  const set = <K extends keyof SkillSpec>(k: K, v: SkillSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));
  const text = renderSkill(spec, lang);
  const fileLang = spec.lang ?? lang;
  const issues = lintSkill(spec);
  const blocking = issues.some((i) => i.level === "error");
  const descLen = skillDescription(spec, "EN").length;
  const file = skillFileName(spec.format);

  const field = (k: "description" | "whenToUse" | "steps" | "rules" | "output", label: string, ph: string, testid: string, rows = 3) => (
    <label className="t-field">
      <span className="muted small">{label}</span>
      <textarea className="g-area" data-testid={testid} rows={rows} value={spec[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} aria-label={label} />
    </label>
  );

  return (
    <div
      className="w-work k-work"
      data-testid="skill-builder"
      onKeyDown={(e) => {
        // Ctrl+S saves like the button (and never opens the browser's "save page").
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyS") {
          e.preventDefault();
          if (!blocking) onSave(spec, text);
        }
      }}
    >
      <div className="w-whead">
        <div className="w-wtitle-wrap">
          <div className="w-wtitle">{title}</div>
          <span className="pl-badges">
            <span className="pl-badge">{tr("badgeSkill", lang)}</span>
          </span>
        </div>
      </div>
      <div className="w-cols">
        <div className="w-form k-form">
          <div className="t-duechips" role="group" aria-label={tr("skFormatL", lang)}>
            {FORMATS.map((f) => (
              <button key={f} type="button" data-testid={`skill-format-${f}`} className={"t-chip" + (spec.format === f ? " active" : "")} aria-pressed={spec.format === f} onClick={() => set("format", f)}>
                {formatLabel(f, lang)}
              </button>
            ))}
          </div>
          <p className="muted small">{formatHint(spec.format, lang)}</p>
          {/* Headings follow the model's language, not the interface (focus group). */}
          <div className="t-duechips" role="group" aria-label={tr("skLangL", lang)}>
            <span className="muted small">{tr("skLangL", lang)}</span>
            {FILE_LANGS.map(([l, label]) => (
              <button key={l} type="button" data-testid={`skill-lang-${l}`} className={"t-chip" + (fileLang === l ? " active" : "")} aria-pressed={fileLang === l} onClick={() => set("lang", l)}>
                {label}
              </button>
            ))}
          </div>
          <label className="t-field">
            <span className="muted small">{spec.format === "skill" ? tr("skNameMachine", lang) : tr("skNameL", lang)}</span>
            <span className="k-namerow">
              <input autoFocus data-testid="skill-name" value={spec.name} onChange={(e) => set("name", e.target.value)} aria-label={tr("skNameL", lang)} placeholder={spec.format === "skill" ? "code-review" : tr("skNamePh", lang)} />
              {spec.format === "skill" && spec.name.trim() && slugify(spec.name) !== spec.name && slugify(spec.name) && (
                <button type="button" className="g-btn sm" data-testid="skill-slug" onClick={() => set("name", slugify(spec.name))}>
                  → {slugify(spec.name)}
                </button>
              )}
            </span>
          </label>
          {field("description", tr("skDescL", lang), tr("skDescPh", lang), "skill-desc", 2)}
          {spec.format === "skill" && <span className={"muted small" + (descLen > SKILL_DESC_MAX ? " g-status-bad" : "")}>{descLen} / {SKILL_DESC_MAX}</span>}
          {field("whenToUse", tr("skWhenL", lang), tr("skWhenPh", lang), "skill-when", 2)}
          {field("steps", tr("skStepsL", lang), tr("skStepsPh", lang), "skill-steps", 5)}
          {field("rules", tr("skRulesL", lang), tr("skRulesPh", lang), "skill-rules", 4)}
          {field("output", tr("skOutputL", lang), tr("skOutputPh", lang), "skill-output", 2)}
          <div className="k-examples">
            <span className="muted small">{tr("skExamplesL", lang)}</span>
            {spec.examples.map((ex, i) => (
              <div key={i} className="k-example" data-testid="skill-example">
                <textarea className="g-area" rows={2} value={ex.input} placeholder={tr("skExIn", lang)} aria-label={`${tr("skExIn", lang)} ${i + 1}`} onChange={(e) => set("examples", spec.examples.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))} />
                <textarea className="g-area" rows={2} value={ex.output} placeholder={tr("skExOut", lang)} aria-label={`${tr("skExOut", lang)} ${i + 1}`} onChange={(e) => set("examples", spec.examples.map((x, j) => (j === i ? { ...x, output: e.target.value } : x)))} />
                <button type="button" className="g-linkbtn" onClick={() => set("examples", spec.examples.filter((_, j) => j !== i))}>
                  {tr("deleteNote", lang)}
                </button>
              </div>
            ))}
            <button type="button" className="g-btn sm" data-testid="skill-example-add" onClick={() => set("examples", [...spec.examples, { input: "", output: "" }])}>
              {tr("skExAdd", lang)}
            </button>
          </div>
        </div>

        <aside className="w-result">
          <div className="i-res-h">{file}</div>
          <pre className="w-prev mono k-preview" data-testid="skill-preview">{text}</pre>
          <div className="muted small">
            {text.length} {tr("charsT", lang)} · ≈ {estimateTokens(text)} {tr("tokensT", lang)}
          </div>
          {issues.length > 0 && (
            <ul className="k-lint" data-testid="skill-lint" role="status">
              {issues.map((i) => (
                <li key={i.id} className={i.level === "error" ? "g-status-bad" : "muted"}>
                  {i.level === "error" ? "✕ " : "! "}
                  {issueText(i.id, lang)}
                </li>
              ))}
            </ul>
          )}
          <button type="button" data-testid="skill-copy" className="g-btn primary w-copy" onClick={async () => { await copyText(text); notify(tr("toastCopied", lang)); }}>
            {tr("copyPrompt", lang)}
          </button>
          <div className="w-result-row">
            <button type="button" className="g-btn sm" data-testid="skill-download" onClick={() => notify(downloadText(text, file) ? tr("toastDownloaded", lang).replace("{f}", file) : tr("toastBackupFailed", lang))}>
              {tr("skDownload", lang)} {file}
            </button>
            <button type="button" className="g-btn sm" data-testid="skill-save" disabled={blocking} title={blocking ? tr("skFixFirst", lang) : undefined} onClick={() => onSave(spec, text)}>
              {saveLabel}
            </button>
            <button type="button" className="g-btn sm ghost" onClick={onCancel}>
              {tr("cancelBtn", lang)}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
