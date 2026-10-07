import { useState } from "react";
import type { Lang } from "./i18n";
import { tr } from "./i18n";
import type { Profile, ProfileRegistry } from "./profiles";
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
  const [draft, setDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const delConfirm = useArmConfirm();

  const create = () => {
    const name = draft.trim();
    if (!name) return;
    actions.onCreate(name);
    setDraft("");
  };

  const startRename = (p: Profile) => {
    delConfirm.resetAll();
    setRenamingId(p.id);
    setRenameDraft(p.name);
  };

  const commitRename = () => {
    if (!renamingId || !renameDraft.trim()) return;
    actions.onRename(renamingId, renameDraft.trim());
    setRenamingId(null);
    setRenameDraft("");
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
              <>
                <input
                  className="g-in"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") setRenamingId(null);
                  }}
                  aria-label={tr("renameGo", lang)}
                />
                <span>
                  <button
                    type="button"
                    className="g-linkbtn"
                    disabled={!renameDraft.trim()}
                    onClick={commitRename}
                  >
                    [{tr("renameGo", lang)}]
                  </button>
                </span>
              </>
            ) : (
              <>
                <button type="button" className="g-linkbtn" onClick={() => actions.onEnter(p.id)}>
                  • {p.name}
                </button>
                <span>
                  <button type="button" className="g-linkbtn" onClick={() => actions.onEnter(p.id)}>
                    [{tr("profileEnter", lang)}]
                  </button>{" "}
                  <button type="button" className="g-linkbtn" onClick={() => startRename(p)}>
                    [{tr("renameGo", lang)}]
                  </button>{" "}
                  {registry.profiles.length > 1 && (
                    <button
                      type="button"
                      className={armed ? "g-linkbtn g-danger-arm" : "g-linkbtn"}
                      onClick={() => remove(p.id)}
                    >
                      {armed ? tr("confirmPurge", lang) : `[${tr("delForever", lang)}]`}
                    </button>
                  )}
                </span>
              </>
            )}
          </div>
        );
      })}
      <div className="g-ops">
        <input
          className="g-in"
          data-testid="profile-name-in"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
          placeholder={tr("profileNamePh", lang)}
          aria-label={tr("profileNamePh", lang)}
        />
        <button type="button" className="g-btn primary" disabled={!draft.trim()} onClick={create}>
          {tr("profileNew", lang)}
        </button>
      </div>
    </div>
  );
}
