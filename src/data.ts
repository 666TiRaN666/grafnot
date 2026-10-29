import { renderSkill } from './skillModel';

export interface SearchItem {
  id: string;
  kind: 'note' | 'task' | 'date' | 'prompt';
  title: string;
  sub: string;
  refId: string;
}

export type AIModel = 'Pony' | 'SDXL' | 'Flux' | 'Midjourney';

/** Lanes of the image constructor, in the order a model reads a prompt. */
export type TagCat = 'quality' | 'subject' | 'look' | 'outfit' | 'pose' | 'scene' | 'light' | 'style' | 'camera' | 'other';

export type AspectId = '1:1' | '4:5' | '3:4' | '2:3' | '9:16' | '16:9' | '3:2';

/** What a skill/instruction file is rendered as (skillModel). */
export type SkillFormat = 'skill' | 'system' | 'agents';

/** Structured source of an AI instruction: one spec, three renderings. */
export interface SkillSpec {
  format: SkillFormat;
  /** Machine name for SKILL.md (kebab-case). */
  name: string;
  /** What the skill does, in one or two sentences. */
  description: string;
  /** When the model should use it (goes into the description trigger). */
  whenToUse: string;
  /** One step per line. */
  steps: string;
  /** One rule per line. */
  rules: string;
  /** Expected answer shape. */
  output: string;
  examples: { input: string; output: string }[];
}

export interface LlmTpl {
  id: string;
  /** Optional display filter: image constructor or skill builder. Built-ins infer image from id. */
  kind?: 'image' | 'skill';
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
  /** v6, image templates: constructor state (body is its render). Absent on old records. */
  model?: AIModel;
  tokens?: string[];
  /** Image constructor extras: excluded tags, frame, Pony quality prefix, user lane choices. */
  negative?: string[];
  aspect?: AspectId;
  ponyScore?: boolean;
  tagCats?: Record<string, TagCat>;
  /** Skill builder source; body is its rendering. */
  skill?: SkillSpec;
}

/** Built-in skills: worked examples of each format; a copy is edited. */
const BUILTIN_SKILLS: { id: string; name: string; skill: SkillSpec }[] = [
  {
    id: 'sk-review',
    name: 'Навык: ревью кода',
    skill: {
      format: 'skill',
      name: 'code-review',
      description: 'Проверяет изменения в коде на ошибки, риски и непонятные места',
      whenToUse: 'пользователь просит проверить код, diff или pull request',
      steps: 'Прочитай изменения целиком и пойми их цель\nНайди ошибки: логика, граничные случаи, обработка ошибок\nОтметь риски безопасности и потери данных\nПредложи исправление для каждой находки',
      rules: 'Указывай файл и строку\nСначала самые серьёзные находки\nНе придирайся к стилю, если он не мешает пониманию\nНе выдумывай код, которого нет в изменениях',
      output: 'Нумерованный список: файл:строка — проблема — как исправить. В конце — одна строка с общей оценкой.',
      examples: [{ input: 'Проверь мой патч: добавил загрузку файла', output: '1. upload.ts:42 — размер файла не проверяется, можно забить диск — ограничить 10 МБ.' }],
    },
  },
  {
    id: 'sk-tutor',
    name: 'Системный промпт: репетитор',
    skill: {
      format: 'system',
      name: 'Репетитор',
      description: 'Ты терпеливый репетитор, который учит думать, а не выдаёт готовые ответы',
      whenToUse: 'студент разбирает задачу или тему',
      steps: 'Выясни, что студент уже знает\nДай подсказку, а не решение\nПопроси студента сделать следующий шаг самому\nВ конце кратко подведи итог',
      rules: 'Один вопрос за раз\nПроверяй понимание на маленьком примере\nЕсли студент просит готовый ответ — объясни, почему полезнее дойти самому',
      output: 'Короткие сообщения, до 5 предложений.',
      examples: [],
    },
  },
  {
    id: 'sk-agents',
    name: 'AGENTS.md: правила проекта',
    skill: {
      format: 'agents',
      name: 'Правила проекта',
      description: 'Постоянные договорённости для ИИ-агента, работающего в этом репозитории',
      whenToUse: '',
      steps: 'Перед правкой прочитай связанный код и тесты\nСначала напиши падающий тест, затем исправление\nПосле правки запусти проверки проекта',
      rules: 'Не добавляй зависимости без согласования\nКоммит и push — только по прямой просьбе\nОтвечай кратко и по делу',
      output: 'Отчёт: что изменено, как проверено, что не сделано.',
      examples: [],
    },
  },
];

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
  {
    id: 'struct',
    name: 'Структурный промпт',
    body: 'Роль: {{роль}}\nЗадача: {{задача}}\nКонтекст: {{контекст}}\nОграничения: {{ограничения}}\nФормат ответа: {{формат}}\nЕсли данных не хватает — сначала задай уточняющие вопросы.',
    defaults: { роль: 'опытный преподаватель информатики', задача: '', контекст: '', ограничения: 'не выдумывай факты, указывай неуверенность', формат: 'нумерованный список, не больше 10 пунктов' },
  },
  {
    id: 'improve',
    name: 'Улучшить промпт',
    body: 'Ты редактор промптов. Улучши промпт ниже: уточни цель, добавь недостающий контекст, ограничения и формат ответа. Верни улучшенный промпт и коротко — что изменил и почему.\nПромпт:\n{{промпт}}',
    defaults: { промпт: '' },
  },
  {
    id: 'fewshot',
    name: 'Классификация по примерам',
    body: 'Отнеси текст к одной из категорий: {{категории}}. Ответь только названием категории.\n\nПримеры:\n{{примеры}}\n\nТекст:\n{{текст}}',
    defaults: { категории: 'вопрос, жалоба, благодарность', примеры: 'Где мой заказ? → вопрос\nСпасибо за помощь! → благодарность', текст: '' },
  },
  ...BUILTIN_SKILLS.map((s): LlmTpl => ({ id: s.id, name: s.name, body: renderSkill(s.skill, 'RU'), defaults: {}, kind: 'skill', skill: s.skill })),
];
