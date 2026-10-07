export interface SearchItem {
  id: string;
  kind: 'note' | 'task' | 'date' | 'prompt';
  title: string;
  sub: string;
  refId: string;
}

export type AIModel = 'Pony' | 'SDXL' | 'Flux';

export interface LlmTpl {
  id: string;
  /** Optional display filter for custom image templates. Built-ins infer this from id. */
  kind?: 'image';
  /** Short human name — card title and saved-item title. Plain text. */
  name: string;
  /**
   * Free-form body with {{named}} slots in any place and any count, e.g.
   * 'План по {{предмет}} на {{дней}} дней'. Engine: listSlots/fillBody
   * in promptUtils. Slot order in the body is the field order in the UI.
   */
  body: string;
  /** Default value per slot name (missing = ''). */
  defaults: Record<string, string>;
}

export const LLM_TEMPLATES: LlmTpl[] = [
  {
    id: 'cr',
    name: 'Code review',
    body: 'Проверь код ({{язык}}). Уровень: {{уровень}}. Найди баги и предложи улучшения.\nКод:\n{{код}}',
    defaults: { язык: 'TypeScript', уровень: '1 курс', код: '' },
  },
  {
    id: 'sql',
    name: 'SQL explain',
    body: 'Объясни запрос:\n{{запрос}}\nДиалект: {{диалект}}. Разбери по шагам и предложи ускорение.',
    defaults: { запрос: 'SELECT 1', диалект: 'Postgres' },
  },
  {
    id: 'ent',
    name: 'ENT plan',
    body: 'Составь план подготовки к {{предмет}} на {{дней}} дней. Уровень: {{уровень}}.',
    defaults: { предмет: 'Математика', дней: '14', уровень: 'средний' },
  },
  {
    id: 'art',
    name: 'Арт: персонаж',
    body: 'masterpiece, best quality, 1girl, {{волосы}} hair, {{глаза}} eyes, {{одежда}}, {{фон}}, {{свет}}',
    defaults: { волосы: 'long black', глаза: 'blue', одежда: 'school uniform', фон: 'sunset', свет: 'soft lighting' },
  },
];
