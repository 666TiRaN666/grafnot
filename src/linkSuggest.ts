import type { Note } from "./store";

export type LinkCandidate = Pick<Note, "id" | "title" | "updated"> & { text?: string };

/** Filter kept from the old link dialog: title+body match, source excluded. */
export function matchLinkCandidate(n: Pick<Note, "id" | "title"> & { text?: string }, excludeId: string, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return n.id !== excludeId && `${n.title} ${n.text ?? ""}`.toLowerCase().includes(needle);
}

/**
 * Query of an open `[[` mention from the document text before the caret.
 * Null when there is no open pair (closed `]]`, newline or nested `[` reset it).
 */
export function parseBracketQuery(before: string): string | null {
  const m = /\[\[([^[\]\n]*)$/.exec(before);
  return m ? (m[1] ?? "") : null;
}

/** Matches recent-first: the `[[` suggest lists recently edited notes on top. */
export function rankLinkSuggest<T extends LinkCandidate>(notes: T[], excludeId: string, q: string): T[] {
  return notes.filter((n) => matchLinkCandidate(n, excludeId, q)).sort((a, b) => b.updated - a.updated);
}
