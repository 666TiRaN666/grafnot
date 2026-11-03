import { describe, expect, it } from 'vitest';
import { backupFileName, importedProfileName } from './exportRaw';

describe('backup file names', () => {
  const day = new Date(2026, 9, 31);
  it('names a copy by profile and date', () => {
    expect(backupFileName('Основной', 'current', day)).toBe('grafnot-Основной-2026-10-31.json');
    expect(backupFileName('Work: notes', 'saved', day)).toBe('grafnot-Work-notes-saved-2026-10-31.json');
    expect(backupFileName('  ', 'current', day)).toBe('grafnot-profile-2026-10-31.json');
  });
  it('a restored copy is named after its profile, not after the file', () => {
    expect(importedProfileName('grafnot-Основной-2026-10-31.json', 'Restored')).toBe('Основной');
    expect(importedProfileName('grafnot-Work-notes-saved-2026-10-31 (1).json', 'Restored')).toBe('Work-notes');
    expect(importedProfileName('grafnot-store-unsaved.json', 'Restored')).toBe('Restored');
    expect(importedProfileName('grafnot-store-p1.json', 'Restored')).toBe('Restored');
    expect(importedProfileName('my notes.json', 'Restored')).toBe('my notes');
  });
});
