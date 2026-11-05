import { useEffect, useState } from 'react';

/** New IA sections (S2+). The legacy 6-page state ('home' included) is NOT
 * part of this contract: S3 merges home+notes into #/notes/:id.
 */
export type RouteSection = 'notes' | 'plan' | 'map' | 'prompts' | 'trash' | 'settings';
export interface Route {
  section: RouteSection;
  param?: string;
}

const PLAN_VIEWS = new Set(['list', 'week']);

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const segs = path.split('/').filter((s) => s.length > 0);
  const head = segs[0];
  if (head === 'notes') return segs[1] ? { section: 'notes', param: segs[1] } : { section: 'notes' };
  if (head === 'plan') {
    const view = segs[1];
    if (view === undefined || !PLAN_VIEWS.has(view)) return { section: 'notes' };
    // UX-01: the list nests an open task (list/<taskId>); task ids never contain '/'.
    return view === 'list' && segs[2] ? { section: 'plan', param: `list/${segs[2]}` } : { section: 'plan', param: view };
  }
  if (head === 'map') return segs[1] ? { section: 'map', param: segs[1] === 'note' && segs[2] ? 'note/' + segs[2] : segs[1] } : { section: 'map' };
  // S9: prompts nests one level (edit/<id>); item ids never contain '/'.
  if (head === 'prompts') return segs[1] ? { section: 'prompts', param: segs.slice(1).join('/') } : { section: 'prompts' };
  if (head === 'trash') return { section: 'trash' };
  if (head === 'settings') {
    // The trash used to be a settings tab: old links keep working.
    if (segs[1] === 'trash') return { section: 'trash' };
    return segs[1] ? { section: 'settings', param: segs[1] } : { section: 'settings' };
  }
  return { section: 'notes' };
}

export function buildRoute(route: Route): string {
  return route.param !== undefined && route.param !== ''
    ? `#/${route.section}/${route.param}`
    : `#/${route.section}`;
}

/** `replace` swaps the history entry (still fires hashchange). */
export function navigate(route: Route, opts?: { replace?: boolean }): void {
  if (opts?.replace) window.location.replace(buildRoute(route));
  else window.location.hash = buildRoute(route);
}

// Back/Forward vs a new navigation (§7.12: a traversal restores the note's
// temporary panel). The Navigation API tells them apart (Chromium); without
// it every history entry the app has seen carries a mark in history.state,
// and arriving at a marked entry is Back/Forward (Firefox, Safari).
let traversing = false;
const ENTRY_MARK = 'grafnotEntry';
if (typeof window !== 'undefined') {
  const nav: unknown = Reflect.get(window, 'navigation');
  if (nav instanceof EventTarget) {
    nav.addEventListener('navigate', (e) => {
      traversing = Reflect.get(e, 'navigationType') === 'traverse';
    });
  } else {
    let seq = 0;
    const mark = () => {
      const st: unknown = window.history.state;
      window.history.replaceState({ ...(st && typeof st === 'object' ? st : {}), [ENTRY_MARK]: ++seq }, '');
    };
    mark();
    // Registered at module load, before useRoute subscribes: the flag is set
    // before the route change renders.
    window.addEventListener('hashchange', () => {
      const st: unknown = window.history.state;
      traversing = !!st && typeof st === 'object' && ENTRY_MARK in st;
      if (!traversing) mark();
    });
  }
}
export const lastNavigationWasTraversal = (): boolean => traversing;

/** Reactive hash route. Deliberately NOT subscribed anywhere yet (S1). */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
