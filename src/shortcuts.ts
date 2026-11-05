// S12: единый реестр шорткатов. Из него строятся Настройки → Клавиши,
// e2e-матрица G28 проверяет каждый зарегистрированный шорткат.
// labelKey — ключ STR (i18n ×3); check-i18n считает labelKey:... использованием.
export type ShortcutScope =
  | 'global'
  | 'notes'
  | 'plan-list'
  | 'plan-week'
  | 'map'
  | 'prompts'
  | 'trash';

export interface Shortcut {
  id: string;
  /** Показ в <kbd>, напр. 'Ctrl+K'. */
  keys: string;
  /** Ключ STR с подписью ×3. */
  labelKey: string;
  scope: ShortcutScope;
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'palette', keys: 'Ctrl+K', labelKey: 'scSearch', scope: 'global' },
  { id: 'panels-reset', keys: 'Alt+0', labelKey: 'scPanels', scope: 'global' },
  { id: 'note-new', keys: 'Ctrl+Alt+N', labelKey: 'scNew', scope: 'global' },
  { id: 'search-leave', keys: 'Esc', labelKey: 'scSearchLeave', scope: 'global' },
  { id: 'notes-search', keys: '/', labelKey: 'scNotesSearch', scope: 'notes' },
  { id: 'notes-new', keys: 'N', labelKey: 'scNew', scope: 'notes' },
  { id: 'note-task', keys: 'Ctrl+Alt+T', labelKey: 'scNoteTask', scope: 'notes' },
  { id: 'note-link', keys: '[[', labelKey: 'scNoteLink', scope: 'notes' },
  { id: 'note-link-open', keys: 'Ctrl+Click', labelKey: 'scLinkOpen', scope: 'notes' },
  { id: 'plan-search', keys: '/', labelKey: 'scPlanSearch', scope: 'plan-list' },
  { id: 'plan-new', keys: 'N', labelKey: 'scPlanNew', scope: 'plan-list' },
  { id: 'task-open', keys: 'Enter', labelKey: 'scTaskOpen', scope: 'plan-list' },
  { id: 'task-delete', keys: 'Delete', labelKey: 'scTaskDel', scope: 'plan-list' },
  { id: 'week-nav', keys: '← →', labelKey: 'scWeekNav', scope: 'plan-week' },
  { id: 'week-today', keys: 'T', labelKey: 'scWeekToday', scope: 'plan-week' },
  { id: 'map-search', keys: '/', labelKey: 'scMapSearch', scope: 'map' },
  { id: 'lib-search', keys: '/', labelKey: 'scLibSearch', scope: 'prompts' },
  { id: 'lib-new', keys: 'N', labelKey: 'scLibNew', scope: 'prompts' },
  { id: 'trash-search', keys: '/', labelKey: 'scTrashSearch', scope: 'trash' },
  { id: 'builder-field', keys: 'Ctrl+Shift+F', labelKey: 'scBuilderField', scope: 'prompts' },
  { id: 'wb-copy', keys: 'Ctrl+Enter', labelKey: 'scWbCopy', scope: 'prompts' },
  { id: 'builder-save', keys: 'Ctrl+S', labelKey: 'scBuilderSave', scope: 'prompts' },
  { id: 'tag-move', keys: 'Alt+← →', labelKey: 'scTagMove', scope: 'prompts' },
];
