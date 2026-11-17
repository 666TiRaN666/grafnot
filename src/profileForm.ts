import { useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { Profile } from "./profiles";
import { profileLabel } from "./profiles";

/** Longest profile name the create/rename forms accept. */
export const PROFILE_NAME_MAX = 40;

export type ProfileNameError = "empty" | "long" | "taken";

/** Validation of a typed profile name (create and rename, picker and Settings).
 * `taken` compares with the other profiles' stored names and shown labels
 * («Основной» shows as «Main»), ignoring case and outer spaces. profiles.ts
 * still de-duplicates as a safety net; this rule tells the person first. */
export function profileNameError(
  name: string,
  profiles: ReadonlyArray<Pick<Profile, "id" | "name">>,
  lang: Lang,
  ignoreId?: string,
): ProfileNameError | null {
  const clean = name.trim();
  if (!clean) return "empty";
  if (clean.length > PROFILE_NAME_MAX) return "long";
  const key = clean.toLocaleLowerCase();
  const taken = profiles.some(
    (p) => p.id !== ignoreId && (p.name.trim().toLocaleLowerCase() === key || profileLabel(p.name, lang).toLocaleLowerCase() === key),
  );
  return taken ? "taken" : null;
}

/** Text of a validation error for the field's message line. */
export function profileNameErrorText(err: ProfileNameError, name: string, lang: Lang): string {
  if (err === "empty") return tr("profileErrEmpty", lang);
  if (err === "long") return tr("profileErrLong", lang).replace("{len}", String(name.trim().length)).replace("{n}", String(PROFILE_NAME_MAX));
  return tr("profileErrTaken", lang).replace("{name}", name.trim());
}

/** Draft + validation state of one profile-name field. The error shows after
 * the first submit and then follows the typing live, so it never appears on
 * the first keystroke but clears as soon as the name is fixed. */
export function useProfileName(profiles: ReadonlyArray<Pick<Profile, "id" | "name">>, lang: Lang, ignoreId?: string) {
  const [value, setValue] = useState("");
  const [tried, setTried] = useState(false);
  const err = profileNameError(value, profiles, lang, ignoreId);
  return {
    value,
    error: tried && err ? profileNameErrorText(err, value, lang) : null,
    set: setValue,
    reset: (next = "") => {
      setValue(next);
      setTried(false);
    },
    /** Runs `ok` with the clean name when valid; otherwise shows the error. */
    submit: (ok: (name: string) => void): boolean => {
      setTried(true);
      if (err) return false;
      ok(value.trim());
      return true;
    },
  };
}
