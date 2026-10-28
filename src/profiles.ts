/** Named data profiles: each profile owns an isolated store plus its own prefs.
 * The registry (profile list + active id) lives under PROFILES_KEY; the
 * per-profile store and prefs keys are derived from the profile id elsewhere.
 * Logic is pure over ProfileRegistry (inputs are never mutated); only load
 * and save touch storage, with the same injectable-storage convention as
 * listPrefs so tests stay hermetic.
 */
import { listPrefsKeyFor, tplLimitKeyFor } from "./listPrefs";
import type { PrefName } from "./prefs";
import { PREF_KEYS, prefKeyFor } from "./prefs";
import { LEGACY_STORE_KEY, storeKeyFor } from "./store";
export interface Profile {
  id: string;
  name: string;
  created: number;
}

export interface ProfileRegistry {
  profiles: Profile[];
  activeId: string;
}

export const PROFILES_KEY = "grafnot-profiles-v1";

export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ProfileDataKeys {
  store: string;
  prefs: string[];
}

/** Every storage key owned by a profile: its store plus all namespaced prefs.
 * The registry itself (PROFILES_KEY) and legacy bare keys are not included. */
export function profileKeysFor(profileId: string): ProfileDataKeys {
  return {
    store: storeKeyFor(profileId),
    prefs: [
      ...Object.keys(PREF_KEYS).map((name) => prefKeyFor(name as PrefName, profileId)),
      listPrefsKeyFor(profileId),
      tplLimitKeyFor(profileId),
    ],
  };
}

/** Remove every key owned by a profile. Fail-fast: the first failed removal
 * aborts with false and the store (deleted last) stays intact, so the data
 * is never half-gone. Never touches other profiles, the registry, or legacy
 * bare keys. A failure is reported (false), never swallowed: the caller must
 * surface it and keep the registry entry. */
