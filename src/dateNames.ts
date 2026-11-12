import type { Lang } from './i18n';

/** Kazakh names spelled out: browsers often lack kk-KZ calendar data and
 * fall back to English (focus group: "Mon, Tue…", "2026 M10"). */
const KZ_WEEKDAYS = ['Жс', 'Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сн'];
const KZ_MONTHS = ['Қаңтар', 'Ақпан', 'Наурыз', 'Сәуір', 'Мамыр', 'Маусым', 'Шілде', 'Тамыз', 'Қыркүйек', 'Қазан', 'Қараша', 'Желтоқсан'];

const locOf = (lang: Lang) => (lang === 'EN' ? 'en-US' : 'ru-RU');

export function weekdayShort(date: Date, lang: Lang): string {
  if (lang === 'KZ') return KZ_WEEKDAYS[date.getDay()] ?? '';
  return new Intl.DateTimeFormat(locOf(lang), { weekday: 'short' }).format(date);
}

/** "9–15 ноября 2026" / "Nov 30 – Dec 6, 2026" / "9–15 Қараша 2026": the shown week. */
export function weekRangeLabel(from: Date, to: Date, lang: Lang): string {
  if (lang === 'KZ') {
    const m1 = KZ_MONTHS[from.getMonth()] ?? '', m2 = KZ_MONTHS[to.getMonth()] ?? '';
    return from.getMonth() === to.getMonth()
      ? `${from.getDate()}–${to.getDate()} ${m2} ${to.getFullYear()}`
      : `${from.getDate()} ${m1} – ${to.getDate()} ${m2} ${to.getFullYear()}`;
  }
  const f = new Intl.DateTimeFormat(locOf(lang), { day: 'numeric', month: 'long', year: 'numeric' });
  return f.formatRange(from, to).replace(/\s*г\.$/, '');
}

/** "20 ноября" / "November 20" / "20 қараша". */
export function dayMonth(date: Date, lang: Lang): string {
  if (lang === 'KZ') return `${date.getDate()} ${(KZ_MONTHS[date.getMonth()] ?? '').toLocaleLowerCase('kk')}`;
  return new Intl.DateTimeFormat(locOf(lang), { day: 'numeric', month: 'long' }).format(date);
}
