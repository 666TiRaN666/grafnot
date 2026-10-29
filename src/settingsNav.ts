import { tr } from './i18n';
import type { Lang } from './i18n';

// The trash left settings for its own section (#/trash); router.ts sends
// old #/settings/trash links there.
export type SettingsSection = 'profiles' | 'appearance' | 'keys' | 'data';

export const SETTINGS_SECTIONS: SettingsSection[] = ['profiles', 'appearance', 'keys', 'data'];

export function isSettingsSection(v: string | undefined): v is SettingsSection {
  return v === 'profiles' || v === 'appearance' || v === 'keys' || v === 'data';
}

export function settingsSectionTitle(s: SettingsSection, lang: Lang): string {
  switch (s) {
    case 'profiles':
      return tr('profilesT', lang);
    case 'appearance':
      return tr('setAppearance', lang);
    case 'keys':
      return tr('shortcutsT', lang);
    case 'data':
      return tr('setData', lang);
  }
}
