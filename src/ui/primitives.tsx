import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import './primitives.css';

export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type BtnSize = 'sm' | 'md' | 'lg';

export function Button({
  variant = 'secondary',
  size = 'md',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return <button type="button" data-variant={variant} data-size={size} className="u-btn" {...rest} />;
}

/** Icon-only button: screen-reader name is mandatory (compile-time enforced). */
export function IconButton(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label': string },
) {
  return <button type="button" className="u-iconbtn" {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="u-field">
      <label>{label}</label>
      {children}
      {error ? <span className="u-error">{error}</span> : hint ? <span className="u-hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="u-in" {...props} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="u-area" {...props} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="u-select" {...props} />;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="u-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  pressed,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) {
  return <button type="button" className="u-chip" aria-pressed={pressed ?? false} {...rest} />;
}

export function ListRow({
  title,
  snippet,
  meta,
  selected,
  onOpen,
  actions,
  left,
}: {
  title: string;
  snippet?: string;
  meta?: string;
  selected?: boolean;
  onOpen: () => void;
  actions?: ReactNode;
  left?: ReactNode;
}) {
  return (
    <div className="u-row" data-selected={selected ? 'true' : undefined}>
      {left}
      <button type="button" className="u-row-main" onClick={onOpen}>
        <span>{title}</span>
        {snippet ? <div className="u-hint">{snippet}</div> : null}
        {meta ? <div className="u-row-meta">{meta}</div> : null}
      </button>
      {actions}
    </div>
  );
}

/** Anchor-bound popover shell: position comes from computePlacement().
 * Esc closes, focus returns to the opener. No page uses it yet (S1). */
export function Popover({
  x,
  y,
  onClose,
  children,
  label,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    openerRef.current = document.activeElement;
    boxRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, []);
  return (
    <div ref={boxRef} className="u-pop" role="dialog" aria-label={label} tabIndex={-1} style={{ left: x, top: y }}>
      {children}
    </div>
  );
}

export function Drawer({
  onClose,
  children,
  label,
}: {
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="u-drawer" role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  actionLabel,
  onAction,
}: {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="u-empty">
      <div>{title}</div>
      {hint ? <div className="u-hint">{hint}</div> : null}
      {actionLabel && onAction ? (
        <p>
          <Button variant="primary" onClick={onAction}>
            {actionLabel}
          </Button>
        </p>
      ) : null}
    </div>
  );
}

export function Kbd({ keys }: { keys: string }) {
  return <kbd className="u-kbd">{keys}</kbd>;
}

export function Skeleton({ label }: { label: string }) {
  return <div className="u-skel" aria-hidden="true" aria-label={label} />;
}

/** Centered confirmation: only for irreversible actions (N4). Labels are
 * caller-provided so no new i18n keys are introduced in S1. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelFn = useRef(onCancel);
  useEffect(() => {
    cancelFn.current = onCancel;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancelFn.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="u-confirm-b">
      <div className="u-confirm" role="alertdialog" aria-label={title}>
        <div>{title}</div>
        {message ? <p className="u-hint">{message}</p> : null}
        <div className="u-confirm-actions">
          <Button variant="ghost" onClick={onCancel} autoFocus>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
