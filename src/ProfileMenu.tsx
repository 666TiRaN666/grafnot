import { useEffect, useRef, useState } from 'react';
import type { Lang } from './i18n';
import { tr } from './i18n';
import type { ProfileRegistry } from './profiles';
import { profileLabel } from './profiles';
import { useListNav } from './useListNav';

export function ProfileMenu({ lang, registry, activeId, collapsed, onSelect, onManage, onTrash, trashCount, onSettings }: {
  lang: Lang; registry: ProfileRegistry; activeId: string; collapsed: boolean;
  /** The trash has no phone tab: its entry lives here (desktop: the rail). */
  onSelect: (id: string) => void; onManage: () => void; onTrash: () => void; trashCount: number; onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const profiles = registry.profiles.slice(0, 5);
  const active = registry.profiles.find(p => p.id === activeId);
  const pick = (i: number) => {
    setOpen(false);
    if (i < profiles.length) { const p = profiles[i]; if (p && p.id !== activeId) onSelect(p.id); }
    else if (i === profiles.length) onManage();
    else if (i === profiles.length + 1) onTrash();
    else onSettings();
  };
  const nav = useListNav(profiles.length + 3, pick);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (e: PointerEvent) => { if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="profile-menu" ref={root}>
    <button ref={trigger} type="button" data-testid="profile-menu-open" className="s-navbtn" aria-label={tr('profilesT', lang)} aria-description={active ? profileLabel(active.name, lang) : undefined} aria-haspopup="menu" aria-expanded={open} title={active ? profileLabel(active.name, lang) : undefined} onClick={() => setOpen(v => !v)}>
      <span aria-hidden="true">◔</span>{!collapsed && <span className="profile-label">{active ? profileLabel(active.name, lang) : tr('profilesT', lang)} ▾</span>}
    </button>
    {open && <div role="menu" className="profile-pop" data-testid="profile-menu" onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus(); return; }
      if (e.key === 'Enter' || e.key === ' ') return; // Native activation belongs to the focused item.
      nav.onKeyDown(e);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
        const current = items ? Array.from(items).indexOf(document.activeElement as HTMLButtonElement) : 0;
        items?.[(current + (e.key === 'ArrowDown' ? 1 : profiles.length + 2)) % (profiles.length + 3)]?.focus();
      }
    }}>
      {profiles.map((p, i) => <button key={p.id} type="button" role="menuitem" className="n-menuitem" aria-current={p.id === activeId ? 'true' : undefined} onClick={() => pick(i)}>{p.id === activeId ? '✓ ' : ''}{profileLabel(p.name, lang)}</button>)}
      <button type="button" role="menuitem" className="n-menuitem" onClick={() => pick(profiles.length)}>{tr('profileManage', lang)}</button>
      <button type="button" role="menuitem" className="n-menuitem" onClick={() => pick(profiles.length + 1)}>{tr('trashT', lang)}{trashCount > 0 ? ` · ${trashCount}` : ''}</button>
      <button type="button" role="menuitem" className="n-menuitem" onClick={() => pick(profiles.length + 2)}>{tr('settings', lang)}</button>
    </div>}
  </div>;
}
