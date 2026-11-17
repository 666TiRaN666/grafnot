import { useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { Profile, ProfileRegistry } from "./profiles";
import { profileLabel } from "./profiles";
import { useProfileName } from "./profileForm";
import { ProfileNameForm } from "./ProfileNameForm";
import { useArmConfirm } from "./useArmConfirm";

export interface ProfilePickerActions {
  onEnter: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/** First-run profile gate: enter an isolated profile or start a fresh empty one.
 * Pure view over the registry; persistence and migration live in App (punkt 5).
 * Delete runs through the shared arm-confirm; the last profile cannot be
 * removed (the module throws), so its delete button is hidden.
 */
export function ProfilePicker({
  lang,
  registry,
  actions,
}: {
  lang: Lang;
  registry: ProfileRegistry;
  actions: ProfilePickerActions;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const draft = useProfileName(registry.profiles, lang);
  const rename = useProfileName(registry.profiles, lang, renamingId ?? undefined);
  const delConfirm = useArmConfirm();

  const create = (name: string) => {
    actions.onCreate(name);
    draft.reset();
  };

  const startRename = (p: Profile) => {
    delConfirm.resetAll();
    setRenamingId(p.id);
    rename.reset(p.name);
  };

  const commitRename = (name: string) => {
    if (!renamingId) return;
    actions.onRename(renamingId, name);
    setRenamingId(null);
    rename.reset();
  };

  const remove = (id: string) => {
    if (delConfirm.confirm(`profile:${id}`)) actions.onDelete(id);
  };

  return (
    <div className="g-empty" data-testid="profile-picker">
      <div className="g-empty-t">{tr("profilesT", lang)}</div>
      <div className="g-empty-sub">{tr("profileEmpty", lang)}</div>
      {registry.profiles.map((p) => {
        const armed = delConfirm.isArmed(`profile:${p.id}`);
        return (
          <div className="g-sugg" key={p.id} data-testid={`profile-row-${p.id}`}>
            {renamingId === p.id ? (
              // Focused with the current name selected: typing renames,
              // never lands in the "new profile" field below (focus group).
              <ProfileNameForm
                lang={lang}
                field={rename}
                label={tr("profileRenameL", lang).replace("{name}", profileLabel(p.name, lang))}
                submitLabel={tr("saveBtn", lang)}
                onSubmit={commitRename}
                onCancel={() => setRenamingId(null)}
                autoFocus
                selectOnFocus
              />
            ) : (
              <>
                <button type="button" className="g-linkbtn" onClick={() => actions.onEnter(p.id)}>
                  • {profileLabel(p.name, lang)}
                </button>
                <span>
                  <button type="button" className="g-btn sm" onClick={() => actions.onEnter(p.id)}>
                    {tr("profileEnter", lang)}
                  </button>{" "}
                  <button type="button" className="g-btn sm ghost" onClick={() => startRename(p)}>
                    {tr("renameGo", lang)}
                  </button>{" "}
                  {registry.profiles.length > 1 && (
                    <button
                      type="button"
                      className={armed ? "g-btn sm g-danger-arm" : "g-btn sm ghost danger"}
                      onClick={() => remove(p.id)}
                    >
                      {armed ? tr("confirmPurge", lang) : tr("delForever", lang)}
                    </button>
                  )}
                </span>
              </>
            )}
          </div>
        );
      })}
      <ProfileNameForm
        lang={lang}
        field={draft}
        label={tr("profileNameL", lang)}
        submitLabel={tr("profileNew", lang)}
        onSubmit={create}
        testid="profile-name-in"
        primary
      />
    </div>
  );
}
