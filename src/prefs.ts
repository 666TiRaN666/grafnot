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
} as const;

export type PrefName = keyof typeof PREF_KEYS;

export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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
