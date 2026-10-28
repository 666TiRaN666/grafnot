import type { AIModel, LlmTpl } from './data';
import { LLM_TEMPLATES } from "./data";
import type { PromptSave } from "./store";
import { stripWeight } from "./imageTags";

/**
 * Risk boundary: a tag with model-knowledge rate below this is flagged.
 * A plain named constant on purpose — with a sample dictionary there is no
 * distribution to derive it from, so a computed threshold would be fiction.
 */
export const RISK_THRESHOLD = 50;

export function isRisky(rate: number): boolean {
  return rate < RISK_THRESHOLD;
}

/**
 * Model-specific prompt syntax (presentational only, no data behind it):
 * Pony — comma tags (danbooru style), SDXL — parenthesized tags,
 * Flux — natural-language list.
 */
export function renderPrompt(model: AIModel, tokens: string[]): string {
  if (tokens.length === 0) return '';
  if (model === 'SDXL') return tokens.map((t) => `(${t})`).join(', ');
  if (model === 'Flux') {
    // P3: weights set under Pony/SDXL are kept in tokens but stripped here —
    // Flux would otherwise copy brackets as literal text it does not understand.
    const clean = tokens.map((t) => stripWeight(t));
    if (clean.length === 1) return clean[0];
    return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
  }
  return tokens.join(', ');
}

/**
 * Inverse of renderPrompt for records without stored tokens (UX-03).
 * Every item wrapped in parens = SDXL (one layer stripped), a last item
 * joined by " and " = Flux, otherwise Pony. render(parse(body)) == body;
 * Flux renders lost their weights, so only the tags come back.
 */
export function parseImageBody(body: string): { model: AIModel; tokens: string[] } {
  const items = body.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (items.length === 0) return { model: 'Pony', tokens: [] };
  if (items.every((s) => s.startsWith('(') && s.endsWith(')'))) {
    return { model: 'SDXL', tokens: items.map((s) => s.slice(1, -1).trim()) };
  }
  const last = items[items.length - 1] as string;
  const cut = last.lastIndexOf(' and ');
  if (cut > 0) {
    return { model: 'Flux', tokens: [...items.slice(0, -1), last.slice(0, cut).trim(), last.slice(cut + 5).trim()] };
  }
  return { model: 'Pony', tokens: items };
}

/** Constructor state of an image template: stored fields, else parsed from the (filled) body. */
export function imageInit(tpl: LlmTpl): { model: AIModel; tokens: string[] } {
  const parsed = parseImageBody(fillBody(tpl.body, tpl.defaults));
  if (tpl.tokens) return { model: tpl.model ?? parsed.model, tokens: [...tpl.tokens] };
  return parsed;
}

/** Promote legacy image saves to editable templates while keeping their ids and note links. */
export function migrateImageSavesToTemplates(
  prompts: PromptSave[],
  customTpls: LlmTpl[],
): { prompts: PromptSave[]; customTpls: LlmTpl[] } {
  if (!prompts.some((p) => p.kind === 'image')) return { prompts, customTpls };

  const nextCustomTpls = [...customTpls];
  const usedIds = new Set(customTpls.map((tpl) => tpl.id));
  const nextPrompts: PromptSave[] = prompts.map((p): PromptSave => {
    if (p.kind !== 'image') return p;

    const baseId = `legacy-image-${p.id}`;
    let templateId = baseId;
    let suffix = 2;
    while (usedIds.has(templateId)) templateId = `${baseId}-${suffix++}`;
    usedIds.add(templateId);

    const model = p.model ?? 'Pony';
    const tokens = p.tokens ?? [];
    const body = renderPrompt(model, tokens) || p.title || 'prompt';
    nextCustomTpls.push({ id: templateId, name: p.title, body, defaults: {}, kind: 'image', model, tokens: [...tokens] });
    return { ...p, kind: 'llm', templateId, params: {} };
  });

  return { prompts: nextPrompts, customTpls: nextCustomTpls };
}

