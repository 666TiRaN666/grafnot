import { describe, expect, it } from 'vitest';
import { renameWikiLinks, wikiLinkAt, WIKI_RE } from './wikiText';

describe('wikiLinkAt', () => {
  it('finds the [[title]] under an offset in a text run', () => {
    const text = 'see [[Beta]] and [[Gamma note]]';
    expect(wikiLinkAt(text, 7)).toBe('Beta');
    expect(wikiLinkAt(text, 20)).toBe('Gamma note');
    expect(wikiLinkAt(text, 1)).toBeNull();
  });
  it('a fresh regex per use: no state leaks between calls', () => {
    expect([...'[[a]] [[b]]'.matchAll(WIKI_RE())].map((m) => m[1])).toEqual(['a', 'b']);
  });
});

describe('renameWikiLinks', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see [[Beta]] and [[Betamax]]' }] }] };
  it('rewrites only exact titles in the document and the plain text', () => {
    const r = renameWikiLinks(doc, 'see [[Beta]] and [[Betamax]]', 'Beta', 'Beta 2');
    expect(r).not.toBeNull();
    expect(r?.text).toBe('see [[Beta 2]] and [[Betamax]]');
    expect(JSON.stringify(r?.content)).toContain('[[Beta 2]]');
    expect(JSON.stringify(r?.content)).toContain('[[Betamax]]');
  });
  it('returns null when nothing refers to the old title', () => {
    expect(renameWikiLinks(doc, 'x', 'Gamma', 'Delta')).toBeNull();
  });
});
