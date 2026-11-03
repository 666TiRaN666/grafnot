/** [[Title]] links kept in a note's text (focus group: a link cut out of
 * the sentence left it broken). The relation itself lives in linkedIds; the
 * text marker is what the reader sees and follows. Pure helpers only: the
 * editor extension lives in wikiLinks.ts so the app shell stays Tiptap-free. */
import type { JSONContent } from '@tiptap/core';

/** Fresh regex per use: a shared /g instance would leak lastIndex. */
export const WIKI_RE = () => /\[\[([^[\]\n]+)\]\]/g;

/** Title of the marker covering `offset` in a text run, or null. */
export function wikiLinkAt(text: string, offset: number): string | null {
  for (const m of text.matchAll(WIKI_RE())) {
    const start = m.index ?? 0;
    if (offset >= start && offset <= start + m[0].length) return (m[1] ?? '').trim() || null;
  }
  return null;
}

/** Rewrite [[old]] -> [[next]] in a Tiptap document and its plain text.
 * Null when the note never mentions the old title (nothing to save). */
export function renameWikiLinks(content: JSONContent | string, text: string, old: string, next: string): { content: JSONContent | string; text: string } | null {
  const from = `[[${old}]]`;
  if (!text.includes(from)) return null;
  const to = `[[${next}]]`;
  const walk = (n: JSONContent): JSONContent => ({
    ...n,
    ...(typeof n.text === 'string' ? { text: n.text.split(from).join(to) } : {}),
    ...(Array.isArray(n.content) ? { content: n.content.map(walk) } : {}),
  });
  return { content: typeof content === 'string' ? content.split(from).join(to) : walk(content), text: text.split(from).join(to) };
}