/** Fresh regex per call — a shared /g/ instance would leak lastIndex. */
const slotRe = () => /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Normalize a raw {{...}} capture: trim and collapse inner whitespace. */
const cleanSlot = (raw: string): string => raw.trim().replace(/\s+/g, ' ');

/**
 * {{named}} slots in order of first appearance (duplicates collapsed).
 * Any name is allowed except braces; '{{p1}}' has no special meaning.
 */
export function listSlots(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  body.replace(slotRe(), (_m, raw: string) => {
    const name = cleanSlot(raw);
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
    return '';
  });
  return out;
}

/**
 * Substitute slots with values; slots without a value become ''.
 * Text outside {{braces}} passes through untouched (may be multiline).
 */
export function fillBody(body: string, values: Record<string, string>): string {
  return body.replace(slotRe(), (_m, raw: string) => values[cleanSlot(raw)] ?? '');
}

/**
 * UX-02: a slot alone on a body line (code, query) or with a multiline
 * default takes a textarea; inline slots stay one-line inputs.
 */
export function isBlockSlot(body: string, slot: string, def = ''): boolean {
  if (def.includes('\n')) return true;
  return body.split('\n').some((line) => {
    const m = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(line);
    return !!m && cleanSlot(m[1]) === slot;
  });
}

/** Slots with no non-blank value — the card warns about these. */
export function missingSlots(body: string, values: Record<string, string>): string[] {
  return listSlots(body).filter((s) => !(values[s] ?? '').trim());
}

export interface BodyPart {
  text: string;
  slot?: string;
}

/**
 * Split a body into literal runs and slot markers for inline rendering
 * (card shows the pattern with field chips). Empty {{}} stays literal.
 */
