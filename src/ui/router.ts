import { useEffect, useState } from 'react';

/** New IA sections (S2+). The legacy 6-page state ('home' included) is NOT
 * part of this contract: S3 merges home+notes into #/notes/:id.
 */
export type RouteSection = 'notes' | 'plan' | 'map' | 'prompts' | 'settings';
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
  if (head === 'settings') {
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
