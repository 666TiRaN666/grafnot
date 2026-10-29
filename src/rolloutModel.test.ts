import { describe, expect, it } from 'vitest';
import { canPinContext, mobileAddAction, promptTargetMatches } from './rolloutModel';
describe('first pass UI decisions', () => {
  it('pins context only when 560px of editor measure remains', () => {
    expect(canPinContext(1227)).toBe(false);
    expect(canPinContext(1228)).toBe(true);
  });
  it('resolves mobile add by section and the explicit user preference', () => {
    expect(mobileAddAction('plan', 'section')).toBe('task');
    expect(mobileAddAction('prompts', 'section')).toBe('prompt');
    expect(mobileAddAction('map', 'section')).toBe('note');
    expect(mobileAddAction('plan', 'note')).toBe('note');
    expect(mobileAddAction('notes', 'choose')).toBe('choose');
  });
  it('accepts an insertion only in its original profile, session and note', () => {
    const a = { profileId: 'p1', epoch: 1, noteId: 'n1' };
    expect(promptTargetMatches(a, { ...a })).toBe(true);
    expect(promptTargetMatches(a, { ...a, epoch: 2 })).toBe(false);
    expect(promptTargetMatches(a, { ...a, profileId: 'p2' })).toBe(false);
    expect(promptTargetMatches(a, { ...a, noteId: 'n2' })).toBe(false);
  });
});
