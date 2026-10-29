import { useEffect, useState } from 'react';

/** The visual viewport changes independently of layout when a mobile keyboard opens. */
export function useKeyboardOpen(enabled: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    let baseline = window.innerHeight, width = window.innerWidth;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      if (window.innerWidth !== width) { width = window.innerWidth; baseline = window.innerHeight; }
      const field = !!document.activeElement?.closest('textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="button"]),[contenteditable="true"]');
      if (!field) baseline = Math.max(baseline, height, window.innerHeight);
      setOpen(field && baseline - height > 150);
    };
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, [enabled]);
  return enabled && open;
}
