import { describe, expect, it } from 'vitest';
import type { SkillSpec } from './data';
import { estimateTokens, lintSkill, renderSkill, skillFileName, slugify, uniqueSkillName } from './skillModel';

const spec: SkillSpec = {
  format: 'skill',
  name: 'code-review',
  description: 'Reviews a diff for bugs and risky changes',
  whenToUse: 'the user asks to review code or a pull request',
  steps: 'Read the diff\n\nList bugs first',
  rules: '- Quote file and line\nNo style nitpicks',
  output: 'A list of findings, most severe first',
  examples: [{ input: 'review my patch', output: '1. src/a.ts:4 — null deref' }],
};

describe('renderSkill', () => {
  it('SKILL.md: frontmatter with name and a description that says when to use it', () => {
    const md = renderSkill(spec, 'EN');
    expect(md.startsWith('---\nname: code-review\ndescription: Reviews a diff for bugs and risky changes. Use when the user asks to review code or a pull request.\n---\n')).toBe(true);
    expect(md).toContain('1. Read the diff\n2. List bugs first');
    expect(md).toContain('- Quote file and line\n- No style nitpicks');
    expect(md).toContain('review my patch');
  });
  it('a system prompt has no frontmatter and speaks to the model', () => {
    const md = renderSkill({ ...spec, format: 'system' }, 'RU');
    expect(md.startsWith('---')).toBe(false);
    expect(md).toContain('Reviews a diff for bugs and risky changes');
    expect(md).toContain('1. Read the diff');
  });
  it('AGENTS.md starts with a title and keeps the rules', () => {
    const md = renderSkill({ ...spec, format: 'agents' }, 'EN');
    expect(md.startsWith('# code-review')).toBe(true);
    expect(md).toContain('- No style nitpicks');
  });
  it('AGENTS.md keeps «when to use» (focus group: it was silently dropped)', () => {
    const md = renderSkill({ ...spec, format: 'agents' }, 'EN');
    expect(md).toContain('When to use: the user asks to review code or a pull request.');
  });
  it('the file language is its own choice, not the interface language', () => {
    const md = renderSkill({ ...spec, lang: 'EN' }, 'RU');
    expect(md).toContain('## Instructions');
    expect(md).toContain('Use when the user asks');
    expect(md).not.toContain('Порядок действий');
  });
  it('skips empty sections', () => {
    const md = renderSkill({ ...spec, rules: '', examples: [] }, 'EN');
    expect(md).not.toContain('## Rules');
    expect(md).not.toContain('## Examples');
  });
});

describe('lintSkill', () => {
  it('passes a complete skill', () => {
    expect(lintSkill(spec)).toEqual([]);
  });
  it('flags a bad machine name, a missing trigger and an over-long description', () => {
    const issues = lintSkill({ ...spec, name: 'Code Review!', whenToUse: '', description: 'x'.repeat(1100) });
    expect(issues.map((i) => i.id).sort()).toEqual(['descLong', 'name', 'when']);
  });
  it('the machine name only matters for SKILL.md', () => {
    expect(lintSkill({ ...spec, format: 'system', name: 'Любое имя' }).map((i) => i.id)).toEqual([]);
  });
});

describe('helpers', () => {
  it('slugify makes a valid skill name from free text', () => {
    expect(slugify('  Code Review: TS!  ')).toBe('code-review-ts');
  });
  it('file names follow the format', () => {
    expect(skillFileName('skill')).toBe('SKILL.md');
    expect(skillFileName('agents')).toBe('AGENTS.md');
    expect(skillFileName('system')).toBe('system-prompt.md');
  });
  it('a copy gets a name of its own', () => {
    expect(uniqueSkillName('code-review', ['other'], 'skill')).toBe('code-review');
    expect(uniqueSkillName('code-review', ['code-review'], 'skill')).toBe('code-review-2');
    expect(uniqueSkillName('code-review', ['code-review', 'code-review-2'], 'skill')).toBe('code-review-3');
    expect(uniqueSkillName('Ревьюер', ['Ревьюер'], 'system')).toBe('Ревьюер (2)');
  });
  it('estimates tokens, Cyrillic heavier than Latin', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd'.repeat(10))).toBe(10);
    expect(estimateTokens('абвг'.repeat(10))).toBeGreaterThan(10);
  });
});
