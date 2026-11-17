import { describe, expect, it } from 'vitest';
import { PROFILE_NAME_MAX, profileNameError } from './profileForm';

const profiles = [
  { id: 'p1', name: 'Учёба' },
  { id: 'p2', name: 'Основной' },
];

describe('profileNameError (create/rename form validation)', () => {
  it('requires a name', () => {
    expect(profileNameError('', profiles, 'RU')).toBe('empty');
    expect(profileNameError('   ', profiles, 'RU')).toBe('empty');
  });
  it('limits the length after trimming', () => {
    expect(profileNameError('a'.repeat(PROFILE_NAME_MAX), profiles, 'RU')).toBeNull();
    expect(profileNameError(' ' + 'a'.repeat(PROFILE_NAME_MAX) + ' ', profiles, 'RU')).toBeNull();
    expect(profileNameError('a'.repeat(PROFILE_NAME_MAX + 1), profiles, 'RU')).toBe('long');
  });
  it('rejects a name another profile already has, ignoring case and spaces', () => {
    expect(profileNameError(' учёба ', profiles, 'RU')).toBe('taken');
  });
  it('compares with the shown label of the default profile too', () => {
    // «Основной» is shown as «Main» in English.
    expect(profileNameError('main', profiles, 'EN')).toBe('taken');
  });
  it('lets a profile keep its own name on rename', () => {
    expect(profileNameError('Учёба', profiles, 'RU', 'p1')).toBeNull();
  });
  it('accepts a new unique name', () => {
    expect(profileNameError('Работа', profiles, 'RU')).toBeNull();
  });
});
