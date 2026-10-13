import { useState } from 'react';

/** Default Undo window (N4): the toast action stays available for 8 seconds. */
export const UNDO_TTL = 8000;

interface UndoEntry {
  label: string;
  revert: () => void;
  deadline: number;
}

export interface UndoClock {
  now?: () => number;
  ttl?: number;
}

/** Framework-free Undo state machine: single active entry, a new do()
 * commits the previous one (it can no longer be reverted). The React hook
 * below is a thin wrapper around this controller; unit tests target this. */
export function createUndoController(clock?: UndoClock) {
  const now = clock?.now ?? (() => Date.now());
  const ttl = clock?.ttl ?? UNDO_TTL;
  let active: UndoEntry | null = null;
  return {
    do(label: string, apply: () => void, revert: () => void): void {
      // A pending entry is committed by replacement: just drop it.
      active = null;
      apply();
      active = { label, revert, deadline: now() + ttl };
    },
    undo(): boolean {
      if (!active) return false;
      if (now() > active.deadline) {
        active = null;
        return false;
      }
      const entry = active;
      active = null;
      entry.revert();
      return true;
    },
    get activeLabel(): string | null {
      if (!active) return null;
      if (now() > active.deadline) {
        active = null;
        return null;
      }
      return active.label;
    },
  };
}

export type UndoController = ReturnType<typeof createUndoController>;

/** React binding for the Undo controller. Not connected to any page yet (S1). */
export function useUndo(ttl: number = UNDO_TTL) {
  const [ctrl] = useState(() => createUndoController({ ttl }));
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const doWithUndo = (label: string, apply: () => void, revert: () => void) => {
    ctrl.do(label, apply, revert);
    bump();
  };
  const undo = (): boolean => {
    const ok = ctrl.undo();
    bump();
    return ok;
  };
  return { doWithUndo, undo, activeLabel: ctrl.activeLabel };
}