export function removeProfileData(profileId: string, storage?: ProfileStorage): boolean {
  try {
    const get = storage?.getItem.bind(storage) ?? window.localStorage.getItem.bind(window.localStorage);
    const del = storage?.removeItem.bind(storage) ?? window.localStorage.removeItem.bind(window.localStorage);
    const { store, prefs } = profileKeysFor(profileId);
    // Prefs first, store last: when a pref removal fails we stop at once,
    // the store is still intact (finding B3).
    for (const key of [...prefs, store]) {
      try {
        if (get(key) === null) continue;
        del(key);
        if (get(key) !== null) return false;
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function emptyRegistry(): ProfileRegistry {
  return { profiles: [], activeId: "" };
}

function isProfile(v: unknown): v is Profile {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === "string" && p.id !== "" && typeof p.name === "string";
}

/** Registry read result: corrupt payloads (broken JSON, foreign shape, any
 * invalid element) come back 'corrupt' with the raw text instead of a silent
 * empty registry (finding B1). Only null is absent; read failures are unavailable. */
export type RegistryStatus = 'ok' | 'absent' | 'corrupt' | 'unavailable';

export interface RegistryResult {
  status: RegistryStatus;
  registry: ProfileRegistry;
  raw?: string;
}

export function loadProfilesResult(storage?: Pick<ProfileStorage, "getItem">): RegistryResult {
  let raw: string | null = null;
  try {
    const get = storage?.getItem.bind(storage) ?? window.localStorage.getItem.bind(window.localStorage);
    raw = get(PROFILES_KEY);
    if (raw === null) return { status: 'absent', registry: emptyRegistry() };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'corrupt', registry: emptyRegistry(), raw };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: 'corrupt', registry: emptyRegistry(), raw };
    }
    const rec = parsed as Record<string, unknown>;
    if (!Array.isArray(rec.profiles)) return { status: 'corrupt', registry: emptyRegistry(), raw };
    const profiles: Profile[] = [];
    for (const item of rec.profiles) {
      if (!isProfile(item)) return { status: 'corrupt', registry: emptyRegistry(), raw };
      profiles.push({
        id: item.id,
        name: item.name,
        created: typeof item.created === "number" ? item.created : 0,
      });
    }
    const active = typeof rec.activeId === "string" ? rec.activeId : "";
    const activeOk = profiles.some((p) => p.id === active);
    return { status: 'ok', registry: { profiles, activeId: activeOk ? active : (profiles[0]?.id ?? "") } };
  } catch {
    return raw !== null ? { status: 'corrupt', registry: emptyRegistry(), raw } : { status: 'unavailable', registry: emptyRegistry() };
  }
}

/** Read the registry; corrupt or foreign shapes fall back to empty (never throws). */
export function loadProfiles(storage?: Pick<ProfileStorage, "getItem">): ProfileRegistry {
  return loadProfilesResult(storage).registry;
}

/** Rebuild a registry from per-profile store keys when the registry itself
 * is unreadable (finding B1). Pure over an explicit key list; deterministic
 * (sorted ids, activeId = first). Never candidates: the legacy bare key
 * (hands off — stage 09 owns adoption) and any suffixed key (id must not
 * contain ':', which excludes ':corrupt-*' backups and drafts). Stores carry
 * no per-profile created metadata, hence created 0. */
export function recoverRegistryFromStores(keys: readonly string[], nameFor: (index: number) => string): ProfileRegistry {
  const prefix = "grafnot-store-";
  const ids = Array.from(
    new Set(
      keys
        .filter((k) => k.startsWith(prefix) && k !== LEGACY_STORE_KEY)
        .map((k) => k.slice(prefix.length))
        .filter((id) => id !== "" && !id.includes(":")),
    ),
  ).sort();
  const profiles = ids.map((id, i) => ({ id, name: nameFor(i + 1), created: 0 }));
  return { profiles, activeId: profiles[0]?.id ?? "" };
}

/** Persist the registry; false when the write failed (finding B2: the error
 * is reported, never swallowed — the caller must roll back and abort). */
export function saveProfiles(reg: ProfileRegistry, storage?: ProfileStorage): boolean {
  try {
    const set = storage?.setItem.bind(storage) ?? window.localStorage.setItem.bind(window.localStorage);
    set(PROFILES_KEY, JSON.stringify({ profiles: reg.profiles, activeId: reg.activeId }));
    return true;
  } catch {
    return false;
  }
}

export type RegistryUpdate = { status: 'ok'; registry: ProfileRegistry } | { status: 'failed' | 'invalid' };
type RegistryLock = (work: () => RegistryUpdate) => Promise<RegistryUpdate>;

/** Serialize UI registry mutations across tabs; run the mutation against fresh data.
 * Without a shared lock, refuse the write rather than race another tab.
 */
export async function updateProfiles(
  change: (current: ProfileRegistry) => ProfileRegistry,
  options: { storage?: ProfileStorage; lock?: RegistryLock; allowAbsent?: boolean } = {},
): Promise<RegistryUpdate> {
  const work = (): RegistryUpdate => {
    const loaded = loadProfilesResult(options.storage);
    if (loaded.status !== 'ok' && !(options.allowAbsent && loaded.status === 'absent')) return { status: 'failed' };
    let next: ProfileRegistry;
    try { next = change(loaded.registry); } catch { return { status: 'invalid' }; }
    if (!saveProfiles(next, options.storage)) return { status: 'failed' };
    const readBack = loadProfilesResult(options.storage);
    if (readBack.status !== 'ok' || JSON.stringify(readBack.registry) !== JSON.stringify(next)) return { status: 'failed' };
    return { status: 'ok', registry: next };
  };
  try {
    if (options.lock) return await options.lock(work);
    if (!globalThis.navigator?.locks) return { status: 'failed' };
    return await navigator.locks.request(PROFILES_KEY, { mode: 'exclusive' }, work);
  } catch { return { status: 'failed' }; }
}

/** Unique display name; mirrors note-title dedup ("Name", "Name 2", ...). Throws on blank. */
export function uniqueProfileName(profiles: Profile[], base: string, ignoreId?: string): string {
  const clean = base.trim();
  if (!clean) throw new Error("profile name required");
  const taken = new Set(profiles.filter((p) => p.id !== ignoreId).map((p) => p.name));
  if (!taken.has(clean)) return clean;
  let i = 2;
  while (taken.has(`${clean} ${i}`)) i++;
  return `${clean} ${i}`;
}

function uniqueProfileId(profiles: Profile[], base: string): string {
  const taken = new Set(profiles.map((p) => p.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Add a profile and make it active. Returns the new registry plus the profile. */
export function createProfile(
  reg: ProfileRegistry,
  name: string,
  now: number = Date.now(),
): { registry: ProfileRegistry; profile: Profile } {
  const profile: Profile = {
    id: uniqueProfileId(reg.profiles, `pf${now}`),
    name: uniqueProfileName(reg.profiles, name),
    created: now,
  };
  return { registry: { profiles: [...reg.profiles, profile], activeId: profile.id }, profile };
}

/** Rename a profile; a name taken by another profile gets a numeric suffix. */
export function renameProfile(reg: ProfileRegistry, id: string, name: string): ProfileRegistry {
  const target = reg.profiles.find((p) => p.id === id);
  if (!target) throw new Error("profile not found");
  const next = uniqueProfileName(reg.profiles, name, id);
  return { ...reg, profiles: reg.profiles.map((p) => (p.id === id ? { ...p, name: next } : p)) };
}

/** Remove a profile; the active id falls back to the first remaining profile. */
export function deleteProfile(reg: ProfileRegistry, id: string): ProfileRegistry {
  if (!reg.profiles.some((p) => p.id === id)) throw new Error("profile not found");
  if (reg.profiles.length <= 1) throw new Error("cannot delete the last profile");
  const profiles = reg.profiles.filter((p) => p.id !== id);
  const activeId = reg.activeId === id ? (profiles[0]?.id ?? "") : reg.activeId;
  return { profiles, activeId };
}

/** Switch the active profile. */
export function setActiveProfile(reg: ProfileRegistry, id: string): ProfileRegistry {
  if (!reg.profiles.some((p) => p.id === id)) throw new Error("profile not found");
  return { ...reg, activeId: id };
}
