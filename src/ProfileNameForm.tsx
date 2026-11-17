import { useId } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import { PROFILE_NAME_MAX } from "./profileForm";
import type { useProfileName } from "./profileForm";

/** One profile-name form (create or rename; profile picker and Settings):
 * label above the field, the reason under it, Enter submits, Esc cancels.
 * The button stays enabled so pressing it explains what is wrong instead
 * of silently doing nothing. Validation lives in profileForm.ts. */
export function ProfileNameForm({
  lang,
  field,
  label,
  submitLabel,
  onSubmit,
  onCancel,
  testid,
  autoFocus,
  selectOnFocus,
  primary,
}: {
  lang: Lang;
  field: ReturnType<typeof useProfileName>;
  label: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
  testid?: string;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
  primary?: boolean;
}) {
  const id = useId();
  const msgId = id + "-msg";
  return (
    <form
      className="g-pform"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        field.submit(onSubmit);
      }}
    >
      <label className="g-pform-l" htmlFor={id}>
        {label}
      </label>
      <div className="g-pform-row">
        <input
          id={id}
          className="g-in"
          data-testid={testid}
          autoComplete="off"
          autoFocus={autoFocus}
          onFocus={selectOnFocus ? (e) => e.currentTarget.select() : undefined}
          value={field.value}
          onChange={(e) => field.set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && onCancel) {
              e.preventDefault();
              onCancel();
            }
          }}
          aria-invalid={field.error ? true : undefined}
          aria-describedby={msgId}
        />
        <button type="submit" className={"g-btn sm" + (primary ? " primary" : "")}>
          {submitLabel}
        </button>
      </div>
      {field.error ? (
        <p id={msgId} className="g-pform-err" role="alert" data-testid={testid ? testid + "-error" : undefined}>
          {field.error}
        </p>
      ) : (
        <p id={msgId} className="g-pform-hint">
          {tr("profileNameHint", lang).replace("{n}", String(PROFILE_NAME_MAX))}
        </p>
      )}
    </form>
  );
}