export function splitSlots(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    const name = cleanSlot(m[1]);
    parts.push(name ? { text: m[0], slot: name } : { text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  if (parts.length === 0) parts.push({ text: body });
  return parts;
}

export type TplLike = Pick<LlmTpl, 'body' | 'defaults'>;

/**
 * Merge saved params over template defaults, in slot order.
 * Legacy v3 saves stored positional p1/p2 — they map to slot 1/2,
 * so saves made before the model change keep rendering correctly.
 */
export function resolveParams(tpl: TplLike, params: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = { ...tpl.defaults };
  listSlots(tpl.body).forEach((nm, i) => {
    merged[nm] = params[nm] ?? params[`p${i + 1}`] ?? tpl.defaults[nm] ?? '';
  });
  return merged;
}

/** Final text of an LLM-template copy/save/bind. */
export function renderSavedTpl(tpl: TplLike, params: Record<string, string>): string {
  return fillBody(tpl.body, resolveParams(tpl, params));
}

/** Short searchable preview of a saved prompt for Ctrl+K. Mirrors saved list rendering. */
export function promptPreview(p: PromptSave, custom: LlmTpl[]): string {
  if (p.kind === "image") return renderPrompt(p.model ?? "Pony", p.tokens ?? []);
  const t = custom.find((x) => x.id === p.templateId) ?? LLM_TEMPLATES.find((x) => x.id === p.templateId);
  if (!t) return p.title;
  return renderSavedTpl(t, p.params ?? {});
}

/**
 * User-editable template sanity check. Returns failing rule ids
 * ('name' | 'body'); empty means the template is usable.
 */
export function validateTemplate(d: { name: string; body: string }): string[] {
  const bad: string[] = [];
  if (!d.name.trim()) bad.push('name');
  if (!d.body.trim()) bad.push('body');
  return bad;
}

/** Display kind for thumbnail. Built-in art is inferred by id; custom image templates store an explicit kind. */
export type TplKind = "llm" | "image";

export function getTplKind(t: LlmTpl): TplKind {
  if (t.kind === "image") return "image";
  if (t.id === "art") return "image";
  return "llm";
}

/** Collapsed snippet for thumbnail. Single line, about 70 chars. */
export const TPL_SNIPPET_LEN = 70;

/** Full-row preview length: note snippets, link and map previews. */
export const PREVIEW_LEN = 140;

/** Compact search-row snippet length (Ctrl+K subs). */
export const SNIPPET_LEN = 40;

export function makeSnippet(body: string, n: number = TPL_SNIPPET_LEN): string {
  const one = body.replace(/\s+/g, " ").trim();
  if (one.length <= n) return one;
  return `${one.slice(0, n).trimEnd()}...`;
}

/** Case insensitive live filter over title plus body plus slot names. */
export function matchesTpl(t: Pick<LlmTpl, "name" | "body">, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const slots = listSlots(t.body).join(" ").toLowerCase();
  return `${t.name} ${t.body} ${slots}`.toLowerCase().includes(needle);
}

export type TplFilter = "all" | "mine" | "llm" | "image";

export interface TplEntry {
  tpl: LlmTpl;
  /** True for user templates from customTpls, false for builtins. */
  mine: boolean;
  kind: TplKind;
}

/** Merge builtins plus customs into one list. Builtins first, then customs. */
export function buildTplEntries(builtin: LlmTpl[], custom: LlmTpl[]): TplEntry[] {
  return [
    ...builtin.map((tpl) => ({ tpl, mine: false as const, kind: getTplKind(tpl) })),
    ...custom.map((tpl) => ({ tpl, mine: true as const, kind: getTplKind(tpl) })),
  ];
}

/** Apply ownership and kind chip plus search query. Pure, unit tested. */
export function filterTplEntries(entries: TplEntry[], q: string, f: TplFilter): TplEntry[] {
  const needle = q.trim().toLowerCase();
  return entries.filter((e) => {
    if (f === "mine" && !e.mine) return false;
    if (f === "llm" && e.kind !== "llm") return false;
    if (f === "image" && e.kind !== "image") return false;
    if (needle && !matchesTpl(e.tpl, needle)) return false;
    return true;
  });
}

export interface HiPart {
  text: string;
  hit: boolean;
}

/** Split text for mark highlighting of q. Case insensitive, no regex. */
export function splitHighlight(text: string, q: string): HiPart[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [{ text, hit: false }];
  const out: HiPart[] = [];
  const low = text.toLowerCase();
  let i = 0;
  for (;;) {
    const j = low.indexOf(needle, i);
    if (j < 0) {
      out.push({ text: text.slice(i), hit: false });
      break;
    }
    if (j > i) out.push({ text: text.slice(i, j), hit: false });
    out.push({ text: text.slice(j, j + needle.length), hit: true });
    i = j + needle.length;
  }
  return out.filter((p) => p.text);
}

/**
 * Cut AFTER highlighting: walk highlighted parts and stop at max chars, but
 * never split a matched fragment — a hit always survives whole (the margin).
 */
export function cutHiParts(parts: HiPart[], max: number): HiPart[] {
  const out: HiPart[] = [];
  let n = 0;
  let extended = false;
  for (const p of parts) {
    if (n >= max) {
      if (p.hit && !extended) {
        out.push(p);
        n += p.text.length;
        extended = true;
        continue;
      }
      break;
    }
    if (!p.hit && n + p.text.length > max) {
      if (n === 0) out.push({ text: p.text.slice(0, max), hit: false });
      break;
    }
    out.push(p);
    n += p.text.length;
  }
  return out;
}

/** Limit domain lives in listPrefs; re-exported here so existing prompt imports keep working. */
export { TPL_LIMITS, TPL_LIMIT_KEY, TPL_LIMIT_DEFAULT, parseTplLimit, loadTplLimit, saveTplLimit } from "./listPrefs";

/** Clamp active index after list shrinks. Shared by dropdowns and thumbnails. */
export function clampActive(active: number, len: number): number {
  if (len <= 0) return 0;
  return Math.min(Math.max(active, 0), len - 1);
}

/** Next active index for ArrowUp and ArrowDown. Shared, no duplication. */
export function moveActive(active: number, len: number, dir: 1 | -1): number {
  if (len <= 0) return 0;
  return Math.min(Math.max(active + dir, 0), len - 1);
}
