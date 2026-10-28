/** Profile boot: store creation, registry adoption and store normalization.
 * Moved 1:1 out of App.tsx (STAGE_04): no UI, no logic changes. App only
 * imports from here. Pure over storage except for the window.localStorage
 * default, same as before the move.
 */
import type { Lang } from "../i18n";
import { tr } from "../i18n";
import {
  LEGACY_STORE_KEY,
  SCHEMA_VERSION,
  loadStoreResult,
  saveStore,
  storeKeyFor,
} from "../store";
import type { Store, StoreStorage } from "../store";
import {
  PROFILES_KEY,
  createProfile,
  emptyRegistry,
  loadProfilesResult,
  recoverRegistryFromStores,
  saveProfiles,
} from "../profiles";
import type { ProfileRegistry } from "../profiles";
import { migrateLegacyPrefs, prefKeyFor } from "../prefs";
import { migrateImageSavesToTemplates } from "../promptUtils";

export function freshStore(): Store {
  return { notes: [], tasks: [], trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId: '' };
}

/** Registry boot result plus the dropped-link count of an adopted legacy
 * payload (0 when there was nothing to adopt), whether the registry was
 * rebuilt from store keys (STAGE_08: App toasts it once) and the legacy
 * adoption outcome (STAGE_09): none (no legacy involved), done (verified),
 * failed (the copy did not fit — registry untouched, user decides),
 * blocked (legacy unreadable — registry created only on explicit choice). */
export type AdoptionStatus = 'none' | 'done' | 'failed' | 'blocked';

export interface BootResult {
  registry: ProfileRegistry;
  droppedLinks: number;
  recovered: boolean;
  adoption: AdoptionStatus;
  registryFailed?: boolean;
  registryReadFailed?: boolean;
}

/** Canonical form for write verification: key order must not matter, our own
 * raws are canonical but a quota-truncated or foreign write is not. */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** Read-back check: the stored payload must equal the expected object
 * (finding A4 — a silent short write must never pass as adoption). */
export function verifyStoredMatches(
  storage: Pick<StoreStorage, 'getItem'>,
  profileId: string,
  expected: Record<string, unknown>,
): boolean {
  try {
    const raw = storage.getItem.bind(storage)(storeKeyFor(profileId));
    if (!raw) return false;
    return JSON.stringify(canonicalize(JSON.parse(raw))) === JSON.stringify(canonicalize(expected));
  } catch {
    return false;
  }
}

/** Whether a pre-profiles legacy payload is still sitting around. */
export function hasLegacyKey(storage?: Pick<StoreStorage, 'getItem'>): boolean {
  try {
    const get = storage?.getItem.bind(storage) ?? window.localStorage.getItem.bind(window.localStorage);
    return get(LEGACY_STORE_KEY) !== null;
  } catch {
    return false;
  }
}

/** A boot transaction is committed only after registry read-back succeeds. */
function saveBootRegistry(registry: ProfileRegistry): boolean {
  if (!saveProfiles(registry)) return false;
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    return raw !== null && JSON.stringify(canonicalize(JSON.parse(raw))) === JSON.stringify(canonicalize(registry));
  } catch {
    return false;
  }
}

const ADOPTION_PENDING_KEY = 'grafnot-adoption-pending-v1';

/** Keep the destination stable across interrupted migrations (legacy IDs may be generated). */
function pendingAdoption(): ProfileRegistry['profiles'][number] | null {
  try {
    const pending = JSON.parse(window.localStorage.getItem(ADOPTION_PENDING_KEY) ?? 'null');
    return pending && typeof pending.id === 'string' && /^pf[0-9]+(?:-[0-9]+)?$/.test(pending.id)
      && typeof pending.name === 'string' && typeof pending.created === 'number' ? pending : null;
  } catch {
    return null;
  }
}

function registryFailure(): BootResult {
  return { registry: emptyRegistry(), droppedLinks: 0, recovered: false, adoption: 'none', registryFailed: true };
}

