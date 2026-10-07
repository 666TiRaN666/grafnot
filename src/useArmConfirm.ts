import { useState } from "react";

const DEFAULT_KEY = "default";

/** Add key to the armed set. Already armed returns the same set so React bails out. */
export function armKey(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (set.has(key)) return set;
  const next = new Set(set);
  next.add(key);
  return next;
}

/** Drop one key, keep the rest. Missing keys return the same set so React bails out. */
export function resetKey(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!set.has(key)) return set;
  const next = new Set(set);
  next.delete(key);
  return next;
}

/**
 * Two-step confirm shared by single and multi-row deletes. First call arms
 * and reports false (caller does nothing); a call while armed disarms and
 * reports true (caller executes). Re-arming after confirm starts over.
 */
export function confirmKey(set: ReadonlySet<string>, key: string): { next: ReadonlySet<string>; confirmed: boolean } {
  if (set.has(key)) return { next: resetKey(set, key), confirmed: true };
  return { next: armKey(set, key), confirmed: false };
}

export interface ArmConfirm {
  arm: (key?: string) => void;
  isArmed: (key?: string) => boolean;
  reset: (key?: string) => void;
  resetAll: () => void;
  confirm: (key?: string) => boolean;
}

/**
 * Arm-confirm state for irreversible deletes. One hook covers both shapes
 * used in the app: MapPage arms a single delete button (default key) and
 * App arms independent rows by id ("n:<id>", "t:<id>") inside one Set, so
 * no per-type boolean is needed. No timeouts: disarm paths (scope change,
 * modal close, executed delete) stay on the caller, exactly as today.
 */
export function useArmConfirm(): ArmConfirm {
  const [armed, setArmed] = useState<ReadonlySet<string>>(new Set());

  const arm = (key: string = DEFAULT_KEY) => {
    setArmed((p) => armKey(p, key));
  };
  const isArmed = (key: string = DEFAULT_KEY) => armed.has(key);
  const reset = (key: string = DEFAULT_KEY) => {
    setArmed((p) => resetKey(p, key));
  };
  const resetAll = () => {
    setArmed(new Set());
  };
  const confirm = (key: string = DEFAULT_KEY) => {
    const done = armed.has(key);
    setArmed((p) => (done ? resetKey(p, key) : armKey(p, key)));
    return done;
  };

  return { arm, isArmed, reset, resetAll, confirm };
}
