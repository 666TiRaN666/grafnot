import { useMemo, useState } from "react";
import { loadListLimit, saveListLimit } from "./listPrefs";
import type { ListKey } from "./listPrefs";
import { useListNav } from "./useListNav";

export interface ListStateOptions<T> {
  key: ListKey;
  select: (query: string) => T[];
  limit?: number;
  onLimitChange?: (value: number) => void;
  onPick?: (item: T, index: number) => void;
  profileId?: string;
}

export interface ListState<T> {
  query: string;
  limit: number;
  shown: number;
  filtered: T[];
  visible: T[];
  nav: ReturnType<typeof useListNav>;
  changeQuery: (value: string) => void;
  changeLimit: (value: number) => void;
  showMore: () => void;
  ensureVisible: (index: number) => void;
  resetShown: () => void;
  resetNavigation: () => void;
}

/**
 * Shared list state: query string, page size, visible count, filtered and
 * visible rows plus keyboard navigation. Filtering itself stays on the
 * page: the select function keeps whatever matcher and order the list
 * already uses, the hook only slices and navigates. The limit is owned
 * here, except when a parent already owns it (prompts limit lives in App
 * because the settings modal edits it): then limit and onLimitChange make
 * the hook controlled without changing what the seg shows or persists.
 */
export function useListState<T>(opts: ListStateOptions<T>): ListState<T> {
  const [query, setQuery] = useState("");
  const [innerLimit, setInnerLimit] = useState<number>(() => loadListLimit(opts.key, undefined, opts.profileId));
  const [shown, setShown] = useState<number>(() => loadListLimit(opts.key, undefined, opts.profileId));
  const limit = opts.limit ?? innerLimit;
  // Filtering runs only when the query or the select function changes — not
  // on every parent render (typing in an unrelated input, clock tick, etc.).
  // Call sites keep select referentially stable (useCallback) so this hits.
  const select = opts.select;
  const filtered = useMemo(() => select(query), [select, query]);
  const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown]);
  const nav = useListNav(visible.length, (i) => {
    const e = visible[i];
    if (e) opts.onPick?.(e, i);
  });

  const resetShown = () => {
    setShown(limit);
  };
  const resetNavigation = () => {
    nav.reset();
  };
  const changeQuery = (value: string) => {
    setQuery(value);
    setShown(limit);
    nav.reset();
  };
  const changeLimit = (value: number) => {
    if (opts.onLimitChange) opts.onLimitChange(value);
    else setInnerLimit(value);
    setShown(value);
    saveListLimit(opts.key, value, undefined, opts.profileId);
    nav.reset();
  };
  const showMore = () => {
    setShown((s) => Math.min(s + limit, filtered.length));
  };
  const ensureVisible = (index: number) => {
    setShown((s) => Math.max(s, index + 1, limit));
  };

  return { query, limit, shown, filtered, visible, nav, changeQuery, changeLimit, showMore, ensureVisible, resetShown, resetNavigation };
}
