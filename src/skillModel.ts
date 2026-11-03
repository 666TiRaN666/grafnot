/** Skill builder model (pure): one structured spec rendered as an Agent
 * Skill (SKILL.md with YAML frontmatter), a system prompt, or project rules
 * (AGENTS.md / CLAUDE.md). Headings follow the UI language; the frontmatter
 * keys stay as the format requires. */
import type { Lang } from './i18n';
import type { SkillFormat, SkillSpec } from './data';

const H: Record<Lang, { steps: string; rules: string; output: string; examples: string; example: string; input: string; answer: string; when: string; use: string }> = {
  RU: { steps: 'Порядок действий', rules: 'Правила', output: 'Формат ответа', examples: 'Примеры', example: 'Пример', input: 'Запрос', answer: 'Ответ', when: 'Когда применять', use: 'Используй, когда' },
  EN: { steps: 'Instructions', rules: 'Rules', output: 'Output format', examples: 'Examples', example: 'Example', input: 'Input', answer: 'Output', when: 'When to use', use: 'Use when' },
  KZ: { steps: 'Әрекет тәртібі', rules: 'Ережелер', output: 'Жауап форматы', examples: 'Мысалдар', example: 'Мысал', input: 'Сұрау', answer: 'Жауап', when: 'Қашан қолдану', use: 'Мына жағдайда қолдан:' },
};

/** SKILL.md limits (Agent Skills): name ≤ 64 of [a-z0-9-], description ≤ 1024. */
export const SKILL_NAME_MAX = 64;
export const SKILL_DESC_MAX = 1024;
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const lines = (text: string): string[] =>
  text.split('\n').map((l) => l.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '')).filter(Boolean);
const sentence = (text: string): string => text.trim().replace(/[.\s]+$/, '');

/** Frontmatter value: quoted when YAML would misread it. */
function yamlValue(v: string): string {
  const one = v.replace(/\s+/g, ' ').trim();
  return /^[\s>|&*!%@`'"[\]{}#,-]|: |\s#/.test(one) ? JSON.stringify(one) : one;
}

/** The description a model sees first: what it does, then when to use it. */
export function skillDescription(spec: SkillSpec, uiLang: Lang): string {
  const lang = spec.lang ?? uiLang;
  const what = sentence(spec.description);
  const when = sentence(spec.whenToUse);
  return [what && `${what}.`, when && `${H[lang].use} ${when}.`].filter(Boolean).join(' ');
}

function body(spec: SkillSpec, lang: Lang): string[] {
  const h = H[lang];
  const out: string[] = [];
  const steps = lines(spec.steps);
  if (steps.length) out.push(`## ${h.steps}`, ...steps.map((s, i) => `${i + 1}. ${s}`), '');
  const rules = lines(spec.rules);
  if (rules.length) out.push(`## ${h.rules}`, ...rules.map((r) => `- ${r}`), '');
  if (spec.output.trim()) out.push(`## ${h.output}`, spec.output.trim(), '');
  const ex = spec.examples.filter((e) => e.input.trim() || e.output.trim());
  if (ex.length) {
    out.push(`## ${h.examples}`);
    ex.forEach((e, i) => out.push(`### ${h.example} ${i + 1}`, `**${h.input}:** ${e.input.trim()}`, '', `**${h.answer}:** ${e.output.trim()}`, ''));
  }
  return out;
}

export function renderSkill(spec: SkillSpec, uiLang: Lang): string {
  const lang = spec.lang ?? uiLang;
  const h = H[lang];
  const desc = sentence(spec.description);
  const parts: string[] = [];
  if (spec.format === 'skill') {
    parts.push('---', `name: ${yamlValue(spec.name)}`, `description: ${yamlValue(skillDescription(spec, lang))}`, '---', '', `# ${spec.name}`, '');
  } else if (spec.format === 'agents') {
    parts.push(`# ${spec.name.trim() || 'AGENTS'}`, '');
  }
  if (spec.format !== 'skill') {
    if (desc) parts.push(`${desc}.`, '');
    if (spec.whenToUse.trim()) parts.push(`${h.when}: ${sentence(spec.whenToUse)}.`, '');
  }
  parts.push(...body(spec, lang));
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export type SkillIssueId = 'name' | 'desc' | 'descLong' | 'when' | 'steps';
export interface SkillIssue { id: SkillIssueId; level: 'error' | 'warn' }

/** Problems that make a file fail its format (error) or work worse (warn). */
export function lintSkill(spec: SkillSpec): SkillIssue[] {
  const out: SkillIssue[] = [];
  if (spec.format === 'skill') {
    const n = spec.name.trim();
    if (!n || n.length > SKILL_NAME_MAX || !NAME_RE.test(n)) out.push({ id: 'name', level: 'error' });
  }
  if (!spec.description.trim()) out.push({ id: 'desc', level: 'error' });
  else if (skillDescription(spec, 'EN').length > SKILL_DESC_MAX) out.push({ id: 'descLong', level: 'error' });
  if (spec.format === 'skill' && !spec.whenToUse.trim()) out.push({ id: 'when', level: 'warn' });
  if (lines(spec.steps).length === 0) out.push({ id: 'steps', level: 'warn' });
  return out;
}

/** A valid SKILL.md name from free text (Latin only; other letters drop). */
export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SKILL_NAME_MAX).replace(/-+$/, '');
}

/** A name not yet taken, so a copy of a built-in is told apart from it:
 * code-review → code-review-2 (SKILL.md names stay kebab-case). */
export function uniqueSkillName(name: string, taken: readonly string[], format: SkillFormat): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  for (let i = 2; ; i++) {
    const next = format === 'skill' ? `${name}-${i}` : `${name} (${i})`;
    if (!used.has(next)) return next;
  }
}

export function skillFileName(format: SkillFormat): string {
  return format === 'skill' ? 'SKILL.md' : format === 'agents' ? 'AGENTS.md' : 'system-prompt.md';
}

/** Rough token count: ~4 Latin chars or ~2 Cyrillic chars per token. An
 * estimate for budgeting, not a tokenizer. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cyr = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  return Math.ceil(cyr / 2 + (text.length - cyr) / 4);
}

export function emptySkill(format: SkillFormat = 'skill'): SkillSpec {
  return { format, name: '', description: '', whenToUse: '', steps: '', rules: '', output: '', examples: [] };
}
