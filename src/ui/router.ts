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
    return view !== undefined && PLAN_VIEWS.has(view)
      ? { section: 'plan', param: view }
      : { section: 'notes' };
  }
  if (head === 'map') return segs[1] ? { section: 'map', param: segs[1] } : { section: 'map' };
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

export function navigate(route: Route): void {
  window.location.hash = buildRoute(route);
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
