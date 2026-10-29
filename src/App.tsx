import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { Lang, Theme } from './i18n';
import { tr } from './i18n';
import type { LlmTpl } from './data';
import { LEGACY_STORE_KEY, SCHEMA_VERSION, appendPromptText, loadStoreResult, saveStore, storeKeyFor } from './store';
import type { CalcBlock, Graph, Note, PromptSave, Store } from './store';
import { ProfilePicker } from "./ProfilePicker";
import type { ProfileRegistry } from "./profiles";
import {
  createProfile,
  deleteProfile,
  removeProfileData,
  renameProfile,
  loadProfilesResult,
  PROFILES_KEY,
  updateProfiles,
  setActiveProfile,
} from "./profiles";
import { prefKeyFor } from "./prefs";
import { ErrorBoundary, Icon, Modal, StatusBanner, ToastStack, dismissToast, fmtDue } from './widgets';
import type { ToastMsg } from './widgets';
import type { NotesActions } from './NotesView';
// The editors load on demand: Tiptap travels with NotesView, d3-force with
// MapView. Named re-exports keep one network chunk per page module.
const NotesView = lazy(() => import('./NotesView').then((m) => ({ default: m.NotesView })));
const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })));
const lazyFallback = (
  <div className="g-page" role="status" aria-busy="true">
    <span className="g-pulse" />
  </div>
);
import { PlanList } from './PlanList';
import { PlanWeek } from './PlanWeek';
import { PromptLib } from './PromptLib';
import { PromptBuilder } from './PromptBuilder';
import { PromptWorkbench } from './PromptWorkbench';
import { PromptImageWb } from './PromptImageWb';
import { isSettingsSection } from './settingsNav';
import type { SettingsSection } from './settingsNav';
// Settings and the palette open on demand: they travel in their own chunks,
// like the editors (S2 rule 5). Ctrl+K fetches a few kilobytes on first open.
const SettingsPage = lazy(() => import('./SettingsPage').then((m) => ({ default: m.SettingsPage })));
const Palette = lazy(() => import('./Palette').then((m) => ({ default: m.Palette })));
import type { PaletteEntry } from './paletteModel';
import { navigate, parseRoute, useRoute } from './ui/router';
import type { RouteSection } from './ui/router';
import { exportRaw, exportMemory } from "./exportRaw";
import { SNIPPET_LEN, buildTplEntries, imageInit, makeSnippet, promptPreview } from "./promptUtils";
import { LLM_TEMPLATES } from "./data";
import { newId } from "./utils/newId";
import { consumeActiveIdReset, decideFlush, ensureRegistryCached, freshStore, hasLegacyKey, loadProfileStore, nextSaveState, sameStoreContent, settleStore, shouldPersist, verifyStoredMatches } from "./storage/profileBoot";
import type { SaveState, StoreBlocked } from "./storage/profileBoot";

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

  const MAP_UNLOCK = 0;

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
    return { registry: reg.registry, dropped: reg.droppedLinks, recovered: reg.recovered, adoption: reg.adoption, registryFailed: reg.registryFailed === true, registryReadFailed: reg.registryReadFailed === true };
  });
  const [registry, setRegistry] = useState<ProfileRegistry>(boot.registry);
  const registryRef = useRef(registry);
  registryRef.current = registry;
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
  const [sideOpen, setSideOpen] = useState(() => load(prefKeyFor('side', profileId ?? undefined), '1') === '1');
  const [rightOpen, setRightOpen] = useState(() => load(prefKeyFor('right', profileId ?? undefined), '1') === '1');
  const [bootStore] = useState(() => {
    if (!profileId)
      return { store: freshStore(), rest: {} as Record<string, unknown>, blocked: null as StoreBlocked | null, dropped: boot.dropped, lastSeen: null as string | null };
    const r = loadProfileStore(profileId);
    if (r.kind === 'blocked') {
      return {
        store: freshStore(),
        rest: {} as Record<string, unknown>,
        blocked: { reason: r.reason, raw: r.raw, backupKey: r.backupKey } as StoreBlocked,
        dropped: boot.dropped,
        lastSeen: null as string | null,
      };
    }
    return {
      store: settleStore(r.store),
      rest: r.rest,
      blocked: null as StoreBlocked | null,
      dropped: Math.max(boot.dropped, r.droppedLinks + r.droppedItems),
      lastSeen: readStoredRaw(profileId),
    };
  });
  const [store, setStore] = useState<Store>(bootStore.store);
  // Unknown fields travel with their profile snapshot, never with UI state.
  const storeRestRef = useRef<Record<string, unknown>>(bootStore.rest);
  const [storeBlocked, setStoreBlocked] = useState<StoreBlocked | null>(bootStore.blocked);
  const storeBlockedRef = useRef(Boolean(storeBlocked || boot.registryFailed));
  storeBlockedRef.current = Boolean(storeBlocked || boot.registryFailed || (profileId !== null && !registry.profiles.some(p => p.id === profileId)));
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileConfirmOpen, setProfileConfirmOpen] = useState(false);

  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const switchConfirm = useArmConfirm();
  const forceSwitchRef = useRef(false);

  const idRef = useRef(1);
  const saveFailedRef = useRef(false);
  const toastTimersRef = useRef(new Map<number, number>());
  const pendingSaveRef = useRef<{ store: Store; rest: Record<string, unknown>; profileId: string; lang: Lang } | null>(null);
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
  // Fresh-store mirror for toast-action callbacks (Undo fires long after the
  // render that armed it; reading `store` directly would see stale trash).
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
  });
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

  // D2 (W3): a store session ends whenever the whole store is swapped
  // (profile switch or creation, back to the picker, cross-tab reload,
  // conflict resolution — all via resetSession). Deferred actions carry the
  // session they were armed in and never run in another one.
  const sessionEpochRef = useRef(0);
  const sessionProfileRef = useRef(profileId);
  sessionProfileRef.current = profileId;

  // Action toasts (S3: Undo for delete/unlink, Open for note tasks). The
  // callback map lives in a ref so firing never re-renders; action toasts
  // stay the full N4 window (8s), plain toasts keep their short TTL.
  const toastActionsRef = useRef(new Map<number, { fn: () => void; epoch: number; profileId: string | null }>());
  const TOAST_UNDO_MS = 8000;
  const notifyAction = (text: string, actionLabel: string, fn: () => void) => {
    const id = idRef.current++;
    toastActionsRef.current.set(id, { fn, epoch: sessionEpochRef.current, profileId: sessionProfileRef.current });
    setToasts((p) => [...p, { id, text, actionLabel }].slice(-TOAST_QUEUED));
    armToast(id, TOAST_UNDO_MS);
  };
  const fireToastAction = (id: number) => {
    const entry = toastActionsRef.current.get(id);
    toastActionsRef.current.delete(id);
    closeToast(id);
    if (!entry) return;
    if (entry.epoch !== sessionEpochRef.current || entry.profileId !== sessionProfileRef.current) {
      notify(tr('toastUndoGone', lang));
      return;
    }
    entry.fn();
  };
  /** End the store session: pending toast actions are dropped, visibly. */
  const dropSessionActions = () => {
    sessionEpochRef.current += 1;
    const ids = [...toastActionsRef.current.keys()];
    toastActionsRef.current.clear();
    for (const id of ids) closeToast(id);
    if (ids.length > 0) notify(tr('toastUndoGone', lang));
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
  const createNote = (title: string, content: Note['content'] = '', text = '', linkedIds: string[] = []): string => {
    const id = newId("n");
    const note: Note = { id, title: uniqueTitle(title), content, text, linkedIds, calcs: [], updated: Date.now() };
    setStore((s) => ({ ...s, notes: [note, ...s.notes], activeId: id }));
    return id;
  };

  const go = (section: RouteSection, param?: string) => {
    setPaletteOpen(false);
    navigate(param !== undefined ? { section, param } : { section });
  };

  const newBlank = () => {
    const id = createNote(tr('newNoteTitle', lang));
    go('notes', id);
    notify(tr('toastNewNote', lang));
  };

  // S10: the map is always open (MAP_UNLOCK = 0); an empty canvas shows a
  // soft hint instead of a lock. Returning the lock is one line.
  const openMap = () => {
    go('map');
  };

  const resetPanels = () => {
    setSideOpen(true);
    setRightOpen(true);
  };

  useEffect(() => {
    if (profileId) save(prefKeyFor('theme', profileId), theme);
    // Viewport scrollbar + any root-level native UI follow the app theme.
    document.documentElement.style.colorScheme = theme;
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
    if (storeBlockedRef.current) return pendingSaveRef.current === null;
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!pending) return true;
    const liveRegistry = loadProfilesResult();
    if (liveRegistry.status !== 'ok' || !liveRegistry.registry.profiles.some(p => p.id === pending.profileId)) {
      pendingSaveRef.current = pending;
      setSaveState((p) => nextSaveState(p, 'conflict'));
      return false;
    }
    if (decideFlush({ base: lastSeenRawRef.current }, readStoredRaw(pending.profileId)) !== 'write') {
      pendingSaveRef.current = pending;
      setSaveState((p) => nextSaveState(p, 'conflict'));
      return false;
    }
    const ok = saveStore(pending.store, pending.profileId, undefined, { rest: pending.rest });
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
      pendingSaveRef.current = { store, rest: storeRestRef.current, profileId, lang };
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

  // Registry events update pickers independently of the current store key.
  useEffect(() => {
    const onRegistry = (event: StorageEvent) => {
      if (event.key !== PROFILES_KEY) return;
      const loaded = loadProfilesResult();
      if (loaded.status !== 'ok') return;
      registryRef.current = loaded.registry;
      setRegistry(loaded.registry);
      if (profileId && !loaded.registry.profiles.some(p => p.id === profileId)) {
        if (dirtyRef.current || pendingSaveRef.current) {
          setSaveState((p) => nextSaveState(p, 'conflict'));
        } else {
          resetSession();
          setProfileId(null);
        }
      }
    };
    window.addEventListener('storage', onRegistry);
    return () => window.removeEventListener('storage', onRegistry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  // No minute ticker: the header shows the save status, never the wall time.

  useEffect(() => {
    if (boot.recovered) notify(tr('toastRegistryRecovered', lang));
    if (bootStore.dropped > 0) notify(`${tr('brokenCleaned', lang)}: ${bootStore.dropped}`);
    if (consumeActiveIdReset()) notify(tr('toastBadActiveId', lang));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (storeBlockedRef.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.altKey && e.key === '0') {
        e.preventDefault();
        resetPanels();
      } else if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'n') {
        const t = e.target as HTMLElement | null;
        if (t && t.closest && t.closest('input,textarea,[contenteditable="true"]')) return;
        e.preventDefault();
        newBlank();
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, notes]);

  // D1: the route names the shown note; store.activeId follows it (see the
  // route effect below) and is only the landing note for the next start.
  const openNoteById = (id: string) => {
    go('notes', id);
  };

  /** Note commands always name their note: the one the user acted on. */
  const updateNote = (id: string, fn: (n: Note) => Note) => {
    setStore((s) => ({ ...s, notes: s.notes.map((n) => (n.id === id ? { ...fn(n), updated: Date.now() } : n)) }));
  };

  /** With id-links rename touches only the note itself. */
  const renameNote = (id: string, v: string) => {
    const title = uniqueTitle(v, id);
    updateNote(id, (n) => ({ ...n, title }));
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

  const setTaskDue = (id: string, due?: string) => {
    setStore((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, due } : x)) }));
  };

  /** Week drags (and inbox drops) are reversible like every other move. */
  const moveTask = (id: string, due?: string) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const old = t.due;
    setTaskDue(id, due);
    notifyAction(tr("taskMoved", lang), tr("undoToast", lang), () => setTaskDue(id, old));
  };

  const deleteTask = (id: string) => {
    const victim = tasks.find((x) => x.id === id);
    if (!victim) return;
    setStore((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== id), trashTasks: [victim, ...s.trashTasks] }));
    notifyAction(tr("toastTaskDeleted", lang), tr("undoToast", lang), () => restoreTrashTask(victim.id));
  };

  const savePrompt = (d: Omit<PromptSave, 'id' | 'created'>) => {
    const id = newId("p");
    setStore((s) => ({ ...s, prompts: [{ ...d, id, created: Date.now() }, ...s.prompts] }));
    notify(tr('toastSavedTpl', lang));
  };

  const deletePrompt = (id: string) => {
    const idx = store.prompts.findIndex((x) => x.id === id);
    const victim = idx >= 0 ? store.prompts[idx] : undefined;
    if (!victim) return;
    setStore((s) => ({ ...s, prompts: s.prompts.filter((x) => x.id !== id) }));
    notifyAction(tr('promptDeleted', lang), tr('undoToast', lang), () =>
      setStore((s) => {
        const next = [...s.prompts];
        next.splice(Math.min(idx, next.length), 0, victim);
        return { ...s, prompts: next };
      }),
    );
  };

  const renamePrompt = (id: string, title: string) => {
    setStore((s) => ({ ...s, prompts: s.prompts.map((x) => (x.id === id ? { ...x, title } : x)) }));
  };

  /** Template-level insert (no save binding): the workbench «В заметку». */
  const appendToNote = (noteId: string, text: string) => {
    setStore((s) => ({
      ...s,
      notes: s.notes.map((n) => {
        if (n.id !== noteId) return n;
        const next = appendPromptText(n.content, n.text, text);
        return { ...n, ...next, updated: Date.now() };
      }),
    }));
    notify(tr('toastToNote', lang));
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
    const idx = store.customTpls.findIndex((x) => x.id === id);
    const victim = idx >= 0 ? store.customTpls[idx] : undefined;
    if (!victim) return;
    setStore((s) => ({ ...s, customTpls: s.customTpls.filter((x) => x.id !== id) }));
    notifyAction(tr('promptDeleted', lang), tr('undoToast', lang), () =>
      setStore((s) => {
        const next = [...s.customTpls];
        next.splice(Math.min(idx, next.length), 0, victim);
        return { ...s, customTpls: next };
      }),
    );
  };


  const persistRegistry = async (change: (current: ProfileRegistry) => ProfileRegistry, allowAbsent = false, invalidMessage = tr('toastProfileOpFailed', lang)): Promise<ProfileRegistry | null> => {
    const result = await updateProfiles(change, { allowAbsent });
    if (result.status !== 'ok') {
      notify(result.status === 'invalid' ? invalidMessage : tr('toastRegistrySaveFailed', lang));
      return null;
    }
    registryRef.current = result.registry;
    setRegistry(result.registry);
    return result.registry;
  };

  const resetSession = () => {
    setPaletteOpen(false);
    dropSessionActions();
  };

  /** Enter a profile: isolated store + prefs, clean session state.
   * Await the registry transaction before batching store/profile state together. */
  const enterProfile = async (id: string) => {
    if (!forceSwitchRef.current && !flushSave()) {
      notify(tr('toastSwitchBlocked', lang));
      return;
    }
    forceSwitchRef.current = false;
    // Registry first: the save gates every mutation below, so a failed
    // write aborts the switch with the old profile still active (finding B2).
    if (!await persistRegistry(current => setActiveProfile(current, id))) return;
    // Edits made while waiting for the registry lock still belong to the old profile.
    if (!flushSave()) { notify(tr('toastSwitchBlocked', lang)); return; }
    setSaveState((p) => nextSaveState(p, 'reset'));
    setLastSavedAt(null);
    const r = loadProfileStore(id);
    if (r.kind === 'blocked') {
      storeRestRef.current = {};
      dirtyRef.current = false;
      lastSeenRawRef.current = null;
      const placeholder = freshStore();
      loadedStoreRef.current = placeholder;
      setStore(placeholder);
      setStoreBlocked({ reason: r.reason, raw: r.raw, backupKey: r.backupKey });
      if (r.raw !== undefined && !r.backupKey) notify(tr('toastBackupFailed', lang));
    } else {
      const settled = settleStore(r.store);
      storeRestRef.current = r.rest;
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
    resetSession();
    setProfileId(id);
    navigate(parseRoute(`#/${load(prefKeyFor('section', id), 'notes')}`));
  };

  const createNewProfile = async (name: string) => {
    if (!flushSave()) {
      notify(tr('toastSwitchBlocked', lang));
      return;
    }
    setSaveState((p) => nextSaveState(p, 'reset'));
    setLastSavedAt(null);
    const next = await persistRegistry(current => createProfile(current, name).registry);
    if (!next) return;
    if (!flushSave()) { notify(tr('toastSwitchBlocked', lang)); return; }
    const profile = { id: next.activeId };
    save(prefKeyFor('lang', profile.id), lang);
    const fresh = freshStore();
    storeRestRef.current = {};
    dirtyRef.current = false;
    loadedStoreRef.current = fresh;
    lastSeenRawRef.current = null;
    setStoreBlocked(null);
    setStore(fresh);
    setTheme('light');
    setSideOpen(true);
    setRightOpen(true);
    resetSession();
    setProfileId(profile.id);
    navigate({ section: 'notes' });
  };

  const renameProfileById = async (id: string, name: string) => {
    await persistRegistry(current => renameProfile(current, id, name));
  };

  const deleteProfileById = async (id: string) => {
    if (id === profileId && !flushSave()) {
      notify(tr('toastSwitchBlocked', lang));
      return;
    }
    const next = await persistRegistry(current => {
      if (id === profileId && !flushSave()) throw new Error('current profile has unsaved edits');
      return deleteProfile(current, id);
    }, false, tr('toastProfileDeleteFailed', lang));
    if (!next) return;
    if (!removeProfileData(id, window.localStorage)) notify(tr('toastProfileDataOrphan', lang));
    if (id === profileId) await enterProfile(next.activeId);
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
    storeRestRef.current = {};
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
  const startEmptyAfterFailedAdoption = async () => {
    if (!adoptEmptyConfirm.confirm()) return;
    adoptEmptyConfirm.resetAll();
    const next = await persistRegistry(current => createProfile(current, tr('profileDefault', lang)).registry, true);
    if (!next) return;
    setLegacyPresent(hasLegacyKey());
    await enterProfile(next.activeId);
  };
  const importLegacyAsProfile = async () => {
    if (!legacyImportConfirm.confirm()) return;
    legacyImportConfirm.resetAll();
    const leg = loadStoreResult(undefined, window.localStorage);
    if (leg.status !== 'ok' || !leg.store) {
      notify(tr('toastProfileOpFailed', lang));
      return;
    }
    const legacyStore = leg.store;
    const next = await persistRegistry(current => {
      const created = createProfile(current, tr('profileDefault', lang));
      const expected = { ...(leg.rest ?? {}), ...legacyStore, schemaVersion: SCHEMA_VERSION };
      if (!saveStore(legacyStore, created.profile.id, window.localStorage, { rest: leg.rest }) || !verifyStoredMatches(window.localStorage, created.profile.id, expected)) {
        throw new Error('legacy copy was not saved');
      }
      return created.registry;
    });
    if (!next) return;
    try { window.localStorage.removeItem(LEGACY_STORE_KEY); } catch { /* leave the original available for export */ }
    setLegacyPresent(hasLegacyKey());
    await enterProfile(next.activeId);
  };

  /** Failed-save rescue: export the live memory store (storage holds older
   * data) and retry the kept snapshot. The banner lives until a write wins. */
  const downloadMemory = () => {
    if (!exportMemory(store, storeRestRef.current)) notify(tr('toastBackupFailed', lang));
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
      if (r.raw !== undefined && !r.backupKey) notify(tr('toastBackupFailed', lang));
      return;
    }
    const settled = settleStore(r.store);
    storeRestRef.current = r.rest;
    setStoreBlocked(null);
    resetSession();
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
    if (profileId && !registryRef.current.profiles.some(p => p.id === profileId)) {
      pendingSaveRef.current = null;
      dirtyRef.current = false;
      setProfileId(null);
      setSaveState('saved');
      conflictConfirm.resetAll();
      return;
    }
    pendingSaveRef.current = null;
    conflictConfirm.resetAll();
    reloadFromStorage(false);
  };
  const resolveOverwriteMine = () => {
    if (!conflictConfirm.confirm('overwrite')) return;
    if (!profileId || storeBlockedRef.current) return;
    if (!saveStore(store, profileId, undefined, { rest: storeRestRef.current })) {
      setSaveState((p) => nextSaveState(p, 'fail'));
      pendingSaveRef.current = { store, rest: storeRestRef.current, profileId, lang };
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
    if (!exportMemory(store, storeRestRef.current)) notify(tr('toastBackupFailed', lang));
  };

  const unbindPrompt = (id: string) => {
    setStore((s) => ({ ...s, prompts: s.prompts.map((x) => (x.id === id ? { ...x, noteId: undefined } : x)) }));
    notify(tr('promptUnbound', lang));
  };

  const updateTask = (id: string, patch: { text?: string; desc?: string; due?: string }) => {
    setStore((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    notify(tr('taskUpdated', lang));
  };

  const deleteNote = (id: string) => {
    const victim = notes.find((n) => n.id === id);
    if (!victim) return;
    const next = notes.filter((n) => n.id !== victim.id);
    setStore((s) => {
      const rest = s.notes
        .filter((n) => n.id !== victim.id)
        .map((n) => (n.linkedIds.includes(victim.id) ? { ...n, linkedIds: n.linkedIds.filter((x) => x !== victim.id) } : n));
      return { ...s, notes: rest, trash: [victim, ...s.trash], activeId: rest[0]?.id ?? '' };
    });
    // The route pins the open note: follow the store's new active note so
    // the editor does not linger on the deleted id (old 'home' behavior).
    if (next.length > 0 && next[0]) go('notes', next[0].id);
    else go('notes');
    notifyAction(tr('toastNoteDeleted', lang), tr('undoToast', lang), () => restoreTrash(victim.id));
  };

  /** Sister of createNote that leaves activeId alone (for `[[` create-row). */
  const createLinkedNote = (title: string): string => {
    const id = newId("n");
    const note: Note = { id, title: uniqueTitle(title), content: "", text: "", linkedIds: [], calcs: [], updated: Date.now() };
    setStore((s) => ({ ...s, notes: [note, ...s.notes] }));
    return id;
  };

  const restoreTrash = (id: string) => {
    const n = storeRef.current.trash.find((x) => x.id === id);
    if (!n) return;
    setStore((s) => ({ ...s, trash: s.trash.filter((x) => x.id !== id), notes: [n, ...s.notes], activeId: n.id }));
    go('notes', n.id);
    notify(tr('toastTrashRestored', lang));
  };

  const purgeTrash = (id: string) => {
    setStore((s) => ({ ...s, trash: s.trash.filter((x) => x.id !== id) }));

  };

  const restoreTrashTask = (id: string) => {
    // Fresh store like restoreTrash: Undo callbacks fire long after arming.
    const t = storeRef.current.trashTasks.find((x) => x.id === id);
    if (!t) return;
    setStore((s) => ({ ...s, trashTasks: s.trashTasks.filter((x) => x.id !== id), tasks: [t, ...s.tasks] }));
    notify(tr("toastTaskRestored", lang));
  };
  const purgeTrashTask = (id: string) => {
    setStore((s) => ({ ...s, trashTasks: s.trashTasks.filter((x) => x.id !== id) }));

  };
  const duplicateNote = (id: string) => {
    const src = notes.find((n) => n.id === id);
    if (!src) return;
    const copy: Note = {
      ...src,
      id: newId("n"),
      title: uniqueTitle(`${src.title} (${tr('duplicate', lang)})`),
      linkedIds: [...src.linkedIds],
      calcs: src.calcs.map((c) => ({ ...c })),
      updated: Date.now(),
    };
    setStore((s) => ({ ...s, notes: [copy, ...s.notes], activeId: copy.id }));
    // The route pins the open note: open the copy (old 'home' behavior).
    go('notes', copy.id);
  };

  const exportNote = (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    const md = `# ${note.title}\n\n${note.text}`;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${note.title || 'note'}.md`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    notify(tr('toastExported', lang));
  };

  const addLink = (noteId: string, id: string) => {
    updateNote(noteId, (n) => (n.linkedIds.includes(id) ? n : { ...n, linkedIds: [...n.linkedIds, id] }));
  };

  const removeLink = (noteId: string, id: string) => {
    updateNote(noteId, (n) => ({ ...n, linkedIds: n.linkedIds.filter((x) => x !== id) }));
    notifyAction(tr('toastUnlinked', lang), tr('undoToast', lang), () => addLink(noteId, id));
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
    const idx = graphs.findIndex((g) => g.id === id);
    const victim = idx >= 0 ? graphs[idx] : undefined;
    if (!victim) return;
    setStore((s) => ({ ...s, graphs: s.graphs.filter((g) => g.id !== id) }));
    notifyAction(tr('graphDeleted', lang), tr('undoToast', lang), () =>
      setStore((s) => {
        if (s.graphs.some((g) => g.id === victim.id)) return s;
        const next = [...s.graphs];
        next.splice(Math.min(idx, next.length), 0, victim);
        return { ...s, graphs: next };
      }),
    );
  };

  /** Map drag-a-link: one direction (LinkDialog-era semantics), reversible. */
  const linkNotes = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const src = notes.find((n) => n.id === fromId);
    if (!src || src.linkedIds.includes(toId)) return;
    setStore((s) => ({
      ...s,
      notes: s.notes.map((n) => (n.id === fromId && !n.linkedIds.includes(toId) ? { ...n, linkedIds: [...n.linkedIds, toId] } : n)),
    }));
    notifyAction(tr('toastLinked', lang), tr('undoToast', lang), () =>
      setStore((s) => ({
        ...s,
        notes: s.notes.map((n) => (n.id === fromId ? { ...n, linkedIds: n.linkedIds.filter((x) => x !== toId) } : n)),
      })),
    );
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

  const addCalc = (noteId: string) => {
    updateNote(noteId, (n) => ({ ...n, calcs: [...n.calcs, { id: newId("c"), name: '', expr: '' }] }));
  };

  const updateCalc = (noteId: string, id: string, patch: Partial<CalcBlock>) => {
    updateNote(noteId, (n) => ({ ...n, calcs: n.calcs.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  };

  const deleteCalc = (noteId: string, id: string) => {
    updateNote(noteId, (n) => ({ ...n, calcs: n.calcs.filter((c) => c.id !== id) }));
  };



  const actions: NotesActions = {
    updateTitle: renameNote,
    updateDoc: (noteId, doc, text) => updateNote(noteId, (n) => ({ ...n, content: doc, text })),
    createTask: (d) => addTask(d.text, { desc: d.desc, due: d.due, noteId: d.noteId }),
    updateTask,
    toggleTask,
    deleteTask,
    duplicate: duplicateNote,
    exportMd: exportNote,
    deleteNote,
    addLink,
    removeLink,
    addCalc,
    updateCalc,
    deleteCalc,
    createLinkedNote,
    notifyAction,

  };

  // Palette entries over real notes, tasks and saved prompts. Grouping and
  // capping live in filterPalette (paletteModel); entries are memoized so
  // unrelated renders (toasts, panels) do not rebuild the item list.
  const paletteNotes: PaletteEntry[] = useMemo(
    () =>
      notes.map((n): PaletteEntry => ({
        id: `s-${n.id}`,
        group: 'notes',
        title: n.title || tr('newNoteTitle', lang),
        sub: n.text.slice(0, SNIPPET_LEN),
        refId: n.id,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes, lang],
  );
  const paletteTasks: PaletteEntry[] = useMemo(
    () =>
      tasks.map((t): PaletteEntry => ({
        id: `s-${t.id}`,
        group: 'tasks',
        title: t.text,
        sub: `${tr('nav_tasks', lang)}${t.due ? ` · ${fmtDue(t.due)}` : ''}`,
        refId: t.id,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, lang],
  );
  // S6: the palette searches the unified library (templates + saves).
  const palettePrompts: PaletteEntry[] = useMemo(
    () => [
      ...buildTplEntries(LLM_TEMPLATES, store.customTpls).map((e): PaletteEntry => ({
        id: `s-${e.tpl.id}`,
        group: 'prompts',
        title: e.tpl.name,
        sub: makeSnippet(e.tpl.body).slice(0, SNIPPET_LEN),
        refId: e.tpl.id,
      })),
      ...store.prompts.map((p): PaletteEntry => ({
        id: `s-${p.id}`,
        group: 'prompts',
        title: p.title,
        sub: promptPreview(p, store.customTpls).slice(0, SNIPPET_LEN),
        refId: p.id,
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.prompts, store.customTpls, lang],
  );
  const paletteCommands: PaletteEntry[] = useMemo(
    (): PaletteEntry[] => [
      { id: 'c-new-note', group: 'commands', title: tr('newNote', lang), sub: '', cmd: 'new-note' },
      { id: 'c-go-notes', group: 'commands', title: tr('notebooks', lang), sub: '', cmd: 'go-notes' },
      { id: 'c-go-plan', group: 'commands', title: tr('planT', lang), sub: '', cmd: 'go-plan' },
      { id: 'c-go-map', group: 'commands', title: tr('kmap', lang), sub: '', cmd: 'go-map' },
      { id: 'c-go-prompts', group: 'commands', title: tr('nav_prompt', lang), sub: '', cmd: 'go-prompts' },
      { id: 'c-go-settings', group: 'commands', title: tr('settings', lang), sub: '', cmd: 'go-settings' },
      { id: 'c-open-trash', group: 'commands', title: tr('trashT', lang), sub: '', cmd: 'open-trash' },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang],
  );

  const pickPalette = (e: PaletteEntry) => {
    setPaletteOpen(false);
    if (e.cmd === 'new-note') {
      newBlank();
      return;
    }
    if (e.cmd === 'go-notes') return go('notes');
    if (e.cmd === 'go-plan') return go('plan', 'list');
    if (e.cmd === 'go-map') return openMap();
    if (e.cmd === 'go-prompts') return go('prompts');
    if (e.cmd === 'go-settings') return go('settings', 'profiles');
    if (e.cmd === 'open-trash') return go('settings', 'trash');
    if (e.group === 'notes' && e.refId) {
      openNoteById(e.refId);
      return;
    }
    if (e.group === 'tasks' && e.refId) {
      // UX-01: a search hit opens the task; completion stays an explicit act.
      go('plan', `list/${e.refId}`);
      return;
    }
    if (e.group === 'prompts' && e.refId) {
      go('prompts', e.refId);
      return;
    }
    notify(e.title);
  };

  const paletteGroupName = (g: PaletteEntry['group']) =>
    g === 'notes'
      ? tr('kindNote', lang)
      : g === 'tasks'
        ? tr('kindTask', lang)
        : g === 'prompts'
          ? tr('kindPrompt', lang)
          : tr('paletteCmd', lang);

  // Hash routing (ui/router): sections notes/plan/map/prompts/settings.
  // The last visited section is restored per profile on start; deep links
  // work through Back/Forward without extra code.
  const route = useRoute();
  const section: RouteSection = route.section;
  const restoredRef = useRef(false);
  useEffect(() => {
    if (profileId) save(prefKeyFor('section', profileId), section);
  }, [section, profileId]);
  useEffect(() => {
    if (!profileId || restoredRef.current) return;
    restoredRef.current = true;
    if (!window.location.hash) {
      // No deep link: reopen the active note (old 'home' landing) or fall
      // back to the last visited section of this profile.
      if (activeNote) navigate({ section: 'notes', param: activeNote.id });
      else navigate(parseRoute(`#/${load(prefKeyFor('section', profileId), 'notes')}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const shellBtn = (
    icon: 'note' | 'tasks' | 'cal' | 'map' | 'trash' | 'sliders' | 'prompt' | 'plus' | 'menu',
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
      aria-label={label}
      data-testid={testid}
      className={`s-navbtn${isActive ? ' active' : ''}`}
      onClick={onClick}
    >
      <Icon n={icon} />
      {sideOpen && <span className="s-navlbl">{label}</span>}
      {badge !== undefined && badge > 0 ? (
        <span className="s-badge">{badge}</span>
      ) : pro ? (
        <span className="s-pro">Pro</span>
      ) : null}
    </button>
  );

  const sectionTitle =
    section === 'notes'
      ? tr('notebooks', lang)
      : section === 'plan'
        ? tr('planT', lang)
        : section === 'map'
          ? tr('kmap', lang)
          : section === 'prompts'
            ? tr('nav_prompt', lang)
            : tr('settings', lang);

  const settingsSection: SettingsSection =
    section === 'settings' && isSettingsSection(route.param) ? route.param : 'profiles';
  const planView: 'list' | 'week' = route.param === 'week' ? 'week' : 'list';
  const planTaskId = section === 'plan' && route.param?.startsWith('list/') ? route.param.slice('list/'.length) : null;
  const openNote: Note | undefined =
    section === 'notes' && route.param ? notes.find((n) => n.id === route.param) : undefined;
  // D1: Back/Forward, deep links and manual hash changes all move the shown
  // note; activeId follows so the next start lands on it. Commands never read
  // activeId — they take the shown note's id explicitly.
  const openNoteId = openNote?.id;
  useEffect(() => {
    if (openNoteId && activeId !== openNoteId) {
      setStore((s) => (s.activeId === openNoteId || !s.notes.some((n) => n.id === openNoteId) ? s : { ...s, activeId: openNoteId }));
    }
  }, [openNoteId, activeId]);
  // S9: template routes render the workbench (save mode when the id is a
  // save); builder and unknown ids are resolved separately below.
  const tplEntries = useMemo(() => buildTplEntries(LLM_TEMPLATES, store.customTpls), [store.customTpls]);
  const promptParam = section === 'prompts' ? (route.param ?? null) : null;
  const wbSave =
    promptParam && !promptParam.includes('/')
      ? (store.prompts.find((p) => p.id === promptParam) ?? null)
      : null;
  const wbTplId = wbSave?.templateId ?? (promptParam && !promptParam.includes('/') ? promptParam : null);
  const wbEntry = wbTplId ? (tplEntries.find((e) => e.tpl.id === wbTplId) ?? null) : null;
  const wbImage = wbEntry?.kind === 'image' ? imageInit(wbEntry.tpl) : null;
  const promptBuilder =
    promptParam === 'new'
      ? { mode: "new" as const, initial: { name: "", body: "", defaults: {} } }
      : promptParam?.startsWith('edit/') === true
        ? (() => {
            const id = promptParam.slice(5);
            const tpl = store.customTpls.find((t) => t.id === id);
            return tpl
              ? { mode: "edit" as const, id, initial: { name: tpl.name, body: tpl.body, defaults: { ...tpl.defaults }, ...(tpl.kind ? { kind: tpl.kind } : {}) } }
              : null;
          })()
        : null;

  return (
    <ErrorBoundary key="root" lang={lang} profileId={profileId} onHome={() => go('notes')}>
    <div className="g-app" data-theme={theme}>
      <div className="s-shell">
        <aside className={`s-rail${sideOpen ? '' : ' collapsed'}`}>
          <button
            type="button"
            className="s-railbtn"
            title={tr('menu', lang)}
            aria-label={tr('menu', lang)}
            onClick={() => setSideOpen((v) => !v)}
          >
            <Icon n="menu" />
          </button>
          <button
            type="button"
            title={tr('newNote', lang)}
            aria-label={tr('newNote', lang)}
            data-testid="quickadd"
            disabled={storeBlocked !== null || boot.registryFailed}
            className="s-railbtn s-create"
            onClick={() => setPaletteOpen(true)}
          >
            <Icon n="plus" />
            {sideOpen && <span className="s-navlbl">{tr('newNote', lang)}</span>}
          </button>
          <div className="s-nav">
            {shellBtn('note', 'nav-notes', tr('notebooks', lang), section === 'notes', () => go('notes'))}
            {shellBtn('tasks', 'nav-plan', tr('planT', lang), section === 'plan', () => go('plan', 'list'), openCount)}
            {shellBtn('map', 'nav-map', tr('kmap', lang), section === 'map', openMap, undefined, notes.length < MAP_UNLOCK)}
            {shellBtn('prompt', 'nav-prompt', tr('nav_prompt', lang), section === 'prompts', () => go('prompts'))}
          </div>
          <div className="s-railfoot">
            {shellBtn('sliders', 'nav-settings', tr('settings', lang), section === 'settings', () => go('settings', 'profiles'), trash.length + trashTasks.length)}
          </div>
        </aside>

        <div className="s-main">
          <header data-testid="page-header" className="s-header">
            <h1 className="s-title">{sectionTitle}</h1>
            <button type="button" data-testid="palette-open" disabled={storeBlocked !== null || boot.registryFailed} className="s-searchbtn" onClick={() => setPaletteOpen(true)}>
              <span>{tr('search_ph', lang)}</span>
              <kbd className="g-kbd">Ctrl K</kbd>
            </button>
            <div data-testid="save-state" role="status" aria-live="polite" className={`g-status${saveState === 'saved' ? '' : ' g-status-bad'}`}>
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
          </header>
          <div className="s-strip">
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
                      <button type="button" className="g-btn" disabled={profileId === null || !registry.profiles.some(p => p.id === profileId)} onClick={() => conflictConfirm.arm('overwrite')}>
                        {tr('overwriteMine', lang)}
                      </button>
                    ) : (
                      <button type="button" className="g-btn g-danger-arm" disabled={profileId === null || !registry.profiles.some(p => p.id === profileId)} onClick={resolveOverwriteMine}>
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
          </div>

        <main className="g-main" key={profileId ?? "picker"}>
          {boot.registryFailed ? (
            <div data-testid="registry-blocked">
              <StatusBanner
                title={boot.registryReadFailed ? tr('registryReadFailedT', lang) : tr('toastRegistrySaveFailed', lang)}
                body={boot.registryReadFailed ? tr('registryReadFailedBody', lang) : tr('registryFailedBody', lang)}
                actions={
                  <>
                    <button type="button" data-testid="registry-retry" className="g-btn primary" onClick={() => window.location.reload()}>
                      {tr('retryBtn', lang)}
                    </button>
                    {legacyPresent && (
                      <button type="button" className="g-btn" onClick={downloadLegacyRaw}>
                        {tr('downloadRaw', lang)}
                      </button>
                    )}
                  </>
                }
              />
            </div>
          ) : adoptionBlocked ? (
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
                  onEnter: (id) => enterProfile(id),
                  onCreate: createNewProfile,
                  onRename: renameProfileById,
                  onDelete: deleteProfileById,
                }}
              />
            </>
          ) : storeBlocked ? (
            <StatusBanner
              title={storeBlocked.reason === 'unavailable' ? tr('storageUnavailableT', lang) : tr('blockedT', lang)}
              body={storeBlocked.reason === 'unavailable' ? tr('storageUnavailableBody', lang) : tr(storeBlocked.reason === 'corrupt' ? 'blockedCorrupt' : 'blockedFuture', lang)}
              actions={
                <>
                  {storeBlocked.reason === 'unavailable' ? (
                    <button type="button" data-testid="storage-retry" className="g-btn primary" onClick={() => reloadFromStorage(false)}>
                      {tr('retryBtn', lang)}
                    </button>
                  ) : (
                    <button type="button" className="g-btn" onClick={downloadBlockedRaw}>
                      {tr('downloadRaw', lang)}
                    </button>
                  )}
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
          <ErrorBoundary key={section} lang={lang} profileId={profileId} onHome={() => go('notes')}>
          {section === 'notes' && (
            <>
              {openNote && (
                <button type="button" data-testid="notes-back" className="g-btn sm ghost" onClick={() => go('notes')}>
                  ← {tr('goBack', lang)}
                </button>
              )}
              <Suspense fallback={lazyFallback}>
              <NotesView lang={lang} hintKey={prefKeyFor("hint", profileId)} notes={notes} openNote={openNote ?? null} tasks={tasks} graphs={graphs} onOpenNote={openNoteById} onNew={newBlank} onOpenPlan={() => go('plan', 'list')} prompts={store.prompts} onOpenPrompt={(id) => go('prompts', id)} onUnbind={unbindPrompt} rightOpen={rightOpen} onToggleRight={() => setRightOpen((v) => !v)} actions={actions} notify={notify} profileId={profileId} />
              </Suspense>
            </>
          )}
          {section === 'plan' && (
            <>
              <div className="g-seg" role="group" aria-label="plan view">
                <button
                  type="button"
                  data-testid="plan-view-list"
                  className={`g-btn sm${planView === 'list' ? ' active' : ''}`}
                  onClick={() => go('plan', 'list')}
                >
                  {tr('planList', lang)}
                </button>
                <button
                  type="button"
                  data-testid="plan-view-week"
                  className={`g-btn sm${planView === 'week' ? ' active' : ''}`}
                  onClick={() => go('plan', 'week')}
                >
                  {tr('planWeek', lang)}
                </button>
              </div>
              {planView === 'week' ? (
                <PlanWeek
                  lang={lang}
                  tasks={tasks}
                  notes={notes}
                  onToggle={toggleTask}
                  onMove={moveTask}
                  onAdd={(text, opts) => addTask(text, opts)}
                  onUpdate={updateTask}
                  onDelete={deleteTask}
                  onOpenNote={openNoteById}
                />
              ) : (
                <PlanList
                  lang={lang}
                  tasks={tasks}
                  notes={notes}
                  onToggle={toggleTask}
                  onDelete={deleteTask}
                  onAdd={(text, opts) => addTask(text, opts)}
                  onUpdate={updateTask}
                  onOpenNote={openNoteById}
                  openId={planTaskId}
                  onLeaveOpen={() => navigate({ section: 'plan', param: 'list' }, { replace: true })}
                />
              )}
            </>
          )}
          {section === 'map' && (
              <Suspense fallback={lazyFallback}>
              <MapView
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
                onLinkNotes={linkNotes}
                profileId={profileId}
              />
              </Suspense>
          )}
          {section === 'prompts' && (
              <div className="p-lib-layout">
                <PromptLib
                  lang={lang}
                  customTpls={store.customTpls}
                  saves={store.prompts}
                  selectedId={route.param ?? null}
                  onSelect={(id) => go('prompts', id)}
                  onRenameSave={renamePrompt}
                  onCreate={() => go('prompts', 'new')}
                  profileId={profileId}
                />
                <div className="p-detail">
                  {promptBuilder ? (
                    <PromptBuilder
                      lang={lang}
                      title={promptBuilder.mode === "new" ? tr("newTpl", lang) : tr("builderEdit", lang)}
                      initial={promptBuilder.initial}
                      onSave={(d) => {
                        if (promptBuilder.mode === "new") {
                          const id = saveCustomTpl(d);
                          go('prompts', id);
                        } else {
                          updateCustomTpl(promptBuilder.id, d);
                          go('prompts', promptBuilder.id);
                        }
                      }}
                      onCancel={() => go('prompts', promptBuilder.mode === "edit" ? promptBuilder.id : undefined)}
                    />
                  ) : wbSave && wbEntry ? (
                    <PromptWorkbench
                      key={wbEntry.tpl.id + wbSave.id}
                      lang={lang}
                      tpl={wbEntry.tpl}
                      mine={wbEntry.mine}
                      save={wbSave}
                      notes={notes}
                      onSave={savePrompt}
                      onDuplicate={() => {
                        const id = saveCustomTpl({
                          name: wbEntry.tpl.name,
                          body: wbEntry.tpl.body,
                          defaults: { ...wbEntry.tpl.defaults },
                          ...(wbEntry.tpl.kind ? { kind: wbEntry.tpl.kind } : {}),
                        });
                        go('prompts', id);
                      }}
                      onEdit={() => go('prompts', `edit/${wbEntry.tpl.id}`)}
                      onDelete={() => deletePrompt(wbSave.id)}
                      onUnbindSave={wbSave.noteId ? () => unbindPrompt(wbSave.id) : undefined}
                      onAppendNote={appendToNote}
                      onOpenNote={openNoteById}
                      notify={notify}
                      notifyAction={notifyAction}
                    />
                  ) : wbEntry && wbEntry.kind === "image" ? (
                    <PromptImageWb
                      key={wbEntry.tpl.id}
                      lang={lang}
                      tplName={wbEntry.tpl.name}
                      initModel={wbImage?.model ?? 'Pony'}
                      initTokens={wbImage?.tokens ?? []}
                      mine={wbEntry.mine}
                      notes={notes}
                      onSaveTpl={(d) => {
                        const id = saveCustomTpl(d);
                        go('prompts', id);
                      }}
                      onAppendNote={appendToNote}
                      onOpenNote={openNoteById}
                      notify={notify}
                      notifyAction={notifyAction}
                      profileId={profileId}
                    />
                  ) : wbEntry ? (
                    <PromptWorkbench
                      key={wbEntry.tpl.id}
                      lang={lang}
                      tpl={wbEntry.tpl}
                      mine={wbEntry.mine}
                      save={null}
                      notes={notes}
                      onSave={savePrompt}
                      onDuplicate={() => {
                        const id = saveCustomTpl({
                          name: wbEntry.tpl.name,
                          body: wbEntry.tpl.body,
                          defaults: { ...wbEntry.tpl.defaults },
                          ...(wbEntry.tpl.kind ? { kind: wbEntry.tpl.kind } : {}),
                        });
                        go('prompts', id);
                      }}
                      onEdit={() => go('prompts', `edit/${wbEntry.tpl.id}`)}
                      onDelete={() => deleteCustomTpl(wbEntry.tpl.id)}
                      onUnbindSave={undefined}
                      onAppendNote={appendToNote}
                      onOpenNote={openNoteById}
                      notify={notify}
                      notifyAction={notifyAction}
                    />
                  ) : (
                    <div className="g-empty">
                      <div className="g-empty-t">{tr("libT", lang)}</div>
                      <button type="button" className="g-btn primary" onClick={() => go('prompts', 'new')}>
                        {tr("newTpl", lang)}
                      </button>
                    </div>
                  )}
                </div>
              </div>
          )}
          {section === 'settings' && (
            <Suspense fallback={lazyFallback}>
            <SettingsPage
              lang={lang}
              section={settingsSection}
              onSection={(s) => go('settings', s)}
              theme={theme}
              onTheme={setTheme}
              onLang={setLang}
              registry={registry}
              onEnterProfile={(id) => enterProfile(id)}
              onCreateProfile={createNewProfile}
              onRenameProfile={renameProfileById}
              onDeleteProfile={deleteProfileById}
              onSwitchProfile={() => setProfileConfirmOpen(true)}
              trash={trash}
              trashTasks={trashTasks}
              onRestoreNote={restoreTrash}
              onRestoreTask={restoreTrashTask}
              onPurgeNote={purgeTrash}
              onPurgeTask={purgeTrashTask}
              onExportData={() => {
                if (profileId && !exportRaw(storeKeyFor(profileId))) notify(tr('toastBackupFailed', lang));
              }}
            />
            </Suspense>
          )}
          </ErrorBoundary>
          )}
        </main>
        </div>

      <nav data-testid="tabbar" className="s-tabbar" aria-label="sections">
        <button type="button" data-testid="tab-notes" className={`s-tabbtn${section === 'notes' ? ' active' : ''}`} onClick={() => go('notes')}>
          <Icon n="note" />
          <span>{tr('notebooks', lang)}</span>
        </button>
        <button type="button" data-testid="tab-plan" className={`s-tabbtn${section === 'plan' ? ' active' : ''}`} onClick={() => go('plan', 'list')}>
          <Icon n="tasks" />
          <span>{tr('planT', lang)}</span>
        </button>
        <button type="button" data-testid="tab-add" disabled={storeBlocked !== null || boot.registryFailed} className="s-tabbtn s-tabadd" aria-label={tr('newNote', lang)} onClick={() => setPaletteOpen(true)}>
          +
        </button>
        <button type="button" data-testid="tab-map" className={`s-tabbtn${section === 'map' ? ' active' : ''}`} onClick={openMap}>
          <Icon n="map" />
          <span>{tr('kmap', lang)}</span>
        </button>
        <button type="button" data-testid="tab-prompts" className={`s-tabbtn${section === 'prompts' ? ' active' : ''}`} onClick={() => go('prompts')}>
          <Icon n="prompt" />
          <span>{tr('nav_prompt', lang)}</span>
        </button>
      </nav>
      </div>

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
                resetSession();
                setProfileId(null);
              }}
            >
              {!switchConfirm.isArmed() ? tr("switchProfile", lang) : tr("switchAnyway", lang)}
            </button>
          </div>
        </Modal>
      )}

      {paletteOpen && !storeBlocked && !boot.registryFailed && (
        <Suspense fallback={lazyFallback}>
        <Palette
          lang={lang}
          notes={paletteNotes}
          tasks={paletteTasks}
          prompts={palettePrompts}
          commands={paletteCommands}
          groupName={paletteGroupName}
          onPick={pickPalette}
          onClose={() => setPaletteOpen(false)}
        />
        </Suspense>
      )}

      <ToastStack items={toasts} lang={lang} onClose={closeToast} onHover={pauseToast} onAction={fireToastAction} />
    </div>
    </ErrorBoundary>
  );
}