/** First launch with no registry: adopt the legacy single store into a default
 * profile. Idempotent: once the registry is saved, later loads return early,
 * so a repeated initializer run (StrictMode) cannot duplicate anything.
 * A corrupt registry is never paved over with a fresh default (finding B1):
 * it is backed up first, then rebuilt from per-profile store keys; only when
 * no store key exists does the launch continue as first launch.
 * Legacy adoption (finding A4) saves the registry ONLY after a verified
 * write (read-back equals the written payload): a short copy leaves the
 * registry unsaved, the legacy key intact and no phantom profile in memory.
 * An unreadable legacy blocks with no registry at all — App asks the user. */
export function ensureRegistry(): BootResult {
  const res = loadProfilesResult();
  if (res.status === 'unavailable') return { ...registryFailure(), registryReadFailed: true };
  if (res.status === 'ok' && res.registry.profiles.length > 0) {
    return { registry: res.registry, droppedLinks: 0, recovered: false, adoption: 'none' };
  }
  let lang: Lang = 'RU';
  try {
    const v = window.localStorage.getItem(prefKeyFor("lang"));
    if (v === 'EN' || v === 'KZ') lang = v;
  } catch {
    /* ignore */
  }
  const pending = pendingAdoption();
  if (res.status === 'corrupt' && res.raw !== undefined && !pending) {
    writeCorruptBackup(window.localStorage, PROFILES_KEY, res.raw);
    let keys: string[] = [];
    try {
      keys = Object.keys(window.localStorage);
    } catch {
      keys = [];
    }
    const rebuilt = recoverRegistryFromStores(keys, (n) => `${tr('profileRecovered', lang)} ${n}`);
    if (rebuilt.profiles.length > 0) {
      if (!saveBootRegistry(rebuilt)) return registryFailure();
      return { registry: rebuilt, droppedLinks: 0, recovered: true, adoption: 'none' };
    }
  }
  let keys: string[] = [];
  try {
    keys = Object.keys(window.localStorage);
  } catch { /* an unavailable registry cannot be committed below */ }
  const candidates = recoverRegistryFromStores(keys, (n) => 'profile ' + n);
  // Reserve every existing store id, including copies from a previous failed boot.
  const profile = pending ?? createProfile(candidates, tr('profileDefault', lang)).profile;
  const registry: ProfileRegistry = { profiles: [profile], activeId: profile.id };
  const leg = loadStoreResult(undefined, window.localStorage);
  if (leg.status === 'ok' && leg.store) {
    const expected = { ...(leg.rest ?? {}), ...leg.store, schemaVersion: SCHEMA_VERSION };
    try {
      const rawPending = JSON.stringify(profile);
      window.localStorage.setItem(ADOPTION_PENDING_KEY, rawPending);
      if (window.localStorage.getItem(ADOPTION_PENDING_KEY) !== rawPending) throw new Error('adoption destination was not saved');
    } catch {
      return { registry: emptyRegistry(), droppedLinks: 0, recovered: false, adoption: 'failed' };
    }
    const wrote = saveStore(leg.store, profile.id, window.localStorage, { rest: leg.rest });
    if (!wrote || !verifyStoredMatches(window.localStorage, profile.id, expected)) {
      // Quota or short write: registry stays unsaved, legacy stays intact,
      // memory holds no phantom profile — App shows the blocking screen.
      return { registry: emptyRegistry(), droppedLinks: 0, recovered: false, adoption: 'failed' };
    }
    if (!saveBootRegistry(registry)) return registryFailure();
    const movedPrefs = migrateLegacyPrefs(profile.id, window.localStorage);
    try {
      const del = window.localStorage.removeItem.bind(window.localStorage);
      del(LEGACY_STORE_KEY);
      for (const base of movedPrefs) del(base);
      del(ADOPTION_PENDING_KEY);
    } catch {
      /* ignore */
    }
    return {
      registry,
      droppedLinks: (leg.droppedLinks ?? 0) + (leg.droppedItems ?? 0),
      recovered: false,
      adoption: 'done',
    };
  }
  if (leg.status === 'corrupt' || leg.status === 'future') {
    // Unreadable legacy: no registry, legacy key untouched, user decides.
    return { registry: emptyRegistry(), droppedLinks: 0, recovered: false, adoption: 'blocked' };
  }
  if (!saveBootRegistry(registry)) return registryFailure();
  const movedPrefs = migrateLegacyPrefs(profile.id, window.localStorage);
  try {
    for (const base of movedPrefs) window.localStorage.removeItem(base);
  } catch {
    /* ignore */
  }
  return { registry, droppedLinks: 0, recovered: false, adoption: 'none' };
}

