import { LIST_PREFS_KEY, TPL_LIMIT_KEY, listPrefsKeyFor, tplLimitKeyFor } from "./listPrefs";

/** Bare localStorage keys for shell prefs; per profile they gain a :<profileId> suffix.
 * HomePage's hint key lives here too so every pref migrates through one helper.
 */
export const PREF_KEYS = {
  theme: "grafnot-theme",
  lang: "grafnot-lang",
  side: "grafnot-side",
  /** W5: explicit rail choice ('open'/'closed'); absent = auto (see ui/navMode). */
  sideMode: "grafnot-side-mode",
  right: "grafnot-right",
  ctx: "grafnot-ctx",
  addMode: "grafnot-add-mode",
  hint: "grafnot-hint-first",
  section: "grafnot-section",
  density: "grafnot-prompt-density",
  recentTags: "grafnot-recent-tags",
  /** Map pins per scope ('all', 'ungrouped' or a graph id): { scope: { noteId: {x, y} } }. */
  mapPins: "grafnot-map-pins",
  /** Trash auto-cleanup in days: '0' off (default), '30', '90'. */
  trashDays: "grafnot-trash-days",
} as const;

/** Allowed auto-cleanup periods; anything else reads as off. */
export const TRASH_DAY_CHOICES = [0, 30, 90] as const;
export type TrashDays = (typeof TRASH_DAY_CHOICES)[number];
export function parseTrashDays(v: string | null | undefined): TrashDays {
  return v === '30' ? 30 : v === '90' ? 90 : 0;
}

export type PrefName = keyof typeof PREF_KEYS;

export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser storage, or null where it cannot even be reached (blocked, sandboxed). */
function browserStorage(): PrefStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** One pref by its key (see prefKeyFor). A pref is a convenience, never data:
 * a storage that fails (private mode, blocked, quota) reads as the fallback. */
export function readPref(key: string, fallback: string, storage: Pick<PrefStorage, 'getItem'> | null = browserStorage()): string {
  try {
    return storage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Write one pref; a failed write is ignored (the choice holds for this session). */
export function writePref(key: string, value: string, storage: Pick<PrefStorage, 'setItem'> | null = browserStorage()): void {
  try {
    storage?.setItem(key, value);
  } catch {
    /* a pref is a convenience */
  }
}

/** A JSON pref; missing or unparsable reads as undefined (callers check the shape). */
export function readPrefJSON(key: string, storage: Pick<PrefStorage, 'getItem'> | null = browserStorage()): unknown {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    return value;
  } catch {
    return undefined;
  }
}

/** Storage key for one pref: bare without profile (legacy path), suffixed with profile. */
export function prefKeyFor(name: PrefName, profileId?: string): string {
  const base = PREF_KEYS[name];
  return profileId ? `${base}:${profileId}` : base;
}

/** Copy legacy bare prefs (shell prefs, list map, legacy tpl limit) into a profile
 * namespace. Pure copy: bare keys stay in place for the caller to remove after
 * the profile store is saved. Existing profile values are never overwritten.
 * Returns the bare key names that were actually copied.
 */
export function migrateLegacyPrefs(profileId: string, storage: PrefStorage): string[] {
  const migrated: string[] = [];
  try {
    const get = storage.getItem.bind(storage);
    const set = storage.setItem.bind(storage);
    const copy = (base: string, target: string): void => {
      if (get(target) !== null) return;
      const raw = get(base);
      if (raw === null) return;
      set(target, raw);
      migrated.push(base);
    };
    for (const base of Object.values(PREF_KEYS)) copy(base, `${base}:${profileId}`);
    copy(LIST_PREFS_KEY, listPrefsKeyFor(profileId));
    copy(TPL_LIMIT_KEY, tplLimitKeyFor(profileId));
  } catch {
    /* ignore */
  }
  return migrated;
}
