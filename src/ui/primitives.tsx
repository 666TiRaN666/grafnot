import { useEffect, useRef, type ButtonHTMLAttributes } from 'react';
import './primitives.css';

/* The S1 primitive set was never adopted by the pages (they use the g-*
 * classes of index.css); only the confirmation dialog lives on. Button,
 * Field, Popover, Drawer and the rest were removed in 2026-11 so that new
 * code does not pick up a second, unused button system. */

type BtnVariant = 'primary' | 'ghost' | 'danger';

function Button({ variant, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant: BtnVariant }) {
  return <button type="button" data-variant={variant} className="u-btn" {...rest} />;
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
