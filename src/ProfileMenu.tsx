import { useState } from 'react';
import { useMenu } from './ui/useMenu';
import type { Lang } from './i18n';
import { tr } from './i18n';
import type { ProfileRegistry } from './profiles';
import { profileLabel } from './profiles';
import { Icon } from './widgets';

interface Item {
  key: string;
  label: string;
  run: () => void;
  /** Profiles are a single choice: menuitemradio with aria-checked. */
  checked?: boolean;
  /** Starts a new group (separator above). */
  group?: boolean;
}

/**
 * The profile menu holds what belongs to the profile: switch and manage.
 * Sections of the app live in the navigation; only a phone, which has no
 * rail, also lists Trash and Settings here (`appNav`).
 */
export function ProfileMenu({ lang, registry, activeId, collapsed, appNav, onSelect, onManage, onTrash, trashCount, onSettings }: {
  lang: Lang; registry: ProfileRegistry; activeId: string; collapsed: boolean;
  /** Phone: the menu is also the way to Trash and Settings (no rail there). */
  appNav: boolean;
  onSelect: (id: string) => void; onManage: () => void; onTrash: () => void; trashCount: number; onSettings: () => void;
}) {
  const { open, setOpen, close, rootRef, triggerRef, triggerProps, menuProps } = useMenu<HTMLDivElement>();
  // Fixed to the trigger: the rail scrolls, so an absolute popup was clipped by it.
  const [place, setPlace] = useState<React.CSSProperties>({});
  const active = registry.profiles.find(p => p.id === activeId);
  const items: Item[] = [
    ...registry.profiles.slice(0, 5).map((p): Item => ({
      key: p.id,
      label: profileLabel(p.name, lang),
      checked: p.id === activeId,
      run: () => { if (p.id !== activeId) onSelect(p.id); },
    })),
    { key: 'manage', label: tr('profileManage', lang), run: onManage, group: true },
    ...(appNav ? [
      { key: 'trash', label: tr('trashT', lang) + (trashCount > 0 ? ` · ${trashCount}` : ''), run: onTrash, group: true },
      { key: 'settings', label: tr('settings', lang), run: onSettings },
    ] : []),
  ];
  const toggle = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!open && r) {
      const w = Math.min(280, window.innerWidth - 16);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      // The rail button sits low: open upwards; the phone header: downwards.
      setPlace(r.top > window.innerHeight / 2 ? { left, width: w, bottom: window.innerHeight - r.top + 8 } : { left, width: w, top: r.bottom + 8 });
    }
    setOpen(v => !v);
  };
  return <div className="profile-menu" ref={rootRef}>
    <button type="button" data-testid="profile-menu-open" className="s-navbtn" aria-label={tr('profilesT', lang)} aria-description={active ? profileLabel(active.name, lang) : undefined} title={active ? profileLabel(active.name, lang) : undefined}
      ref={triggerRef} {...triggerProps}
      onClick={toggle}
      onKeyDown={e => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); toggle(); } }}>
      {/* An outline icon, not the ◔ glyph: Linux fonts drew it as a dot (stage 6). */}
      <Icon n="user" />{!collapsed && <span className="profile-label">{active ? profileLabel(active.name, lang) : tr('profilesT', lang)}</span>}
      {!collapsed && <span className="profile-caret" aria-hidden="true">▾</span>}
    </button>
    {open && <div aria-label={tr('profilesT', lang)} className="profile-pop" data-testid="profile-menu" style={place} {...menuProps}>
      {items.map(it => [
        it.group ? <div key={it.key + '-sep'} role="separator" className="n-menusep" /> : null,
        <button key={it.key} type="button" tabIndex={-1} className="n-menuitem profile-item"
          role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
          aria-checked={it.checked === undefined ? undefined : it.checked}
          onClick={() => { close(); it.run(); }}>
          {it.checked !== undefined && <span className="profile-check" aria-hidden="true">{it.checked ? '✓' : ''}</span>}
          <span className="profile-itemlbl">{it.label}</span>
        </button>,
      ])}
    </div>}
  </div>;
}