/** Module-level boot cache: the useState initializer may run twice
 * (StrictMode remount), but the IO above happens exactly once per page load. */
let cachedRegistry: BootResult | null = null;

export function ensureRegistryCached(): BootResult {
  if (!cachedRegistry) cachedRegistry = ensureRegistry();
  return cachedRegistry;
}

/** Test-only: drop the boot cache so a fresh fake storage can boot again. */
export function resetRegistryCache(): void {
  cachedRegistry = null;
}

/** Blocked-store reason: unreadable payload vs newer schema. */
export type BlockReason = 'corrupt' | 'future' | 'unavailable';

/** Banner payload: the app shows it instead of the page, autosave stays off. */
export interface StoreBlocked {
  reason: BlockReason;
  raw?: string;
  backupKey: string | null;
}

export interface ProfileStoreOk {
  kind: 'ok';
  store: Store;
  rest: Record<string, unknown>;
  droppedLinks: number;
  droppedItems: number;
}

export interface ProfileStoreBlocked {
  kind: 'blocked';
  reason: BlockReason;
  raw?: string;
  backupKey: string | null;
}

/** Timestamped copy of unreadable data; at most 2 per source key (oldest
 * pruned). Identical content reuses the existing backup (StrictMode remount
 * and repeated entry must not multiply copies). Null when even the backup
 * cannot be written (quota) — the caller toasts that separately. */
export function writeCorruptBackup(
  storage: Pick<StoreStorage, 'getItem' | 'setItem' | 'removeItem'>,
  key: string,
  raw: string,
): string | null {
  const prefix = `${key}:corrupt-`;
  let keys: string[] = [];
  try {
    keys = Object.keys(storage).filter((k) => k.startsWith(prefix));
  } catch {
    keys = [];
  }
  try {
    for (const k of keys) {
      if (storage.getItem(k) === raw) return k;
    }
  } catch {
    /* ignore */
  }
  let name = '';
  try {
    name = `${prefix}${Date.now()}`;
    let guard = 0;
    while (keys.includes(name) && guard++ < 10) name = `${prefix}${Date.now()}_${guard}`;
    storage.setItem(name, raw);
  } catch {
    return null;
  }
  keys.push(name);
  keys.sort();
  while (keys.length > 2) {
    const drop = keys.shift() as string;
    try {
      storage.removeItem(drop);
    } catch {
      break;
    }
  }
  return name;
}

/** Load one profile store with backup-on-failure. Corrupt/future payloads
 * come back blocked (the caller shows the banner and disables autosave);
 * read failures block without a fabricated payload; only absent keys start empty. */
export function loadProfileStore(
  profileId: string,
  storage?: Pick<StoreStorage, 'getItem' | 'setItem' | 'removeItem'>,
): ProfileStoreOk | ProfileStoreBlocked {
  let backend: Pick<StoreStorage, 'getItem' | 'setItem' | 'removeItem'>;
  let r: ReturnType<typeof loadStoreResult>;
  try {
    backend = storage ?? window.localStorage;
    r = loadStoreResult(profileId, backend);
  } catch {
    return { kind: 'blocked', reason: 'unavailable', backupKey: null };
  }
  const key = storeKeyFor(profileId);
  if (r.status === 'ok' && r.store) {
    return { kind: 'ok', store: r.store, rest: r.rest ?? {}, droppedLinks: r.droppedLinks, droppedItems: r.droppedItems };
  }
  if ((r.status === 'corrupt' || r.status === 'future') && r.raw !== undefined) {
    return { kind: 'blocked', reason: r.status, raw: r.raw, backupKey: writeCorruptBackup(backend, key, r.raw) };
  }
  if (r.status === 'absent') {
    return { kind: 'ok', store: freshStore(), rest: {}, droppedLinks: 0, droppedItems: 0 };
  }
  return { kind: 'blocked', reason: 'unavailable', backupKey: null };
}

