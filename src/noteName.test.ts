import { describe, expect, it } from 'vitest';
import type { Note } from './store';
import { NOTE_NAME_MAX, noteAccessibleName, noteDisplayName, noteFileName } from './noteName';

const note = (title = '', text = ''): Note => ({ id: 'n', title, text, content: '', linkedIds: [], calcs: [], updated: Date.UTC(2026, 9, 29) });

describe('W6 unnamed note presentation', () => {
  it('uses the first nonempty line without changing the stored note', () => {
    const n = note('', '\n  Первая   строка \nВторая');
    const before = JSON.stringify(n);
    expect(noteDisplayName(n, 'RU')).toBe('Первая строка');
    expect(JSON.stringify(n)).toBe(before);
  });
  it('localizes an empty note in all three languages', () => {
    expect(noteDisplayName(note(), 'RU')).toBe('Без названия');
    expect(noteDisplayName(note(), 'EN')).toBe('Untitled');
    expect(noteDisplayName(note(), 'KZ')).toBe('Атаусыз');
  });
  it('keeps explicit and legacy titles unchanged', () => {
    for (const title of ['Lecture', 'Новая заметка 2']) expect(noteDisplayName(note(title, 'Body'), 'KZ')).toBe(title);
  });
  it('caps derived names by Unicode code points with an ellipsis', () => {
    const result = noteDisplayName(note('', '🙂'.repeat(NOTE_NAME_MAX + 3)), 'RU');
    expect(Array.from(result)).toHaveLength(NOTE_NAME_MAX);
    expect(result.endsWith('…')).toBe(true);
    expect(result.includes('\uFFFD')).toBe(false);
  });
  it('distinguishes derived accessible names from explicit ones', () => {
    expect(noteAccessibleName(note('', 'Ә Ғ Қ Ң Ө Ұ Ү Һ І'), 'KZ')).toBe('Атаусыз: Ә Ғ Қ Ң Ө Ұ Ү Һ І');
    expect(noteAccessibleName(note(), 'RU')).toBe('Без названия');
    expect(noteAccessibleName(note('Named', 'Body'), 'RU')).toBe('Named');
  });
  it('allows identical derived names for distinct note ids', () => {
    const a: Note = { ...note('', 'Same'), id: 'a' };
    const b: Note = { ...note('', 'Same'), id: 'b' };
    expect(noteDisplayName(a, 'EN')).toBe(noteDisplayName(b, 'EN'));
  });
  it('sanitizes computed and explicit download filenames', () => {
    expect(noteFileName(note('', 'Read / write: <draft>*?'), 'EN')).toBe('Read write draft.md');
    expect(noteFileName(note('Alpha'), 'RU')).toBe('Alpha.md');
    expect(noteFileName(note('Trailing... '), 'RU')).toBe('Trailing.md');
  });
  it('uses a dated filename for empty, illegal or reserved names', () => {
    for (const n of [note(), note('CON'), note('NUL.txt'), note('', ' / : * ? ')]) expect(noteFileName(n, 'RU')).toBe('note-2026-10-29.md');
  });
});
