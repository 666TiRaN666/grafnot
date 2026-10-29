// W5 «Лист»: the navigation rail is labelled by default and collapsible.
// Below NAV_AUTO_MIN a labelled rail would squeeze the text column under
// --u-measure-min, so the default ('auto') collapses it there; an explicit
// user choice ('open' / 'closed', stored per profile) always wins.
export type NavMode = 'auto' | 'open' | 'closed';

/** Window width (px) from which the auto mode shows labels. */
export const NAV_AUTO_MIN = 1200;

/** Stored value -> mode; anything but an explicit choice is 'auto'. */
export function parseNavMode(v: string | null | undefined): NavMode {
  return v === 'open' || v === 'closed' ? v : 'auto';
}

/** Is the rail labelled (expanded)? wide = window at least NAV_AUTO_MIN. */
export function navOpen(mode: NavMode, wide: boolean): boolean {
  return mode === 'open' || (mode === 'auto' && wide);
}
