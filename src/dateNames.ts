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

/** "Октябрь 2026" / "October 2026" / "Қазан 2026": first letter only raised. */
export function monthYear(date: Date, lang: Lang): string {
  if (lang === 'KZ') return `${KZ_MONTHS[date.getMonth()] ?? ''} ${date.getFullYear()}`;
  const t = new Intl.DateTimeFormat(locOf(lang), { month: 'long', year: 'numeric' }).format(date);
  return t.charAt(0).toLocaleUpperCase(locOf(lang)) + t.slice(1);
}
