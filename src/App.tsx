import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { Lang, Page, Theme } from './i18n';
import { tr } from './i18n';
import type { LlmTpl, SearchItem } from './data';
import { LEGACY_STORE_KEY, SCHEMA_VERSION, appendPromptText, loadStoreResult, saveStore, storeKeyFor } from './store';
import type { CalcBlock, Graph, Note, PromptSave, Store } from './store';
import { ProfilePicker } from "./ProfilePicker";
import type { ProfileRegistry } from "./profiles";
import {
  createProfile,
  deleteProfile,
  removeProfileData,
  renameProfile,
  saveProfiles,
  setActiveProfile,
} from "./profiles";
import { prefKeyFor } from "./prefs";
import { ErrorBoundary, Icon, Modal, StatusBanner, ToastStack, dismissToast, fmtDue } from './widgets';
import type { ToastMsg } from './widgets';
import type { HomeActions } from './HomePage';
// The editors load on demand: Tiptap travels with HomePage, d3-force with
// MapPage. Named re-exports keep one network chunk per page module.
const HomePage = lazy(() => import('./HomePage').then((m) => ({ default: m.HomePage })));
const MapPage = lazy(() => import('./MapPage').then((m) => ({ default: m.MapPage })));
const MapLocked = lazy(() => import('./MapPage').then((m) => ({ default: m.MapLocked })));
const lazyFallback = (
  <div className="g-page" role="status" aria-busy="true">
    <span className="g-pulse" />
  </div>
);
import { TasksPage } from './TasksPage';
import { CalendarPage } from './CalendarPage';
import { NotesPage } from './NotesPage';
import { PromptPage } from './PromptPage';

import { useListNav } from "./useListNav";
import { exportRaw, exportMemory } from "./exportRaw";
import { SNIPPET_LEN, promptPreview } from "./promptUtils";
import { newId } from "./utils/newId";
import { consumeActiveIdReset, decideFlush, ensureRegistryCached, freshStore, hasLegacyKey, loadProfileStore, nextSaveState, sameStoreContent, settleStore, shouldPersist, verifyStoredMatches } from "./storage/profileBoot";
import type { SaveState, StoreBlocked } from "./storage/profileBoot";
import { TPL_LIMITS, TPL_LIMIT_DEFAULT, loadListLimit, saveListLimit } from "./listPrefs";
import { useArmConfirm } from "./useArmConfirm";

