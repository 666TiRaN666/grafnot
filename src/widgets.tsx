import { Component, useEffect, useRef, type ReactNode } from 'react';
import { useMenu } from './ui/useMenu';
import { FitMenu } from './ui/FitMenu';
import { cutHiParts, splitHighlight } from "./promptUtils";
import type { Lang } from './i18n';
import { tr } from './i18n';
import { exportRaw } from './exportRaw';
import { storeKeyFor } from './store';

export interface ToastMsg {
  id: number;
  text: string;
  /** Optional Undo action (S1): label comes from the caller, no new i18n keys. */
  actionLabel?: string;
}

/** Max simultaneously visible toasts; the rest collapse into a "+N" badge. */
export const TOAST_VISIBLE_MAX = 3;

export function ToastStack({
  items,
  lang,
  onClose,
  onHover,
  onAction,
}: {
  items: ToastMsg[];
  lang: Lang;
  onClose?: (id: number) => void;
  onHover?: (id: number, hovering: boolean) => void;
  onAction?: (id: number) => void;
}) {
  // Newest-first visibility (the previous slice(-2) contract): the latest
  // toasts are always on screen, older overflow collapses into the badge.
  // Chronological order is kept so the first toast stays the oldest one.
  const visible = items.slice(-TOAST_VISIBLE_MAX);
  const extra = items.length - visible.length;
  return (
    <div className="g-toasts" role="status" aria-live="polite">
      {extra > 0 && <div className="g-toast g-toast-more">+{extra}</div>}
      {visible.map((m) => (
        <div
          className="g-toast"
          key={m.id}
          onMouseEnter={() => onHover?.(m.id, true)}
          onMouseLeave={() => onHover?.(m.id, false)}
        >
          <span className="g-toast-t">{m.text}</span>
          {m.actionLabel && onAction && (
            <button type="button" className="g-toast-undo" onClick={() => onAction(m.id)}>
              {m.actionLabel}
            </button>
          )}
          {onClose && (
            <button type="button" className="g-toast-x" onClick={() => onClose(m.id)} aria-label={tr('closeBtn', lang)}>
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Remove one toast by id. Shared by the auto-hide timer and the manual close button. */
export function dismissToast(items: ToastMsg[], id: number): ToastMsg[] {
  return items.filter((t) => t.id !== id);
}

export function Hi({ text, q, max }: { text: string; q: string; max?: number }) {
  const parts = splitHighlight(text, q);
  const shown = max === undefined ? parts : cutHiParts(parts, max);
  return (
    <span>
      {shown.map((p, i) =>
        p.hit ? (
          <mark key={i}>{p.text}</mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

export function Modal({
  title,
  lang,
  onClose,
  children,
}: {
  title: string;
  lang: Lang;
  onClose: () => void;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    openerRef.current = document.activeElement;
    const box = boxRef.current;
    const focusables = () =>
      box
        ? Array.from(
            box.querySelectorAll<HTMLElement>(
              'button, input, textarea, select, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute('disabled'))
        : [];
    const first = focusables()[0];
    if (first) first.focus();
    else box?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);
  return (
    <div className="g-back" onClick={onClose}>
      <div
        ref={boxRef}
        tabIndex={-1}
        className="g-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="g-modal-h">
          <span>{title}</span>
          <button type="button" className="g-modal-x" onClick={onClose} aria-label={tr('closeBtn', lang)}>
            ×
          </button>
        </div>
        <div className="g-modal-b">{children}</div>
      </div>
    </div>
  );
}

export type IconName =
  | 'plus'
  | 'note'
  | 'tasks'
  | 'cal'
  | 'map'
  | 'trash'
  | 'sliders'
  | 'menu'
  | 'panel'
  | 'search'
  | 'prompt'
  | 'user'
  | 'select'
  | 'close'
  | 'chevL'
  | 'chevR'
  | 'pin'
  | 'undo'
  | 'redo'
  | 'listBullet'
  | 'listOrdered'
  | 'listTask'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  | 'link'
  | 'table'
  | 'indentMore'
  | 'indentLess'
  | 'highlighter'
  | 'more';

const PATHS: Record<IconName, ReactNode> = {
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  note: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5.5" />
    </>
  ),
  cal: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <line x1="4" y1="10.5" x2="20" y2="10.5" />
      <line x1="9" y1="3" x2="9" y2="7" />
      <line x1="15" y1="3" x2="15" y2="7" />
    </>
  ),
  map: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="8" r="2.2" />
      <circle cx="10" cy="18" r="2.2" />
      <path d="M8.2 6.4l7.4.8M6.7 8.1l2.4 7.4M16.4 9.9l-4.6 6" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V5.5A1.5 1.5 0 0111 4h2a1.5 1.5 0 011.5 1.5V7" />
      <rect x="6.5" y="7" width="11" height="13" rx="2" />
      <line x1="10" y1="11" x2="10" y2="16" />
      <line x1="14" y1="11" x2="14" y2="16" />
    </>
  ),
  sliders: (
    <>
      <line x1="4" y1="7.5" x2="20" y2="7.5" />
      <circle cx="14.5" cy="7.5" r="2.3" />
      <line x1="4" y1="16.5" x2="20" y2="16.5" />
      <circle cx="9.5" cy="16.5" r="2.3" />
    </>
  ),
  menu: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </>
  ),
  prompt: (
    <>
      <path d="M12 4l1.7 4.8L18.5 10.5l-4.8 1.7L12 17l-1.7-4.8L5.5 10.5l4.8-1.7z" />
      <path d="M18.5 3.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),
  panel: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <line x1="15" y1="5" x2="15" y2="19" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <line x1="16" y1="16" x2="20.5" y2="20.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5" />
    </>
  ),
  select: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M12 4h2M18 4h.5A1.5 1.5 0 0120 5.5V8M4 12v2M4 18v.5A1.5 1.5 0 005.5 20H8" />
      <path d="M12.5 12.5l7 2.6-3 1.1-1.1 3z" />
    </>
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  chevL: <path d="M14.5 6l-6 6 6 6" />,
  chevR: <path d="M9.5 6l6 6-6 6" />,
  pin: (
    <>
      <path d="M9 4h6l-1 5 3 3H7l3-3z" />
      <line x1="12" y1="12" x2="12" y2="20" />
    </>
  ),
  undo: <path d="M9 7L5 11l4 4M5 11h9a5 5 0 010 10h-2" />,
  redo: <path d="M15 7l4 4-4 4M19 11h-9a5 5 0 000 10h2" />,
  listBullet: (
    <>
      <circle cx="5.5" cy="7" r="1" /><circle cx="5.5" cy="12" r="1" /><circle cx="5.5" cy="17" r="1" />
      <path d="M10 7h10M10 12h10M10 17h10" />
    </>
  ),
  listOrdered: (
    <>
      <path d="M4.5 5.5l1.5-1v5M10 7h10M10 12h10M10 17h10" />
      <path d="M4.5 14.5a1.5 1.5 0 012.6 1L4.5 19h3" />
    </>
  ),
  listTask: (
    <>
      <rect x="3.5" y="4.5" width="5" height="5" rx="1" />
      <path d="M4.8 15.5l1.4 1.4 2.4-2.9M12 7h8M12 16h8" />
    </>
  ),
  alignLeft: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  alignCenter: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  alignRight: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  alignJustify: <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
  link: (
    <>
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
    </>
  ),
  table: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M4 10h16M4 14.5h16M10 5v14" />
    </>
  ),
  indentMore: <path d="M4 5h16M11 10h9M11 14h9M4 19h16M4 9.5l3 2.5-3 2.5" />,
  indentLess: <path d="M4 5h16M11 10h9M11 14h9M4 19h16M7 9.5L4 12l3 2.5" />,
  highlighter: (
    <>
      <path d="M14.5 4.5l5 5-8 8H7v-4.5z" />
      <path d="M4 20h7" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18" cy="12" r="1.2" />
    </>
  ),
};

/** «Лист» icons: 18 px outline, colour inherited (Stage3_Visual_System.md §7). */
export function Icon({ n, size = 18 }: { n: IconName; size?: number }) {
  return (
    <span className="g-ico">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {PATHS[n]}
      </svg>
    </span>
  );
}

export interface MenuItem {
  key: string;
  label: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Starts a new group (separator above). */
  group?: boolean;
  /** Test id of the item (default: `<menu testid>-<key>`). */
  testid?: string;
}

/** A menu button over the shared menu model (`ui/useMenu`): task «⋯», bulk «В граф ▾». */
export function MenuButton({ label, items, className = 'g-btn sm', testid, ariaLabel, align = 'left', children, triggerExtra }: {
  label?: ReactNode; items: MenuItem[]; className?: string; testid?: string; ariaLabel?: string;
  align?: 'left' | 'right'; children?: ReactNode;
  /** Extra button attributes (a toolbar marks its controls and keeps the editor selection). */
  triggerExtra?: React.ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string>;
}) {
  const { open, rootRef, triggerRef, triggerProps, menuProps } = useMenu<HTMLSpanElement>();
  return (
    <span className="g-menuwrap" ref={rootRef} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={className} data-testid={testid} aria-label={ariaLabel} title={ariaLabel} {...triggerExtra} ref={triggerRef} {...triggerProps}>
        {children ?? label}
      </button>
      {open && (
        <span className={'g-menu' + (align === 'right' ? ' right' : '')} aria-label={ariaLabel} {...menuProps}>
          {items.map((it) => [
            it.group ? <span key={it.key + '-sep'} role="separator" className="n-menusep" /> : null,
            <button key={it.key} type="button" role="menuitem" tabIndex={-1} disabled={it.disabled} data-testid={it.testid ?? (testid ? `${testid}-${it.key}` : undefined)}
              className={'n-menuitem' + (it.danger ? ' danger' : '')}
              onClick={() => it.run()}>
              {it.label}
            </button>,
          ])}
        </span>
      )}
    </span>
  );
}

/** A menu whose content is free-form (steppers, selects) on the shared menu
 * model; `children` gets `close` for the actions that end the menu. */
export function MenuPopup({ label, ariaLabel, className, menuClassName, children, testid, triggerExtra }: {
  label: ReactNode; ariaLabel: string; className: string; menuClassName: string;
  children: (close: () => void) => ReactNode;
  testid?: string;
  triggerExtra?: React.ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string>;
}) {
  const { open, close, rootRef, triggerRef, triggerProps, menuProps } = useMenu<HTMLSpanElement>();
  return (
    <span className="g-menuwrap" ref={rootRef}>
      <button type="button" className={className} title={ariaLabel} aria-label={ariaLabel} data-testid={testid} {...triggerExtra} ref={triggerRef} {...triggerProps}>
        {label}
      </button>
      {open && (
        <FitMenu className={menuClassName} aria-label={ariaLabel} {...menuProps}>
          {children(close)}
        </FitMenu>
      )}
    </span>
  );
}

/**
 * Bulk actions over a selection (notes list, map): the count, the actions
 * that exist for every selected item, and a way out (× or Esc).
 */
export function SelectionBar({ lang, count, onClear, children, testid = 'sel-bar' }: {
  lang: Lang; count: number; onClear: () => void; children?: ReactNode; testid?: string;
}) {
  return (
    <div className="sel-bar" role="toolbar" aria-label={tr('selBarA', lang)} data-testid={testid}>
      <button type="button" className="sel-clear" data-testid="sel-clear" aria-label={tr('selClear', lang)} title={tr('selClear', lang) + ' · Esc'} onClick={onClear}>
        <Icon n="close" size={16} />
      </button>
      <span className="sel-count" aria-live="polite" data-testid="sel-count">
        {count > 0 ? tr('selCount', lang).replace('{n}', String(count)) : tr('selNone', lang)}
      </span>
      <span className="sel-actions">{children}</span>
    </div>
  );
}

/** Display form of a due date: ISO YYYY-MM-DD -> DD.MM, legacy strings as-is. */
export function fmtDue(due?: string): string {
  if (!due) return '';
  const m = due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}.${m[2]}`;
  return due;
}

export async function copyText(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

/** Permanent banner for blocked/failed/conflict states (Toast disappears,
 * Modal blocks): role="alert", actions supplied by the caller. */
export function StatusBanner({
  title,
  body,
  actions,
}: {
  title: string;
  body?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="g-banner g-banner-warn" role="alert">
      <div className="g-banner-t">{title}</div>
      {body && <div className="g-banner-sub">{body}</div>}
      {actions && <div className="g-banner-actions">{actions}</div>}
    </div>
  );
}

/** Catches render crashes (including failed lazy chunks): static fallback
 * with reload, raw export (reads the storage key directly, never state)
 * and a way back. Logs to console.error so the e2e guards see it; never
 * calls saveStore — a crash must not trigger a write. Remount via key=. */
export class ErrorBoundary extends Component<
  { lang: Lang; profileId: string | null; onHome: () => void; children: ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    console.error(
      'grafnot-boundary:',
      error instanceof Error ? error.message : String(error),
      info?.componentStack ?? '',
    );
  }

  render() {
    if (this.state.error) {
      const { lang, profileId, onHome } = this.props;
      return (
        <div className="g-error g-banner g-banner-warn" role="alert">
          <div className="g-banner-t">{tr('errT', lang)}</div>
          <div className="g-banner-sub">{tr('errBody', lang)}</div>
          <div className="g-banner-actions">
            <button type="button" className="g-btn" onClick={() => window.location.reload()}>
              {tr('errReload', lang)}
            </button>
            {profileId && (
              <button type="button" className="g-btn" onClick={() => exportRaw(storeKeyFor(profileId))}>
                {tr('downloadRaw', lang)}
              </button>
            )}
            <button type="button" className="g-btn ghost" onClick={onHome}>
              {tr('errHome', lang)}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
