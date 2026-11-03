import type { HTMLAttributes } from 'react';
import { useFitInViewport } from './useFitInViewport';

/** A popup span that keeps itself on screen (menus rendered inside lists,
 * where a hook per item is not possible). */
export function FitMenu(props: HTMLAttributes<HTMLSpanElement>) {
  const ref = useFitInViewport<HTMLSpanElement>(true);
  return <span ref={ref} {...props} />;
}