function load(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const LANGS: Lang[] = ['RU', 'EN', 'KZ'];
const MAP_UNLOCK = 20;

export default function App() {
  const readStoredRaw = (pid: string): string | null => {
    try {
      return window.localStorage.getItem(storeKeyFor(pid));
    } catch {
      return null;
    }
  };
  // Boot vessel: registry + the worst dropped-link count across legacy
  // adoption and the first profile load, so the mount effect can toast the
  // session max once with no module-global counter.
  const [boot] = useState(() => {
    const reg = ensureRegistryCached();
    return { registry: reg.registry, dropped: reg.droppedLinks, recovered: reg.recovered, adoption: reg.adoption };
  });
  const [registry, setRegistry] = useState<ProfileRegistry>(boot.registry);
  // A pre-profiles legacy payload still sitting around: the picker offers
  // download + verified import (STAGE_09). Refreshed whenever the picker
  // shows; cleared by a successful import.
  const [legacyPresent, setLegacyPresent] = useState<boolean>(() => hasLegacyKey());
  const [profileId, setProfileId] = useState<string | null>(() =>
    registry.profiles.length === 1 ? (registry.profiles[0]?.id ?? null) : null,
  );
  const [theme, setTheme] = useState<Theme>(() => (load(prefKeyFor('theme', profileId ?? undefined), 'light') === 'dark' ? 'dark' : 'light'));
  const [lang, setLang] = useState<Lang>(() => {
    const v = load(prefKeyFor('lang', profileId ?? undefined), 'RU');
    return v === 'EN' || v === 'KZ' || v === 'RU' ? v : 'RU';
  });
  const [page, setPage] = useState<Page>('home');
  const [sideOpen, setSideOpen] = useState(() => load(prefKeyFor('side', profileId ?? undefined), '1') === '1');
  const [rightOpen, setRightOpen] = useState(() => load(prefKeyFor('right', profileId ?? undefined), '1') === '1');
  const [bootStore] = useState(() => {
    if (!profileId)
      return { store: freshStore(), blocked: null as StoreBlocked | null, dropped: boot.dropped, lastSeen: null as string | null };
    const r = loadProfileStore(profileId);
    if (r.kind === 'blocked') {
      return {
        store: freshStore(),
        blocked: { reason: r.reason, raw: r.raw, backupKey: r.backupKey } as StoreBlocked,
        dropped: boot.dropped,
        lastSeen: null as string | null,
      };
    }
    return {
      store: settleStore(r.store),
      blocked: null as StoreBlocked | null,
      dropped: Math.max(boot.dropped, r.droppedLinks + r.droppedItems),
      lastSeen: readStoredRaw(profileId),
    };
  });
  const [store, setStore] = useState<Store>(bootStore.store);
  const [storeBlocked, setStoreBlocked] = useState<StoreBlocked | null>(bootStore.blocked);
  // Last store handed to the UI by a load path (boot/enter/create). A new
  // object identity means a real user mutation -> the run becomes dirty.
  const loadedStoreRef = useRef<Store>(bootStore.store);
  const dirtyRef = useRef(false);
  // Raw storage text at our last load or successful write. The only
  // staleness oracle: writes compare storage against this, never re-read
  // per edit (that getItem rode the hot path before).
  const lastSeenRawRef = useRef<string | null>(bootStore.lastSeen);
  const emptyConfirm = useArmConfirm();
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');

  const [trashOpen, setTrashOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [profileConfirmOpen, setProfileConfirmOpen] = useState(false);

  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const switchConfirm = useArmConfirm();
  const forceSwitchRef = useRef(false);
  const [tplLimit, setTplLimit] = useState<number>(() => loadListLimit("prompts", undefined, profileId ?? undefined));
  const changeTplLimit = (n: number) => {
    setTplLimit(n);
    saveListLimit("prompts", n, undefined, profileId ?? undefined);
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const idRef = useRef(1);
  const saveFailedRef = useRef(false);
  const toastTimersRef = useRef(new Map<number, number>());
  const pendingSaveRef = useRef<{ store: Store; profileId: string; lang: Lang } | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  // Trailing debounce alone starves under continuous edits (the timer keeps
  // resetting and a reload then amputates unsaved memory state). Cap the
  // stall deterministically: after several coalesced edits force a write
  // through. Counting edits (not milliseconds) keeps the cap immune to wall-
  // clock jumps.
  const skippedRef = useRef(0);
  const SAVE_DEBOUNCE = 400;
  const SAVE_COALESCE_MAX = 8;

  const { notes, tasks, trash, trashTasks, graphs, activeId } = store;
  // Derived per render before: find/filter over notes/tasks on every render
  // (each keystroke anywhere). Memoized — same values, fewer passes.
  const activeNote: Note | undefined = useMemo(() => notes.find((n) => n.id === activeId), [notes, activeId]);
  const openCount = useMemo(() => tasks.filter((t) => !t.done).length, [tasks]);


  // Toast queue: at most TOAST_VISIBLE on screen, the rest collapse into a
  // "+N" badge (ToastStack); auto-hide pauses while hovered so long texts
  // stay readable. Manual × and unmount cleanup unchanged.
  const TOAST_MS = 2600;
  const TOAST_QUEUED = 6;
  const toastEndsRef = useRef(new Map<number, number>());
  const armToast = (id: number, delay: number) => {
    toastEndsRef.current.set(id, Date.now() + delay);
    toastTimersRef.current.set(
      id,
      window.setTimeout(() => {
        toastTimersRef.current.delete(id);
        toastEndsRef.current.delete(id);
        setToasts((p) => dismissToast(p, id));
      }, delay),
    );
  };

  const notify = (text: string) => {
    const id = idRef.current++;
    setToasts((p) => [...p, { id, text }].slice(-TOAST_QUEUED));
    armToast(id, TOAST_MS);
  };

  const pauseToast = (id: number, hovering: boolean) => {
    if (hovering) {
      const t = toastTimersRef.current.get(id);
      if (t !== undefined) {
        window.clearTimeout(t);
        toastTimersRef.current.delete(id);
        const ends = toastEndsRef.current.get(id);
        if (ends !== undefined) toastEndsRef.current.set(id, Math.max(0, ends - Date.now()));
      }
    } else if (!toastTimersRef.current.has(id) && toastEndsRef.current.has(id)) {
      armToast(id, toastEndsRef.current.get(id) ?? TOAST_MS);
    }
  };

  const closeToast = (id: number) => {
    const t = toastTimersRef.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      toastTimersRef.current.delete(id);
    }
    toastEndsRef.current.delete(id);
    setToasts((p) => dismissToast(p, id));
  };

  /** Titles identify notes for links, so they must stay unique. */
  const uniqueTitle = (base: string, ignoreId?: string) => {
    const taken = new Set(notes.filter((n) => n.id !== ignoreId).map((n) => n.title));
    const clean = base.trim() || tr('newNoteTitle', lang);
    if (!taken.has(clean)) return clean;
    let i = 2;
    while (taken.has(`${clean} ${i}`)) i++;
    return `${clean} ${i}`;
  };

  // ----- store actions -----
  const createNote = (title: string, content: Note['content'] = '', text = '', linkedIds: string[] = []) => {
    const id = newId("n");
    const note: Note = { id, title: uniqueTitle(title), content, text, linkedIds, calcs: [], updated: Date.now() };
    setStore((s) => ({ ...s, notes: [note, ...s.notes], activeId: id }));
  };

  const newBlank = () => {
    createNote(tr('newNoteTitle', lang));
    setPage('home');
    notify(tr('toastNewNote', lang));
  };

  // Locked map opens the explanatory placeholder (progress + reason), not a
  // bare toast: the gate must never read as a bug. The toast stays too —
  // it carries the N/20 count other flows assert.
  const openMap = () => {
    if (notes.length >= MAP_UNLOCK) {
      setPage('map');
    } else {
      notify(`${tr('proLocked', lang)} (${notes.length}/${MAP_UNLOCK})`);
      setPage('map');
    }
  };

  const resetPanels = () => {
    setSideOpen(true);
    setRightOpen(true);
  };

  useEffect(() => {
    if (profileId) save(prefKeyFor('theme', profileId), theme);
  }, [theme, profileId]);

  useEffect(() => {
    if (profileId) save(prefKeyFor('lang', profileId), lang);
  }, [lang, profileId]);

  useEffect(() => {
    if (profileId) save(prefKeyFor('side', profileId), sideOpen ? '1' : '0');
  }, [sideOpen, profileId]);

  useEffect(() => {
    if (profileId) save(prefKeyFor('right', profileId), rightOpen ? '1' : '0');
  }, [rightOpen, profileId]);

  // Synchronous write of the latest debounced snapshot. True when written or
  // when there is nothing (or nothing writable) to write; false on write
  // failure AND on cross-tab conflict (storage moved past our lastSeenRaw:
  // the snapshot is kept and the conflict goes loud, never dropped).
  // Called from the timer, from profile switches (the pending snapshot still
  // belongs to the previous profile), and never from render.
  // Last-good backup: a failed setItem never clobbers storage (the old raw
  // stays intact), and the failed snapshot is kept in pendingSaveRef for
  // retry — so an error on the last edit before close/switch cannot silently
  // drop it. One toast per outage via saveFailedRef.
  const flushSave = (): boolean => {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    skippedRef.current = 0;
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!pending) return true;
    if (decideFlush({ base: lastSeenRawRef.current }, readStoredRaw(pending.profileId)) !== 'write') {
      pendingSaveRef.current = pending;
      setSaveState((p) => nextSaveState(p, 'conflict'));
      return false;
    }
    const ok = saveStore(pending.store, pending.profileId);
    setSaveState((p) => nextSaveState(p, ok ? 'ok' : 'fail'));
    if (!ok) {
      pendingSaveRef.current = pending;
      if (!saveFailedRef.current) {
        saveFailedRef.current = true;
        notify(tr("toastSaveFailed", pending.lang));
      }
      return false;
    }
    saveFailedRef.current = false;
    dirtyRef.current = false;
    loadedStoreRef.current = pending.store;
    lastSeenRawRef.current = readStoredRaw(pending.profileId);
    setLastSavedAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    return true;
  };

  useEffect(() => {
    if (!profileId) return;
    if (store !== loadedStoreRef.current) dirtyRef.current = true;
    const blocked = storeBlocked !== null;
    if (!shouldPersist(dirtyRef.current, blocked, pendingSaveRef.current !== null)) return;
    if (dirtyRef.current && !blocked) {
      pendingSaveRef.current = { store, profileId, lang };
    }
    setSaveState((p) => nextSaveState(p, 'edit'));
    if (skippedRef.current >= SAVE_COALESCE_MAX) {
      flushSave();
    } else {
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = undefined;
        flushSave();
      }, SAVE_DEBOUNCE);
    }
    return () => {
      // Clearing an armed timer here means this edit superseded a pending
      // write: count it toward the forced write-through cap. (Counting must
      // live here, not in the body: the body always sees an empty slot.)
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
        skippedRef.current += 1;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, profileId, lang]);

  // Unload inside the debounce window must still persist: synchronous flush
  // on tab close/hide (and mobile pagehide). Reads refs only, so the handler
  // never goes stale. A failed pending after flush means data loss on close:
  // cancel the unload so the browser asks (beforeunload only; pagehide and
  // visibility flush silently). No dialog when everything is written.
  useEffect(() => {
    const timers = toastTimersRef.current;
    const onUnload = (e: BeforeUnloadEvent) => {
      const ok = flushSave();
      if (!ok && pendingSaveRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    const onHide = () => {
      flushSave();
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Cross-tab updates for the current profile key. Quiet reload when idle
  // (no pending, nothing dirty); a loud conflict when local edits are
  // outstanding. Own writes never fire storage events here. No merging.
  useEffect(() => {
    if (!profileId || storeBlocked) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storeKeyFor(profileId)) return;
      if (sameStoreContent(e.newValue, lastSeenRawRef.current)) return;
      if (!dirtyRef.current && !pendingSaveRef.current) {
        reloadFromStorage(true);
      } else {
        setSaveState((p) => nextSaveState(p, 'conflict'));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, storeBlocked, lang]);

  // No minute ticker: the header shows the save status, never the wall time.

  useEffect(() => {
    if (boot.recovered) notify(tr('toastRegistryRecovered', lang));
    if (bootStore.dropped > 0) notify(`${tr('brokenCleaned', lang)}: ${bootStore.dropped}`);
    if (consumeActiveIdReset()) notify(tr('toastBadActiveId', lang));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.altKey && e.key === '0') {
        e.preventDefault();
        resetPanels();
      } else if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'n') {
        const t = e.target as HTMLElement | null;
        if (t && t.closest && t.closest('input,textarea,[contenteditable="true"]')) return;
        e.preventDefault();
        newBlank();
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setTrashOpen(false);
        setMoreOpen(false);
        setShortcutsOpen(false);
    
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, notes]);

  const openNoteById = (id: string) => {
    setStore((s) => ({ ...s, activeId: id }));
    setPage('home');
  };

  const updateActive = (fn: (n: Note) => Note) => {
    setStore((s) => ({ ...s, notes: s.notes.map((n) => (n.id === s.activeId ? { ...fn(n), updated: Date.now() } : n)) }));
  };

  /** With id-links rename touches only the note itself. */
  const renameActive = (v: string) => {
    const title = uniqueTitle(v, activeId);
    updateActive((n) => ({ ...n, title }));
  };

  const toggleTask = (id: string) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    setStore((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, done: !x.done } : x)) }));
    notify(tr(t.done ? 'toastTaskBack' : 'toastTaskDone', lang));
  };

  const addTask = (text: string, opts?: { desc?: string; due?: string; noteId?: string }) => {
    const v = text.trim();
    if (!v) return;
    setStore((s) => ({
      ...s,
      tasks: [{ id: newId("t"), text: v, desc: opts?.desc || undefined, done: false, due: opts?.due, noteId: opts?.noteId }, ...s.tasks],
    }));
    notify(tr('toastTaskAdded', lang));
  };

  const setTaskDue = (id: string, due: string) => {
    setStore((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, due } : x)) }));
  };

  const deleteTask = (id: string) => {
    const victim = tasks.find((x) => x.id === id);
    if (!victim) return;
    setStore((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== id), trashTasks: [victim, ...s.trashTasks] }));
    notify(tr("toastTaskDeleted", lang));
  };

  const savePrompt = (d: Omit<PromptSave, 'id' | 'created'>) => {
    const id = newId("p");
    setStore((s) => ({ ...s, prompts: [{ ...d, id, created: Date.now() }, ...s.prompts] }));
    notify(tr('toastSavedTpl', lang));
  };

  const deletePrompt = (id: string) => {
    setStore((s) => ({ ...s, prompts: s.prompts.filter((x) => x.id !== id) }));
    notify(tr('promptDeleted', lang));
  };

  const saveCustomTpl = (d: Omit<LlmTpl, 'id'>): string => {
    const id = newId("ct");
    setStore((s) => ({ ...s, customTpls: [...s.customTpls, { ...d, id }] }));
    notify(tr('toastSavedTpl', lang));
    return id;
  };

  const updateCustomTpl = (id: string, d: Omit<LlmTpl, 'id'>) => {
    setStore((s) => ({ ...s, customTpls: s.customTpls.map((x) => (x.id === id ? { ...d, id } : x)) }));
    notify(tr('tplUpdated', lang));
  };

  const deleteCustomTpl = (id: string) => {
    setStore((s) => ({ ...s, customTpls: s.customTpls.filter((x) => x.id !== id) }));
    notify(tr('promptDeleted', lang));
  };

  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const activePrompt = store.prompts.find((p) => p.id === activePromptId) ?? null;

  const persistRegistry = (next: ProfileRegistry): boolean => {
    if (!saveProfiles(next)) {
      notify(tr('toastRegistrySaveFailed', lang));
      return false;
    }
    setRegistry(next);
    return true;
  };

  const resetSession = () => {
    setActivePromptId(null);
    setSearchOpen(false);
    setQ('');
    setTrashOpen(false);
    setMoreOpen(false);
    setShortcutsOpen(false);
    setSettingsOpen(false);
  };

  /** Enter a profile: isolated store + prefs, clean session state.
   * All sets below run synchronously in one handler, so React batches them
   * into a single render: save-effects never observe a mixed state where the
   * store belongs to another profileId. Keep this function await-free. */
  const enterProfile = (id: string, reg: ProfileRegistry) => {
    if (!forceSwitchRef.current && !flushSave()) {
      notify(tr('toastSwitchBlocked', lang));
      return;
    }
    forceSwitchRef.current = false;
    // Registry first: the save gates every mutation below, so a failed
    // write aborts the switch with the old profile still active (finding B2).
    let next: ProfileRegistry;
    try {
      next = setActiveProfile(reg, id);
    } catch {
      notify(tr('toastProfileOpFailed', lang));
      return;
    }
    if (!persistRegistry(next)) return;
    setSaveState((p) => nextSaveState(p, 'reset'));
    setLastSavedAt(null);
    const r = loadProfileStore(id);
    if (r.kind === 'blocked') {
      dirtyRef.current = false;
      lastSeenRawRef.current = null;
      const placeholder = freshStore();
      loadedStoreRef.current = placeholder;
      setStore(placeholder);
      setStoreBlocked({ reason: r.reason, raw: r.raw, backupKey: r.backupKey });
      if (!r.backupKey) notify(tr('toastBackupFailed', lang));
    } else {
      const settled = settleStore(r.store);
      dirtyRef.current = false;
      loadedStoreRef.current = settled;
      lastSeenRawRef.current = readStoredRaw(id);
      setStore(settled);
      setStoreBlocked(null);
      const dropped = r.droppedLinks + r.droppedItems;
      if (dropped > 0) notify(`${tr('brokenCleaned', lang)}: ${dropped}`);
      if (consumeActiveIdReset()) notify(tr("toastBadActiveId", lang));
    }
    setTheme(load(prefKeyFor('theme', id), 'light') === 'dark' ? 'dark' : 'light');
    const v = load(prefKeyFor('lang', id), 'RU');
    setLang(v === 'EN' || v === 'KZ' || v === 'RU' ? v : 'RU');
    setSideOpen(load(prefKeyFor('side', id), '1') === '1');
    setRightOpen(load(prefKeyFor('right', id), '1') === '1');
    setTplLimit(loadListLimit("prompts", undefined, id));
    resetSession();
    setProfileId(id);
  };

  const createNewProfile = (name: string) => {
    if (!flushSave()) {
      notify(tr('toastSwitchBlocked', lang));
      return;
    }
    setSaveState((p) => nextSaveState(p, 'reset'));
    setLastSavedAt(null);
    let created: { registry: ProfileRegistry; profile: { id: string } } | null = null;
    try {
      created = createProfile(registry, name);
    } catch {
      created = null;
    }
    if (!created) {
      notify(tr('toastProfileOpFailed', lang));
      return;
    }
    // Registry first (finding B2): no lang pref, no state moves until saved.
    if (!persistRegistry(created.registry)) return;
    const profile = created.profile;
    save(prefKeyFor('lang', profile.id), lang);
    const fresh = freshStore();
    dirtyRef.current = false;
    loadedStoreRef.current = fresh;
    lastSeenRawRef.current = null;
    setStoreBlocked(null);
    setStore(fresh);
    setTheme('light');
    setSideOpen(true);
    setRightOpen(true);
    setTplLimit(TPL_LIMIT_DEFAULT);
    resetSession();
    setProfileId(profile.id);
  };

  const renameProfileById = (id: string, name: string) => {
    let next: ProfileRegistry;
    try {
      next = renameProfile(registry, id, name);
    } catch {
      notify(tr('toastProfileOpFailed', lang));
      return;
    }
    persistRegistry(next);
  };

  const deleteProfileById = (id: string) => {
    let next: ProfileRegistry;
    try {
      next = deleteProfile(registry, id);
    } catch {
      notify(tr("toastProfileDeleteFailed", lang));
      return;
    }
    // Registry first, data second (finding B3): the entry is gone before
    // any key is removed, so a failed removal leaves a recoverable orphan
    // (found by recovery), never a ghost entry pointing at missing data.
    if (!persistRegistry(next)) return;
    if (!removeProfileData(id, window.localStorage)) {
      notify(tr("toastProfileDataOrphan", lang));
    }
    if (id === profileId) enterProfile(next.activeId, next);
  };

  /** Blocked-store banner actions: exports read the untouched keys, an empty
   * store starts only over an explicit arm-confirm, the backup stays. */
  const downloadBlockedRaw = () => {
    if (profileId && !exportRaw(storeKeyFor(profileId))) notify(tr('toastBackupFailed', lang));
  };
  const downloadBackup = () => {
    if (!storeBlocked?.backupKey || !exportRaw(storeBlocked.backupKey)) notify(tr('toastBackupFailed', lang));
  };
  const continueEmpty = () => {
    if (!emptyConfirm.confirm()) return;
    dirtyRef.current = true;
    // Adopt the current (damaged) raw as the base: the empty write that
    // follows is explicit, not a silent clobber.
    if (profileId) lastSeenRawRef.current = readStoredRaw(profileId);
    setStore(freshStore());
    setStoreBlocked(null);
  };
  const backToPicker = () => {
    resetSession();
    setStoreBlocked(null);
    setProfileId(null);
  };

  /** Legacy adoption UI (STAGE_09): the raw legacy key is read directly,
   * never from state; import verifies the copy before touching anything. */
  const downloadLegacyRaw = () => {
    if (!exportRaw(LEGACY_STORE_KEY)) notify(tr('toastBackupFailed', lang));
  };
  const startEmptyAfterFailedAdoption = () => {
    if (!adoptEmptyConfirm.confirm()) return;
    adoptEmptyConfirm.resetAll();
    let created: { registry: ProfileRegistry; profile: { id: string } } | null = null;
    try {
      created = createProfile(registry, tr('profileDefault', lang));
    } catch {
      created = null;
    }
    if (!created) {
      notify(tr('toastProfileOpFailed', lang));
      return;
    }
    // Quota: the registry cannot be saved either — toast and stay blocked.
    if (!persistRegistry(created.registry)) return;
    setLegacyPresent(hasLegacyKey());
    enterProfile(created.profile.id, created.registry);
  };
  const importLegacyAsProfile = () => {
    if (!legacyImportConfirm.confirm()) return;
    legacyImportConfirm.resetAll();
    const leg = loadStoreResult(undefined, window.localStorage);
    if (leg.status !== 'ok' || !leg.store) {
      notify(tr('toastProfileOpFailed', lang));
      return;
    }
    let created: { registry: ProfileRegistry; profile: { id: string } } | null = null;
    try {
      created = createProfile(registry, tr('profileDefault', lang));
    } catch {
      created = null;
    }
    if (!created) {
      notify(tr('toastProfileOpFailed', lang));
      return;
    }
    const expected = { ...(leg.rest ?? {}), ...leg.store, schemaVersion: SCHEMA_VERSION };
    if (!saveStore(leg.store, created.profile.id, window.localStorage, { rest: leg.rest })) {
      notify(tr('toastSaveFailed', lang));
      return;
    }
    if (!verifyStoredMatches(window.localStorage, created.profile.id, expected)) {
      notify(tr('toastSaveFailed', lang));
      return;
    }
    if (!persistRegistry(created.registry)) return;
    try {
      window.localStorage.removeItem(LEGACY_STORE_KEY);
    } catch {
      /* keep the key: the banner simply stays until it is gone */
    }
    setLegacyPresent(hasLegacyKey());
    enterProfile(created.profile.id, created.registry);
  };

  /** Failed-save rescue: export the live memory store (storage holds older
   * data) and retry the kept snapshot. The banner lives until a write wins. */
  const downloadMemory = () => {
    if (!exportMemory(store)) notify(tr('toastBackupFailed', lang));
  };
  const retrySave = () => {
    setSaveState((p) => nextSaveState(p, 'retry'));
    flushSave();
  };

  /** Reload the current profile from storage (quiet cross-tab update or
   * conflict resolution). announce=false stays silent for the resolver. */
  const reloadFromStorage = (announce: boolean) => {
    if (!profileId) return;
    const r = loadProfileStore(profileId);
    if (r.kind === 'blocked') {
      setStoreBlocked({ reason: r.reason, raw: r.raw, backupKey: r.backupKey });
      if (!r.backupKey) notify(tr('toastBackupFailed', lang));
      return;
    }
    const settled = settleStore(r.store);
    loadedStoreRef.current = settled;
    setStore(settled);
    dirtyRef.current = false;
    lastSeenRawRef.current = readStoredRaw(profileId);
    setSaveState((p) => nextSaveState(p, 'reset'));
    setLastSavedAt(null);
    if (announce) notify(tr('toastExternalUpdate', lang));
  };

  const conflictConfirm = useArmConfirm();
  const adoptEmptyConfirm = useArmConfirm();
  const legacyImportConfirm = useArmConfirm();
  // Legacy adoption did not finish (quota or unreadable payload): nothing is
  // auto-saved, the user picks download / retry / start-empty (STAGE_09).
  // The screen owns the UI only while no registry exists: after an explicit
  // start-empty the entered profile takes over (boot.adoption stays frozen).
  const adoptionBlocked =
    (boot.adoption === 'failed' || boot.adoption === 'blocked') && registry.profiles.length === 0;
  const resolveAcceptTheirs = () => {
    if (!conflictConfirm.confirm('accept')) return;
    pendingSaveRef.current = null;
    conflictConfirm.resetAll();
    reloadFromStorage(false);
  };
  const resolveOverwriteMine = () => {
    if (!conflictConfirm.confirm('overwrite')) return;
    if (!profileId) return;
    if (!saveStore(store, profileId)) {
      setSaveState((p) => nextSaveState(p, 'fail'));
      pendingSaveRef.current = { store, profileId, lang };
      return;
    }
    conflictConfirm.resetAll();
    pendingSaveRef.current = null;
    dirtyRef.current = false;
    loadedStoreRef.current = store;
    lastSeenRawRef.current = readStoredRaw(profileId);
    setSaveState((p) => nextSaveState(p, 'ok'));
    setLastSavedAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  };
  const downloadMine = () => {
    if (!exportMemory(store)) notify(tr('toastBackupFailed', lang));
  };

  const bindPrompt = (promptId: string, noteId: string, text: string) => {
    setStore((s) => ({
      ...s,
      prompts: s.prompts.map((x) => (x.id === promptId ? { ...x, noteId } : x)),
      notes: s.notes.map((n) => {
        if (n.id !== noteId) return n;
        const next = appendPromptText(n.content, n.text, text);
        return { ...n, ...next, updated: Date.now() };
      }),
    }));
    notify(tr('toastLinked', lang));
  };

  const unbindPrompt = (id: string) => {
    setStore((s) => ({ ...s, prompts: s.prompts.map((x) => (x.id === id ? { ...x, noteId: undefined } : x)) }));
    notify(tr('promptUnbound', lang));
  };

  const updateTask = (id: string, patch: { text?: string; desc?: string; due?: string }) => {
    setStore((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    notify(tr('taskUpdated', lang));
  };

  const deleteActiveNote = () => {
    const victim = activeNote;
    if (!victim) return;
    setStore((s) => {
      const rest = s.notes
        .filter((n) => n.id !== victim.id)
        .map((n) => (n.linkedIds.includes(victim.id) ? { ...n, linkedIds: n.linkedIds.filter((x) => x !== victim.id) } : n));
      return { ...s, notes: rest, trash: [victim, ...s.trash], activeId: rest[0]?.id ?? '' };
    });
    notify(tr('toastNoteDeleted', lang));
  };

  const deleteNoteById = (id: string) => {
    const victim = notes.find((n) => n.id === id);
    if (!victim) return;
    setStore((s) => {
      const rest = s.notes
        .filter((n) => n.id !== id)
        .map((n) => (n.linkedIds.includes(id) ? { ...n, linkedIds: n.linkedIds.filter((x) => x !== id) } : n));
      return { ...s, notes: rest, trash: [victim, ...s.trash], activeId: s.activeId === id ? (rest[0]?.id ?? '') : s.activeId };
    });
    notify(tr('toastNoteDeleted', lang));
  };

  const restoreTrash = (id: string) => {
    const n = trash.find((x) => x.id === id);
    if (!n) return;
    setStore((s) => ({ ...s, trash: s.trash.filter((x) => x.id !== id), notes: [n, ...s.notes], activeId: n.id }));
    setPage('home');
    notify(tr('toastTrashRestored', lang));
  };

  const purgeTrash = (id: string) => {
    setStore((s) => ({ ...s, trash: s.trash.filter((x) => x.id !== id) }));

  };

  const purge = useArmConfirm();
  const restoreTrashTask = (id: string) => {
    const t = store.trashTasks.find((x) => x.id === id);
    if (!t) return;
    setStore((s) => ({ ...s, trashTasks: s.trashTasks.filter((x) => x.id !== id), tasks: [t, ...s.tasks] }));
    notify(tr("toastTaskRestored", lang));
  };
  const purgeTrashTask = (id: string) => {
    setStore((s) => ({ ...s, trashTasks: s.trashTasks.filter((x) => x.id !== id) }));

  };
  const armPurgeNote = (id: string) => {
    if (purge.confirm("n:" + id)) purgeTrash(id);
  };
  const armPurgeTask = (id: string) => {
    if (purge.confirm("t:" + id)) purgeTrashTask(id);
  };
    const duplicateActive = () => {
    if (!activeNote) return;
    const copy: Note = {
      ...activeNote,
      id: newId("n"),
      title: uniqueTitle(`${activeNote.title} (${tr('duplicate', lang)})`),
      linkedIds: [...activeNote.linkedIds],
      calcs: activeNote.calcs.map((c) => ({ ...c })),
      updated: Date.now(),
    };
    setStore((s) => ({ ...s, notes: [copy, ...s.notes], activeId: copy.id }));
  };

  const exportActive = () => {
    if (!activeNote) return;
    const md = `# ${activeNote.title}\n\n${activeNote.text}`;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${activeNote.title || 'note'}.md`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    notify(tr('toastExported', lang));
  };

  const addLink = (id: string) => {
    updateActive((n) => (n.linkedIds.includes(id) ? n : { ...n, linkedIds: [...n.linkedIds, id] }));
  };

  const removeLink = (id: string) => {
    updateActive((n) => ({ ...n, linkedIds: n.linkedIds.filter((x) => x !== id) }));
    notify(tr('toastUnlinked', lang));
  };

  /** Drop a dangling reference from every note at once. */
  const purgeLink = (id: string) => {
    setStore((s) => ({
      ...s,
      notes: s.notes.map((n) =>
        n.linkedIds.includes(id) ? { ...n, linkedIds: n.linkedIds.filter((x) => x !== id) } : n,
      ),
    }));
  };

  const uniqueGraphTitle = (base: string, ignoreId?: string) => {
    const taken = new Set(graphs.filter((g) => g.id !== ignoreId).map((g) => g.title));
    const clean = base.trim() || tr('newGraphName', lang);
    if (!taken.has(clean)) return clean;
    let i = 2;
    while (taken.has(`${clean} ${i}`)) i++;
    return `${clean} ${i}`;
  };

  const createGraph = (title: string): string => {
    const id = newId("g");
    const g: Graph = { id, title: uniqueGraphTitle(title), noteIds: [] };
    setStore((s) => ({ ...s, graphs: [...s.graphs, g] }));
    return id;
  };

  const renameGraph = (id: string, title: string) => {
    setStore((s) => ({
      ...s,
      graphs: s.graphs.map((g) => (g.id === id ? { ...g, title: uniqueGraphTitle(title, id) } : g)),
    }));
  };

  const deleteGraph = (id: string) => {
    setStore((s) => ({ ...s, graphs: s.graphs.filter((g) => g.id !== id) }));
  };

  const toggleMember = (noteId: string, graphId: string) => {
    setStore((s) => ({
      ...s,
      graphs: s.graphs.map((g) =>
        g.id !== graphId
          ? g
          : { ...g, noteIds: g.noteIds.includes(noteId) ? g.noteIds.filter((x) => x !== noteId) : [...g.noteIds, noteId] },
      ),
    }));
  };

  const addCalc = () => {
    updateActive((n) => ({ ...n, calcs: [...n.calcs, { id: newId("c"), name: '', expr: '' }] }));
  };

  const updateCalc = (id: string, patch: Partial<CalcBlock>) => {
    updateActive((n) => ({ ...n, calcs: n.calcs.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  };

  const deleteCalc = (id: string) => {
    updateActive((n) => ({ ...n, calcs: n.calcs.filter((c) => c.id !== id) }));
  };



  const actions: HomeActions = {
    updateTitle: renameActive,
    updateDoc: (doc, text) => updateActive((n) => ({ ...n, content: doc, text })),
    createTask: (d) => addTask(d.text, { desc: d.desc, due: d.due, noteId: d.noteId }),
    updateTask,
    toggleTask,
    deleteTask,
    duplicate: duplicateActive,
    exportMd: exportActive,
    deleteNote: deleteActiveNote,
    addLink,
    removeLink,
    addCalc,
    updateCalc,
    deleteCalc,

  };

  // Dynamic search over real notes and tasks. Ranking, order and top-7 are
  // unchanged — only memoized, so unrelated renders (clock, toasts, panels)
  // no longer rebuild and filter the item list.
  const results = useMemo(() => {
    const items: SearchItem[] = [
      ...notes.map(
        (n): SearchItem => ({
          id: `s-${n.id}`,
          kind: 'note',
          title: n.title || tr('newNoteTitle', lang),
          sub: n.text.slice(0, SNIPPET_LEN),
          refId: n.id,
        }),
      ),
      ...tasks.map(
        (t): SearchItem => ({
          id: `s-${t.id}`,
          kind: 'task',
          title: t.text,
          sub: `${tr('nav_tasks', lang)}${t.due ? ` · ${fmtDue(t.due)}` : ''}`,
          refId: t.id,
        }),
      ),
      ...store.prompts.map(
        (p): SearchItem => ({
          id: `s-${p.id}`,
          kind: "prompt",
          title: p.title,
          sub: promptPreview(p, store.customTpls).slice(0, SNIPPET_LEN),
          refId: p.id,
        }),
      ),
    ];
    const words = q.trim().toLowerCase().split(/\s+/);
    return items
      .filter((it) => {
        const s = `${it.title} ${it.sub}`.toLowerCase();
        return words.every((w) => s.includes(w));
      })
      .slice(0, 7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, tasks, store.prompts, store.customTpls, q, lang]);

  const pickSearch = (it: SearchItem) => {
    setSearchOpen(false);
    setQ('');
    searchNav.reset();
    const n = notes.find((x) => x.id === it.refId);
    if (n) {
      setStore((s) => ({ ...s, activeId: n.id }));
      setPage('home');
      return;
    }
    const t = tasks.find((x) => x.id === it.refId);
    if (t) {
      toggleTask(t.id);
      setPage('tasks');
      return;
    }
    const pr = store.prompts.find((x) => x.id === it.refId);
    if (pr) {
      setActivePromptId(pr.id);
      setPage("prompt");
      return;
    }
    notify(it.title);
  };

  const kindName = (k: SearchItem['kind']) =>
    tr(k === "note" ? "kindNote" : k === "prompt" ? "kindPrompt" : k === "task" ? "kindTask" : "kindDate", lang);

  const searchNav = useListNav(results.length, (idx) => {
    const it = results[idx];
    if (it) pickSearch(it);
  });
  useEffect(() => {
    if (searchOpen) searchNav.reset();
  }, [searchOpen]);

  const navBtn = (
    icon: 'note' | 'tasks' | 'cal' | 'map' | 'trash' | 'sliders' | 'prompt',
    testid: string,
    label: string,
    isActive: boolean,
    onClick: () => void,
    badge?: number,
    pro?: boolean,
  ) => (
    <button
      key={testid}
      type="button"
      title={label}
      data-testid={testid}
      className={`g-navitem${isActive ? ' active' : ''}`}
      onClick={onClick}
    >
      <Icon n={icon} />
      {sideOpen && <span className="g-lbl">{label}</span>}
      {badge !== undefined && badge > 0 ? (
        <span className="g-badge-n">{badge}</span>
      ) : pro ? (
        <span className="g-pro">{tr('pro', lang)}</span>
      ) : null}
    </button>
  );

  const mapLocked = notes.length < MAP_UNLOCK;

  return (
    <ErrorBoundary key="root" lang={lang} profileId={profileId} onHome={() => setPage('notes')}>
    <div className="g-app" data-theme={theme}>
      <header className="g-topbar">
        <button
          type="button"
          className="g-btn sm ghost g-burger"
          title={tr('menu', lang)}
          aria-label={tr('menu', lang)}
          onClick={() => setSideOpen((v) => !v)}
        >
          <Icon n="menu" />
        </button>
        <button type="button" className="g-logo" onClick={() => setPage('notes')}>
          <span className="g-logo-dot" />
          Grafnot
        </button>
        <button type="button" className="g-searchbtn" onClick={() => setSearchOpen(true)}>
          <span>{tr('search_ph', lang)}</span>
          <kbd className="g-kbd">Ctrl K</kbd>
        </button>
                <button type="button" className="g-btn sm ghost" title={tr("shortcutsT", lang)} aria-label={tr("shortcutsT", lang)} onClick={() => setShortcutsOpen(true)}>
          ?
        </button>
        <div className={`g-status${saveState === 'saved' ? '' : ' g-status-bad'}`}>
          <span className="g-pulse" />
          {saveState === 'saved'
            ? lastSavedAt
              ? `${tr("savedLocal", lang)} · ${lastSavedAt}`
              : tr("savedLocal", lang)
            : saveState === 'pending'
              ? tr('savePending', lang)
              : saveState === 'failed'
                ? tr('saveFailed', lang)
                : tr('saveConflict', lang)}
        </div>
        <div className="g-top-actions">
          <button
            type="button"
            className="g-btn sm ghost"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title="theme"
          >
            {tr(theme === 'light' ? 'themeIsLight' : 'themeIsDark', lang)}
          </button>
          <div className="g-seg" role="group" aria-label="lang">
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                className={`g-btn sm${lang === l ? ' active' : ''}`}
                onClick={() => setLang(l)}
              >
                {l}
              </button>
            ))}
          </div>
          <button type="button" className="g-avatar" title="Ushuzov Ruslan" aria-label={tr('settings', lang)} onClick={() => setSettingsOpen(true)}>RK</button>
        </div>
      </header>

      {saveState === 'failed' && (
        <StatusBanner
          title={tr('saveFailed', lang)}
          body={tr('saveFailedBody', lang)}
          actions={
            <>
              <button type="button" className="g-btn" onClick={downloadMemory}>
                {tr('exportData', lang)}
              </button>
              <button type="button" className="g-btn primary" onClick={retrySave}>
                {tr('retryBtn', lang)}
              </button>
            </>
          }
        />
      )}
      {saveState === 'conflict' && (
        <StatusBanner
          title={tr('saveConflict', lang)}
          body={tr('conflictBody', lang)}
          actions={
            <>
              {!conflictConfirm.isArmed('accept') ? (
                <button type="button" className="g-btn" onClick={() => conflictConfirm.arm('accept')}>
                  {tr('acceptTheirs', lang)}
                </button>
              ) : (
                <button type="button" className="g-btn g-danger-arm" onClick={resolveAcceptTheirs}>
                  {tr('switchAnyway', lang)}
                </button>
              )}
              {!conflictConfirm.isArmed('overwrite') ? (
                <button type="button" className="g-btn" onClick={() => conflictConfirm.arm('overwrite')}>
                  {tr('overwriteMine', lang)}
                </button>
              ) : (
                <button type="button" className="g-btn g-danger-arm" onClick={resolveOverwriteMine}>
                  {tr('switchAnyway', lang)}
                </button>
              )}
              <button type="button" className="g-btn ghost" onClick={downloadMine}>
                {tr('exportData', lang)}
              </button>
            </>
          }
        />
      )}

      <div className="g-layout">
        <aside className={`g-side${sideOpen ? '' : ' rail'}`}>
          <button
            type="button"
            title={tr('newNote', lang)}
            className={`g-newbtn${sideOpen ? '' : ' railbtn'}`}
            onClick={newBlank}
          >
            {sideOpen ? tr('newNote', lang) : <Icon n="plus" />}
          </button>
          <div className="g-nav">
            {navBtn('note', 'nav-home', tr('notebooks', lang), page === 'notes', () => setPage('notes'))}
            {navBtn('tasks', 'nav-tasks', tr('nav_tasks', lang), page === 'tasks', () => setPage('tasks'), openCount)}
            {navBtn('cal', 'nav-cal', tr('calendar', lang), page === 'cal', () => setPage('cal'))}
            {navBtn('map', 'nav-map', tr('kmap', lang), page === 'map', openMap, undefined, mapLocked)}
            {navBtn('prompt', 'nav-prompt', tr('nav_prompt', lang), page === 'prompt', () => setPage('prompt'))}
          </div>
          <div className="g-sidefoot">
            {navBtn('trash', 'nav-trash', tr('trash', lang), false, () => setTrashOpen(true), trash.length + trashTasks.length)}
            {navBtn('sliders', 'nav-settings', tr('settings', lang), false, () => setSettingsOpen(true))}
          </div>
        </aside>

        <main className="g-main" key={profileId ?? "picker"}>
          {adoptionBlocked ? (
            <div data-testid="adoption-blocked">
              <StatusBanner
                title={tr(boot.adoption === 'failed' ? 'adoptionFailedT' : 'adoptionBlockedT', lang)}
                body={tr(boot.adoption === 'failed' ? 'adoptionFailedBody' : 'adoptionBlockedBody', lang)}
                actions={
                  <>
                    <button type="button" className="g-btn" onClick={downloadLegacyRaw}>
                      {tr('downloadRaw', lang)}
                    </button>
                    {boot.adoption === 'failed' && (
                      <button type="button" className="g-btn" onClick={() => window.location.reload()}>
                        {tr('retryBtn', lang)}
                      </button>
                    )}
                    {!adoptEmptyConfirm.isArmed() ? (
                      <button type="button" className="g-btn" onClick={() => adoptEmptyConfirm.arm()}>
                        {tr('adoptionStartEmpty', lang)}
                      </button>
                    ) : (
                      <button type="button" className="g-btn g-danger-arm" onClick={startEmptyAfterFailedAdoption}>
                        {tr('adoptionStartEmptyConfirm', lang)}
                      </button>
                    )}
                  </>
                }
              />
            </div>
          ) : profileId === null ? (
            <>
              {legacyPresent && (
                <StatusBanner
                  title={tr('legacyPendingT', lang)}
                  body={tr('legacyPendingBody', lang)}
                  actions={
                    <>
                      <button type="button" className="g-btn" onClick={downloadLegacyRaw}>
                        {tr('downloadRaw', lang)}
                      </button>
                      {!legacyImportConfirm.isArmed() ? (
                        <button type="button" className="g-btn" onClick={() => legacyImportConfirm.arm()}>
                          {tr('legacyImport', lang)}
                        </button>
                      ) : (
                        <button type="button" className="g-btn g-danger-arm" onClick={importLegacyAsProfile}>
                          {tr('legacyImportConfirm', lang)}
                        </button>
                      )}
                    </>
                  }
                />
              )}
              <ProfilePicker
                lang={lang}
                registry={registry}
                actions={{
                  onEnter: (id) => enterProfile(id, registry),
                  onCreate: createNewProfile,
                  onRename: renameProfileById,
                  onDelete: deleteProfileById,
                }}
              />
            </>
          ) : storeBlocked ? (
            <StatusBanner
              title={tr('blockedT', lang)}
              body={tr(storeBlocked.reason === 'corrupt' ? 'blockedCorrupt' : 'blockedFuture', lang)}
              actions={
                <>
                  <button type="button" className="g-btn" onClick={downloadBlockedRaw}>
                    {tr('downloadRaw', lang)}
                  </button>
                  {storeBlocked.backupKey && (
                    <button type="button" className="g-btn" onClick={downloadBackup}>
                      {tr('openBackup', lang)}
                    </button>
                  )}
                  {storeBlocked.reason === 'corrupt' &&
                    (!emptyConfirm.isArmed() ? (
                      <button type="button" className="g-btn" onClick={() => emptyConfirm.arm()}>
                        {tr('continueEmpty', lang)}
                      </button>
                    ) : (
                      <button type="button" className="g-btn g-danger-arm" onClick={continueEmpty}>
                        {tr('continueEmptyConfirm', lang)}
                      </button>
                    ))}
                  <button type="button" className="g-btn ghost" onClick={backToPicker}>
                    {tr('switchProfile', lang)}
                  </button>
                </>
              }
            />
          ) : (
          <ErrorBoundary key={page} lang={lang} profileId={profileId} onHome={() => setPage('notes')}>
          {page === 'home' &&
            (activeNote ? (
              <Suspense fallback={lazyFallback}>
              <HomePage lang={lang} hintKey={prefKeyFor("hint", profileId)} note={activeNote} notes={notes} tasks={tasks} graphs={graphs} onOpenNote={openNoteById} prompts={store.prompts} onOpenPrompt={(id) => { setActivePromptId(id); setPage('prompt'); }} onUnbind={unbindPrompt} rightOpen={rightOpen} onToggleRight={() => setRightOpen((v) => !v)} actions={actions} notify={notify} />
              </Suspense>
            ) : (
              <div className="g-empty">
                <div className="g-empty-t">{tr('emptyHomeT', lang)}</div>
                <div className="g-empty-sub">{tr('emptyHomeSub', lang)}</div>
                <button type="button" className="g-btn primary" onClick={newBlank}>
                  {tr('createFirst', lang)}
                </button>
              </div>
            ))}
          {page === 'notes' && (
            <NotesPage
              lang={lang}
              notes={notes}
              onOpen={openNoteById}
              onDelete={deleteNoteById}
              onNew={newBlank}
              profileId={profileId}
            />
          )}
          {page === 'tasks' && (
            <TasksPage
              lang={lang}
              tasks={tasks}
              notes={notes}
              onToggle={toggleTask}
              onDelete={deleteTask}
              onAdd={(text, due) => addTask(text, { due })}
              onUpdate={updateTask}
              onOpenNote={openNoteById}
              profileId={profileId}
            />
          )}
          {page === 'cal' && (
            <CalendarPage
              lang={lang}
              tasks={tasks}
              onToggle={toggleTask}
              onAdd={(text, due) => addTask(text, { due })}
              onSetDue={setTaskDue}
            />
          )}
          {page === 'map' &&
            (mapLocked ? (
              <Suspense fallback={lazyFallback}>
              <MapLocked lang={lang} have={notes.length} need={MAP_UNLOCK} onNew={newBlank} />
              </Suspense>
            ) : (
              <Suspense fallback={lazyFallback}>
              <MapPage
                lang={lang}
                notes={notes}
                graphs={graphs}
                notify={notify}
                onOpen={openNoteById}
                onPurge={purgeLink}
                onCreateGraph={createGraph}
                onRenameGraph={renameGraph}
                onDeleteGraph={deleteGraph}
                onToggleMember={toggleMember}
                profileId={profileId}
              />
              </Suspense>
            ))}
          {page === 'prompt' && (
            <PromptPage
              lang={lang}
              notify={notify}
              prompts={store.prompts}
              notes={notes}
              activePrompt={activePrompt}
              customTpls={store.customTpls}
              tplLimit={tplLimit}
              onTplLimit={changeTplLimit}
              onSave={savePrompt}
              onDelete={deletePrompt}
              onBind={bindPrompt}
              onUnbind={unbindPrompt}
              onOpenNote={openNoteById}
              onConsumed={() => setActivePromptId(null)}
              onSaveTpl={saveCustomTpl}
              onUpdateTpl={updateCustomTpl}
              onDeleteTpl={deleteCustomTpl}
              profileId={profileId}
            />
          )}
          </ErrorBoundary>
          )}
        </main>
      </div>

      <nav className="g-bottombar">
        <button type="button" className={`g-bitem${page === 'notes' ? ' active' : ''}`} onClick={() => setPage('notes')}>
          {tr('nav_home', lang)}
        </button>
        <button type="button" className={`g-bitem${page === 'tasks' ? ' active' : ''}`} onClick={() => setPage('tasks')}>
          {tr('nav_tasks', lang)}
        </button>
        <button type="button" className={`g-bitem${page === 'cal' ? ' active' : ''}`} onClick={() => setPage('cal')}>
          {tr('calendar', lang)}
        </button>
        <button type="button" className={`g-bitem${page === 'map' || page === 'prompt' ? ' active' : ''}`} onClick={() => setMoreOpen(true)}>
          {tr("moreNav", lang)}
        </button>
        <button type="button" className="g-bitem primary" onClick={newBlank}>
          +
        </button>
      </nav>

      {moreOpen && (
        <Modal title={tr("moreNav", lang)} lang={lang} onClose={() => setMoreOpen(false)}>
          <div className="g-linklist">
            <button
              type="button"
              className={"g-linkitem" + (page === "map" ? " sel" : "")}
              onClick={() => {
                setMoreOpen(false);
                openMap();
              }}
            >
              <span>
                <Icon n="map" /> {tr("kmap", lang)}
                {mapLocked && (
                  <span className="muted small" style={{ marginLeft: 8 }}>
                    {notes.length}/{MAP_UNLOCK}
                  </span>
                )}
              </span>
              {mapLocked && <span className="g-pro">Pro</span>}
            </button>
            <button
              type="button"
              className={"g-linkitem" + (page === "prompt" ? " sel" : "")}
              onClick={() => {
                setMoreOpen(false);
                setPage("prompt");
              }}
            >
              <span>
                <Icon n="prompt" /> {tr("nav_prompt", lang)}
              </span>
            </button>
          </div>
        </Modal>
      )}

      <footer className="g-foot">
        <span>{tr('tagline', lang)}</span>
        <span>{tr('footSync', lang)}</span>
      </footer>

      {trashOpen && (
        <Modal title={tr('trashT', lang)} lang={lang} onClose={() => { setTrashOpen(false); purge.resetAll(); }}>
          {trash.length === 0 && trashTasks.length === 0 && <div className="muted">{tr('emptyTrash', lang)}</div>}
          {trash.map((n) => (
            <div className="g-sugg" key={n.id}>
              <span>{n.title}</span>
              <span>
                <button type="button" className="g-linkbtn" onClick={() => restoreTrash(n.id)}>
                  [{tr('restoreBtn', lang)}]
                </button>{' '}
                <button
                  type="button"
                  className={purge.isArmed("n:" + n.id) ? "g-linkbtn g-danger-arm" : "g-linkbtn"}
                  onClick={() => armPurgeNote(n.id)}
                >
                  {purge.isArmed("n:" + n.id) ? tr("confirmPurge", lang) : `[${tr("delForever", lang)}]`}
                </button>
              </span>
            </div>
          ))}
          {trashTasks.length > 0 && <div className="g-card-t sub">{tr('tasks', lang)}</div>}
          {trashTasks.map((t) => (
            <div className="g-sugg" key={t.id}>
              <span>{t.text}</span>
              <span>
                <button type="button" className="g-linkbtn" onClick={() => restoreTrashTask(t.id)}>
                  [{tr('restoreBtn', lang)}]
                </button>{" "}
                <button
                  type="button"
                  className={purge.isArmed("t:" + t.id) ? "g-linkbtn g-danger-arm" : "g-linkbtn"}
                  onClick={() => armPurgeTask(t.id)}
                >
                  {purge.isArmed("t:" + t.id) ? tr("confirmPurge", lang) : `[${tr("delForever", lang)}]`}
                </button>
              </span>
            </div>
          ))}
        </Modal>
      )}

      {settingsOpen && (
        <Modal title={tr("settings", lang)} lang={lang} onClose={() => setSettingsOpen(false)}>
          <div className="g-field">
            <span>{tr("themeL", lang)}</span>
            <div className="g-seg" role="group" aria-label="theme">
              <button
                key="light"
                type="button"
                className={"g-btn sm" + (theme === "light" ? " active" : "")}
                onClick={() => setTheme("light")}
              >
                {tr("themeLight", lang)}
              </button>
              <button
                key="dark"
                type="button"
                className={"g-btn sm" + (theme === "dark" ? " active" : "")}
                onClick={() => setTheme("dark")}
              >
                {tr("themeDark", lang)}
              </button>
            </div>
          </div>
          <div className="g-field">
            <span>{tr("langL", lang)}</span>
            <div className="g-seg" role="group" aria-label="lang">
              {LANGS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={"g-btn sm" + (lang === l ? " active" : "")}
                  onClick={() => setLang(l)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="g-field">
            <span>{tr("tplLimitL", lang)}</span>
            <div className="g-seg" role="group" aria-label="limit">
              {TPL_LIMITS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={"g-btn sm" + (tplLimit === n ? " active" : "")}
                  onClick={() => changeTplLimit(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="g-field">
            <button
              type="button"
              className="g-btn sm g-wide"
              onClick={() => {
                setSettingsOpen(false);
                setProfileConfirmOpen(true);
              }}
            >
              {tr("switchProfile", lang)}
            </button>
          </div>
        </Modal>
      )}

      {profileConfirmOpen && (
        <Modal
          title={tr("switchProfile", lang)}
          lang={lang}
          onClose={() => {
            switchConfirm.reset();
            setProfileConfirmOpen(false);
          }}
        >
          <div className="g-sugg">{tr("switchProfileConfirm", lang)}</div>
          <div className="g-modal-actions">
            <button
              type="button"
              className="g-btn"
              onClick={() => {
                switchConfirm.reset();
                setProfileConfirmOpen(false);
              }}
            >
              {tr("cancelBtn", lang)}
            </button>
            <button
              type="button"
              className="g-btn primary"
              onClick={() => {
                if (!flushSave()) {
                  if (!switchConfirm.confirm()) {
                    notify(tr('toastSwitchBlocked', lang));
                    return;
                  }
                  forceSwitchRef.current = true;
                } else {
                  switchConfirm.reset();
                }
                setProfileConfirmOpen(false);
                setProfileId(null);
              }}
            >
              {!switchConfirm.isArmed() ? tr("switchProfile", lang) : tr("switchAnyway", lang)}
            </button>
          </div>
        </Modal>
      )}

      {shortcutsOpen && (
        <Modal title={tr("shortcutsT", lang)} lang={lang} onClose={() => setShortcutsOpen(false)}>
          <div className="g-sugg">
            <span>{tr("scSearch", lang)}</span>
            <kbd className="g-kbd">Ctrl K</kbd>
          </div>
          <div className="g-sugg">
            <span>{tr("scPanels", lang)}</span>
            <kbd className="g-kbd">Alt 0</kbd>
          </div>
          <div className="g-sugg">
            <span>{tr("scNew", lang)}</span>
            <kbd className="g-kbd">Ctrl Alt N</kbd>
          </div>
        </Modal>
      )}

      {searchOpen && (
        <div className="g-back" onClick={() => setSearchOpen(false)}>
          <div className="g-search" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <input
              className="g-search-in"
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                searchNav.reset();
              }}
              onKeyDown={searchNav.onKeyDown}
              placeholder={tr('search_ph', lang)}
              aria-label="search"
            />
            <div className="g-results">
              {results.length === 0 && <div className="muted">{tr('noResults', lang)}</div>}
              {results.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  className={`g-result${i === searchNav.active ? ' active' : ''}`}
                  onMouseEnter={() => searchNav.setActive(i)}
                  onClick={() => pickSearch(r)}
                >
                  <span className="g-kind">{kindName(r.kind)}</span>
                  <span>{r.title}</span>
                  <span className="muted">{r.sub}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <ToastStack items={toasts} lang={lang} onClose={closeToast} onHover={pauseToast} />
    </div>
    </ErrorBoundary>
  );
}


