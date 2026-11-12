import { useEffect, useState } from 'react';

export interface ToastMsg {
  id: number;
  text: string;
  /** Action button (Undo, Open); its label comes from the caller. */
  actionLabel?: string;
}

/** Remove one toast by id. */
export function dismissToast(items: ToastMsg[], id: number): ToastMsg[] {
  return items.filter((t) => t.id !== id);
}

/** Plain message lifetime. */
export const TOAST_MS = 2600;
/** Action toasts stay the full Undo window (N4: 8 s). */
export const TOAST_ACTION_MS = 8000;
/** Kept in the queue; ToastStack shows the newest few and a «+N» badge. */
export const TOAST_QUEUED = 6;

export interface ToastClock {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

/** The store session an action belongs to (W3/D2): a profile switch, a reload
 * from another tab or a conflict resolution starts a new one. */
export interface ToastSession {
  epoch: number;
  profileId: string | null;
}

/**
 * Toast queue and deferred actions without React (moved out of App.tsx in
 * 2026-11 so it can be tested): one message per event (the same plain text
 * is not stacked), auto-hide that pauses while hovered, action toasts whose
 * callback never runs in another store session — the user sees «Undo is no
 * longer available» instead.
 */
export function createToastQueue(deps: {
  onChange: (items: ToastMsg[]) => void;
  session: () => ToastSession;
  clock?: ToastClock;
}) {
  const clock: ToastClock = deps.clock ?? {
    now: () => Date.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  };
  let items: ToastMsg[] = [];
  let nextId = 1;
  const timers = new Map<number, number>();
  /** Running: the deadline; paused (hovered): the time that was left. */
  const ends = new Map<number, number>();
  const actions = new Map<number, ToastSession & { fn: () => void }>();

  const forget = (id: number) => {
    const t = timers.get(id);
    if (t !== undefined) clock.clearTimeout(t);
    timers.delete(id);
    ends.delete(id);
    actions.delete(id);
  };
  const set = (next: ToastMsg[]) => {
    const kept = next.slice(-TOAST_QUEUED);
    for (const x of next) if (!kept.includes(x)) forget(x.id);
    items = kept;
    deps.onChange(items);
  };
  const arm = (id: number, delay: number) => {
    ends.set(id, clock.now() + delay);
    timers.set(id, clock.setTimeout(() => close(id), delay));
  };

  /** Closed by ×, by its timer or by its action: an Undo that is off screen is gone too. */
  const close = (id: number) => {
    forget(id);
    set(dismissToast(items, id));
  };

  const notify = (text: string) => {
    if (items.some((x) => x.text === text && !x.actionLabel)) return;
    const id = nextId++;
    set([...items, { id, text }]);
    arm(id, TOAST_MS);
  };

  return {
    notify,
    notifyAction(text: string, actionLabel: string, fn: () => void) {
      const id = nextId++;
      actions.set(id, { fn, ...deps.session() });
      set([...items, { id, text, actionLabel }]);
      arm(id, TOAST_ACTION_MS);
    },
    /** The action button: runs only in the session that armed it; `gone` says why it did not. */
    fire(id: number, gone: string) {
      const entry = actions.get(id);
      actions.delete(id);
      close(id);
      if (!entry) return;
      const now = deps.session();
      if (entry.epoch !== now.epoch || entry.profileId !== now.profileId) {
        notify(gone);
        return;
      }
      entry.fn();
    },
    close,
    /** Hover pauses the auto-hide; leaving resumes it with the time that was left. */
    hover(id: number, hovering: boolean) {
      if (hovering) {
        const t = timers.get(id);
        if (t === undefined) return;
        clock.clearTimeout(t);
        timers.delete(id);
        const end = ends.get(id);
        if (end !== undefined) ends.set(id, Math.max(0, end - clock.now()));
      } else if (!timers.has(id) && ends.has(id)) {
        arm(id, ends.get(id) ?? TOAST_MS);
      }
    },
    /** The session ended: pending actions are dropped, visibly. */
    dropActions(gone: string) {
      const ids = [...actions.keys()];
      actions.clear();
      for (const id of ids) close(id);
      if (ids.length > 0) notify(gone);
    },
    dispose() {
      for (const t of timers.values()) clock.clearTimeout(t);
      timers.clear();
    },
  };
}

export type ToastQueue = ReturnType<typeof createToastQueue>;

/** The app's toast queue: React state for ToastStack plus the queue controls.
 * `session` is read when an action is armed and fired (App passes ref reads). */
export function useToasts(session: () => ToastSession): { items: ToastMsg[]; queue: ToastQueue } {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const [queue] = useState(() => createToastQueue({ onChange: setItems, session }));
  useEffect(() => () => queue.dispose(), [queue]);
  return { items, queue };
}
