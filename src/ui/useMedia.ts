import { useEffect, useState } from 'react';

/** Live matchMedia result. Used where two layouts must not share the DOM
 * (duplicate testids and hidden controls would poison selectors). */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const h = () => setOn(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return on;
}
