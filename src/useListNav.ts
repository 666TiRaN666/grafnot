import { useCallback, useState } from "react";
import { clampActive, moveActive } from "./promptUtils";

/** Shared ArrowUp and ArrowDown plus Enter pattern for dropdowns and thumbnail lists. Replaces duplicated handlers in Ctrl K search, tag dropdown and template list. Focus stays in the input, active row highlights, Enter picks. */
export function useListNav(len: number, onPick?: (i: number) => void) {
  const [active, setActive] = useState(0);
  // Clamp at render, not in an effect: every consumer (highlight, Enter pick,
  // hover set) already works on clamped values, so no extra render pass is
  // needed when the list shrinks. Stored state may lag one render behind,
  // but all stable states are identical to the effect version.
  const shown = clampActive(active, len);
  const reset = useCallback(() => setActive(0), []);
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => moveActive(a, len, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => moveActive(a, len, -1));
      } else if (e.key === "Enter") {
        if (len > 0) {
          e.preventDefault();
          onPick?.(shown);
        }
      }
    },
    [len, shown, onPick],
  );
  return { active: shown, setActive, reset, onKeyDown };
}
