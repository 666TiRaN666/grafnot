import { useState } from 'react';
import { tr } from './i18n';
import type { Lang, Theme } from './i18n';
import type { Note, TaskItem } from './store';
import type { ProfileRegistry } from './profiles';
import { ConfirmDialog } from './ui/primitives';
import { SETTINGS_SECTIONS, settingsSectionTitle } from './settingsNav';
import type { SettingsSection } from './settingsNav';
import { SHORTCUTS } from './shortcuts';

/** S2 settings as a page (#/settings/<section>), not a modal. Destructive
 * actions (profile delete, trash purge) confirm through ConfirmDialog. */
export function SettingsPage({
  lang,
  section,
  onSection,
  theme,
  onTheme,
  onLang,
  registry,
  onEnterProfile,
  onCreateProfile,
  onRenameProfile,
  onDeleteProfile,
  onSwitchProfile,
  trash,
  trashTasks,
  onRestoreNote,
  onRestoreTask,
  onPurgeNote,
  onPurgeTask,
  onExportData,
}: {
  lang: Lang;
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onLang: (l: Lang) => void;
  registry: ProfileRegistry;
  onEnterProfile: (id: string) => void;
  onCreateProfile: (name: string) => void;
  onRenameProfile: (id: string, name: string) => void;
  onDeleteProfile: (id: string) => void;
  onSwitchProfile: () => void;
  trash: Note[];
  trashTasks: TaskItem[];
  onRestoreNote: (id: string) => void;
  onRestoreTask: (id: string) => void;
  onPurgeNote: (id: string) => void;
  onPurgeTask: (id: string) => void;
  onExportData: () => void;
}) {
  const [trashQ, setTrashQ] = useState('');
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingPurge, setPendingPurge] = useState<{ kind: 'note' | 'task'; id: string; title: string } | null>(null);
  const [pendingProfile, setPendingProfile] = useState<{ id: string; name: string } | null>(null);

  const needle = trashQ.trim().toLowerCase();
  const shownTrash = needle ? trash.filter((n) => `${n.title} ${n.text}`.toLowerCase().includes(needle)) : trash;
  const shownTasks = needle
    ? trashTasks.filter((t) => `${t.text} ${t.desc ?? ''}`.toLowerCase().includes(needle))
    : trashTasks;

  const commitRename = () => {
    if (renamingId && renameDraft.trim()) onRenameProfile(renamingId, renameDraft.trim());
    setRenamingId(null);
    setRenameDraft('');
  };

  return (
    <div className="g-page" data-testid="settings-page">
      <div className="g-page-h">
        <h2 className="g-h2">{tr('settings', lang)}</h2>
      </div>
      <div className="g-seg" role="group" aria-label="settings sections">
        {SETTINGS_SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            data-testid={`settings-nav-${s}`}
            className={`g-btn sm${section === s ? ' active' : ''}`}
            onClick={() => onSection(s)}
          >
            {settingsSectionTitle(s, lang)}
          </button>
        ))}
      </div>

      {section === 'profiles' && (
        <div>
          {registry.profiles.map((p) => (
            <div className="g-sugg" key={p.id}>
              {renamingId === p.id ? (
                <span>
                  <input
                    className="g-in"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    aria-label={tr('profileNamePh', lang)}
                  />
                  <button type="button" className="g-linkbtn" onClick={commitRename}>
                    [{tr('saveBtn', lang)}]
                  </button>
                </span>
              ) : (
                <span>{p.name}</span>
              )}
              <span>
                <button type="button" className="g-linkbtn" onClick={() => onEnterProfile(p.id)}>
                  [{tr('profileEnter', lang)}]
                </button>{' '}
                <button
                  type="button"
                  className="g-linkbtn"
                  onClick={() => {
                    setRenamingId(p.id);
                    setRenameDraft(p.name);
                  }}
                >
                  [{tr('renameGo', lang)}]
                </button>{' '}
                {registry.profiles.length > 1 && (
                  <button
                    type="button"
                    className="g-linkbtn"
                    onClick={() => setPendingProfile({ id: p.id, name: p.name })}
                  >
                    [{tr('delForever', lang)}]
                  </button>
                )}
              </span>
            </div>
          ))}
          <div className="g-addtask">
            <input
              data-testid="profile-name-in"
              className="g-in"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  onCreateProfile(newName.trim());
                  setNewName('');
                }
              }}
              placeholder={tr('profileNamePh', lang)}
              aria-label={tr('profileNamePh', lang)}
            />
            <button
              type="button"
              className="g-btn sm"
              onClick={() => {
                if (newName.trim()) {
                  onCreateProfile(newName.trim());
                  setNewName('');
                }
              }}
            >
              {tr('profileNew', lang)}
            </button>
          </div>
          <div className="g-field">
            <button type="button" className="g-btn sm g-wide" onClick={onSwitchProfile}>
              {tr('switchProfile', lang)}
            </button>
          </div>
        </div>
      )}

      {section === 'appearance' && (
        <div>
          <div className="g-field">
            <span>{tr('themeL', lang)}</span>
            <div className="g-seg" role="group" aria-label="theme">
              <button
                type="button"
                className={'g-btn sm' + (theme === 'light' ? ' active' : '')}
                onClick={() => onTheme('light')}
              >
                {tr('themeLight', lang)}
              </button>
              <button
                type="button"
                className={'g-btn sm' + (theme === 'dark' ? ' active' : '')}
                onClick={() => onTheme('dark')}
              >
                {tr('themeDark', lang)}
              </button>
            </div>
          </div>
          <div className="g-field">
            <span>{tr('langL', lang)}</span>
            <div className="g-seg" role="group" aria-label="lang">
              {(['RU', 'EN', 'KZ'] as Lang[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={'g-btn sm' + (lang === l ? ' active' : '')}
                  onClick={() => onLang(l)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {section === 'trash' && (
        <div>
          <div className="g-notes-tools">
            <input
              className="g-in"
              value={trashQ}
              onChange={(e) => setTrashQ(e.target.value)}
              placeholder={tr('trashSearchPh', lang)}
              aria-label={tr('trashSearchPh', lang)}
            />
          </div>
          {shownTrash.length === 0 && shownTasks.length === 0 && (
            <div className="muted">{tr('emptyTrash', lang)}</div>
          )}
          {shownTrash.map((n) => (
            <div className="g-sugg" key={n.id}>
              <span>{n.title}</span>
              <span>
                <button type="button" className="g-linkbtn" onClick={() => onRestoreNote(n.id)}>
                  [{tr('restoreBtn', lang)}]
                </button>{' '}
                <button
                  type="button"
                  className="g-linkbtn"
                  onClick={() => setPendingPurge({ kind: 'note', id: n.id, title: n.title })}
                >
                  [{tr('delForever', lang)}]
                </button>
              </span>
            </div>
          ))}
          {shownTasks.length > 0 && <div className="g-card-t sub">{tr('tasks', lang)}</div>}
          {shownTasks.map((t) => (
            <div className="g-sugg" key={t.id}>
              <span>{t.text}</span>
              <span>
                <button type="button" className="g-linkbtn" onClick={() => onRestoreTask(t.id)}>
                  [{tr('restoreBtn', lang)}]
                </button>{' '}
                <button
                  type="button"
                  className="g-linkbtn"
                  onClick={() => setPendingPurge({ kind: 'task', id: t.id, title: t.text })}
                >
                  [{tr('delForever', lang)}]
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {section === 'keys' && (
        <div>
          {SHORTCUTS.map((s) => (
            <div className="g-sugg" data-testid="keys-row" key={s.id}>
              <span>{tr(s.labelKey, lang)}</span>
              <kbd className="g-kbd">{s.keys}</kbd>
            </div>
          ))}
        </div>
      )}

      {section === 'data' && (
        <div className="g-field">
          <button type="button" className="g-btn" onClick={onExportData}>
            {tr('exportData', lang)}
          </button>
        </div>
      )}

      {pendingPurge && (
        <ConfirmDialog
          title={tr('delForever', lang)}
          message={pendingPurge.title}
          confirmLabel={tr('confirmPurge', lang)}
          cancelLabel={tr('cancelBtn', lang)}
          danger
          onConfirm={() => {
            if (pendingPurge.kind === 'note') onPurgeNote(pendingPurge.id);
            else onPurgeTask(pendingPurge.id);
            setPendingPurge(null);
          }}
          onCancel={() => setPendingPurge(null)}
        />
      )}
      {pendingProfile && (
        <ConfirmDialog
          title={tr('delForever', lang)}
          message={pendingProfile.name}
          confirmLabel={tr('confirmPurge', lang)}
          cancelLabel={tr('cancelBtn', lang)}
          danger
          onConfirm={() => {
            onDeleteProfile(pendingProfile.id);
            setPendingProfile(null);
          }}
          onCancel={() => setPendingProfile(null)}
        />
      )}
    </div>
  );
}
