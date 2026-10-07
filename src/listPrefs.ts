/** Shared per-list page sizes behind one localStorage key.
 * Lists are addressed by key so notes, tasks, map members and prompts
 * share one JSON map instead of several independent keys with copied logic.
 * The old bare prompts value under TPL_LIMIT_KEY is read as a fallback and
 * migrated into the map on the next save (backward compatible).
 */
export const TPL_LIMITS = [5, 10, 25, 50] as const;
export const TPL_LIMIT_KEY = "grafnot-tpl-limit";
export const TPL_LIMIT_DEFAULT = 10;

/** Single JSON map for all list limits (for example {"prompts":10}). */
export const LIST_PREFS_KEY = "grafnot-list-limits";

/** Per-profile prefs keys; the bare key stays the legacy/no-profile path. */
export function listPrefsKeyFor(profileId?: string): string {
  return profileId ? `${LIST_PREFS_KEY}:${profileId}` : LIST_PREFS_KEY;
}

/** Legacy bare prompts key, namespaced per profile once profiles land. */
export function tplLimitKeyFor(profileId?: string): string {
  return profileId ? `${TPL_LIMIT_KEY}:${profileId}` : TPL_LIMIT_KEY;
}

export type ListKey = "notes" | "tasks" | "mapMembers" | "prompts";

export function parseTplLimit(v: unknown): number {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return (TPL_LIMITS as readonly number[]).includes(n) ? n : TPL_LIMIT_DEFAULT;
}

export interface ListPrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function readMap(get: (key: string) => string | null, mapKey: string): Record<string, unknown> {
  try {
    const raw = get(mapKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Legacy prompts value, kept as a read fallback for old stores. */
export function loadTplLimit(storage?: { getItem(k: string): string | null }, profileId?: string): number {
  try {
    const get = storage?.getItem.bind(storage) ?? window.localStorage.getItem.bind(window.localStorage);
    return parseTplLimit(get(tplLimitKeyFor(profileId)));
  } catch {
    return TPL_LIMIT_DEFAULT;
  }
}

/** Legacy writer, kept so old import sites keep working. */
export function saveTplLimit(
  n: number,
  storage?: { setItem(k: string, v: string): void },
  profileId?: string,
): void {
  try {
    const set = storage?.setItem.bind(storage) ?? window.localStorage.setItem.bind(window.localStorage);
    set(tplLimitKeyFor(profileId), String(n));
  } catch {
  }
}

/** Limit for one list. Falls back to the legacy value for prompts, else default. */
export function loadListLimit(
  key: ListKey,
  storage?: Pick<ListPrefStorage, "getItem">,
  profileId?: string,
): number {
  try {
    const get = storage?.getItem.bind(storage) ?? window.localStorage.getItem.bind(window.localStorage);
    const map = readMap(get, listPrefsKeyFor(profileId));
    if (key in map) return parseTplLimit(map[key]);
    if (key === "prompts") return parseTplLimit(get(tplLimitKeyFor(profileId)));
    return TPL_LIMIT_DEFAULT;
  } catch {
    return TPL_LIMIT_DEFAULT;
  }
}

/** Persist one list limit. Migrates a legacy value into the map first so nothing is lost. */
export function saveListLimit(key: ListKey, n: number, storage?: ListPrefStorage, profileId?: string): void {
  try {
    const get = storage?.getItem.bind(storage) ?? window.localStorage.getItem.bind(window.localStorage);
    const set = storage?.setItem.bind(storage) ?? window.localStorage.setItem.bind(window.localStorage);
    const del = storage?.removeItem.bind(storage) ?? window.localStorage.removeItem.bind(window.localStorage);
    const mapKey = listPrefsKeyFor(profileId);
    const legacyKey = tplLimitKeyFor(profileId);
    const map = readMap(get, mapKey);
    const legacy = get(legacyKey);
    if (legacy !== null) {
      if (!("prompts" in map)) map["prompts"] = parseTplLimit(legacy);
      del(legacyKey);
    }
    map[key] = n;
    set(mapKey, JSON.stringify(map));
  } catch {
  }
}
