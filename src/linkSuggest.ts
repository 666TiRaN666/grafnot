import type { Note } from "./store";
import { matchesQuery } from "./textMatch";

export type LinkCandidate = Pick<Note, "id" | "title" | "updated"> & { text?: string };

/** Title or body match (the shared search rule), source excluded. */
export function matchLinkCandidate(n: Pick<Note, "id" | "title"> & { text?: string }, excludeId: string, q: string): boolean {
  return n.id !== excludeId && matchesQuery([n.title, n.text], q);
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
