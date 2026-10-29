import type { Lang } from './i18n';
import { tr } from './i18n';
import type { Note } from './store';

type NamedNote = Pick<Note, 'title' | 'text'>;
export const NOTE_NAME_MAX = 80;

/** Presentation only: ids stay authoritative and no name is written to the note. */
export function noteDisplayName(note: NamedNote, lang: Lang): string {
  if (note.title.trim()) return note.title;
  const line = note.text.split(/\r\n?|\n/).find(s => s.trim())?.trim().replace(/\s+/g, ' ');
  if (!line) return tr('untitledNote', lang);
  const points = Array.from(line);
  return points.length > NOTE_NAME_MAX ? points.slice(0, NOTE_NAME_MAX - 1).join('') + '…' : line;
}

export function noteAccessibleName(note: NamedNote, lang: Lang): string {
  const name = noteDisplayName(note, lang);
  return !note.title.trim() && note.text.trim() ? tr('untitledNote', lang) + ': ' + name : name;
}

export function noteUpdatedLabel(note: Pick<Note, 'updated'>, lang: Lang): string {
  return new Date(note.updated).toLocaleString(lang === 'KZ' ? 'kk-KZ' : lang === 'EN' ? 'en-US' : 'ru-RU', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function noteFileName(note: NamedNote & Pick<Note, 'updated'>, lang: Lang): string {
  const raw = note.title.trim() || note.text.trim() ? noteDisplayName(note, lang) : '';
  const clean = Array.from(raw).filter(char => char.charCodeAt(0) >= 32 && !/[<>:"/\\|?*]/.test(char)).join('').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean);
  const date = new Date(Number.isFinite(note.updated) ? note.updated : 0).toISOString().slice(0, 10);
  return (clean && !reserved ? clean : 'note-' + date) + '.md';
}