/** Autosave gate: blocked never writes; an untouched boot store writes
 * nothing unless a failed snapshot awaits retry. */
export function shouldPersist(dirty: boolean, blocked: boolean, pending: boolean): boolean {
  if (blocked) return false;
  return dirty || pending;
}

/** Header save status: saved (last write ok) / pending (snapshot armed) /
 * failed (a snapshot is unsaved after an error; sticky until success) /
 * conflict (storage moved in another tab; nothing written silently). */
export type SaveState = 'saved' | 'pending' | 'failed' | 'conflict';
export type SaveEvent = 'edit' | 'ok' | 'fail' | 'retry' | 'reset' | 'conflict';

/** Pure save-status transition. Failed and conflicted statuses survive edits
 * (the outstanding problem is still there) and clear only on ok/reset. */
export function nextSaveState(prev: SaveState, event: SaveEvent): SaveState {
  switch (event) {
    case 'edit':
      return prev === 'failed' || prev === 'conflict' ? prev : 'pending';
    case 'ok':
      return 'saved';
    case 'fail':
      return prev === 'conflict' ? 'conflict' : 'failed';
    case 'retry':
      return 'pending';
    case 'conflict':
      return 'conflict';
    case 'reset':
      return 'saved';
  }
}

/** Content equality ignoring activeId: opening a note in another tab
 * rewrites the key with view state only. Such moves must neither block our
 * writes nor toast-spam the other tab; real content diffs still conflict.
 * Comparison is canonical (key order ignored); unparseable payloads still
 * fail closed to "different". */
export function sameStoreContent(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    const pa = JSON.parse(a) as Record<string, unknown>;
    const pb = JSON.parse(b) as Record<string, unknown>;
    if (!pa || typeof pa !== 'object' || Array.isArray(pa)) return false;
    if (!pb || typeof pb !== 'object' || Array.isArray(pb)) return false;
    pa.activeId = '';
    pb.activeId = '';
    return JSON.stringify(canonicalize(pa)) === JSON.stringify(canonicalize(pb));
  } catch {
    return false;
  }
}

/** Flush decision contract: nothing (no snapshot), stale (storage moved on —
 * content-compared, activeId-only moves don't count), write. Unit-tested;
 * flushSave implements the write leg. */
export function decideFlush(
  pending: { base: string | null } | null,
  storedRaw: string | null,
): 'nothing' | 'stale' | 'write' {
  if (!pending) return 'nothing';
  if (!sameStoreContent(pending.base, storedRaw)) return 'stale';
  return 'write';
}
/** Set when settleStore drops a dangling activeId; consumed once as a toast
 * (mount effect or enterProfile). An already-empty activeId is a clean
 * "nothing selected" state and never raises it, so the reset cannot loop. */
let activeIdWasReset = false;

/** Consume the pending activeId-reset signal (true exactly once per reset). */
export function consumeActiveIdReset(): boolean {
  if (!activeIdWasReset) return false;
  activeIdWasReset = false;
  return true;
}

/** Normalize a loaded store the same way for every entry path (reload, enter, switch). */
export function settleStore(s: Store | null): Store {
  if (!s) return freshStore();
  const promoted = migrateImageSavesToTemplates(s.prompts, s.customTpls);
  const activeOk = s.notes.some((n) => n.id === s.activeId);
  if (!activeOk && s.activeId !== '') activeIdWasReset = true;
  return {
    ...s,
    ...promoted,
    activeId: activeOk ? s.activeId : '',
  };
}
