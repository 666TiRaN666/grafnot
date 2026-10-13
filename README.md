# Grafnot — заметки, задачи и карта знаний

Веб-приложение: связный блокнот для учёбы.
React 19 + TypeScript (strict) + Vite + Tiptap + d3-force. Данные — только `localStorage`, офлайн-first, бэкенда нет.

## Запуск и проверки

```sh
npm install
npm run dev        # разработка
npm run build      # tsc + сборка в dist/
npm test           # unit-тесты (vitest)
npm run check:weight  # отчёт веса JS-бандла + предохранитель от baseline (лимитов нет)
npm run preview    # раздача собранного (для ручной проверки и e2e)
npm run e2e        # 164 e2e-проверки (Playwright, нужен preview :5199)
npm run check:i18n  # missing/parity/dead-гейт i18n-ключей (RU/EN/KZ)
npm run check:i18n:selftest  # мутационный самотест гейта (6 фикстур)
```

E2E: 81 сценарная проверка на Playwright поверх `vite preview` (`e2e/check6.cjs`)
(пустой старт, редактор, задачи, неделя, связи, вычисления, карта, переименование, панели, промпты, корзина/undo, мобильная навигация, тосты, профили,
блокировки битого стора, ErrorBoundary, честные статусы сохранения, две вкладки, восстановление реестра, адопция legacy).

Пользовательский путь и гипотезы опыта собраны в [Journey Map Grafnot](JourneyMap.md).

## Возможности

- **Тетради** — список всех заметок (сортировка по изменению, поиск, лимит 5/10/25/50, «показать ещё», клавиатура), пустое состояние с кнопкой создания.
- **Главная** — Tiptap-редактор (B/I/H/списки, undo/redo), глобальный поиск по Ctrl+K, задачи заметки со счётчиком, живые вычисления с переменными (`a*10`, защита от циклов), явный диалог связей «A ↔ B», похожие, корзина, экспорт в `.md`, заготовки, привязанные промпты.
- **Задачи** — экран-Список: вертикальный композер (`N`, чипы срока), группы по срокам + Выполненные, строка с чекбоксом/чипами/`⋯`, панель задачи, удаление сразу + Undo; создание из текста заметки с привязкой `noteId` и чипом «из: …».
- **Календарь** — вид «Неделя» (сетка Пн–Вс + Входящие, навигация, сегодня), попап добавления у ячейки, чипы с отдельным чекбоксом, drag задач по дням с Undo, mobile-полоса дней + повестка.
- **Карта знаний** — несколько именованных графов + обзор; SVG-граф: force-directed layout, drag узлов (хит-зона r=24), пан, зум к курсору, клик → превью; сироты и битые в разрезе графа; Pro-замок до 20 заметок.
- **Промпт-помощник** — статический словарь тегов (v1.0.0-sample, 57 тегов, версия и дата в UI), image-промпты сохраняются как редактируемые шаблоны, заполненные шаблоны можно привязать к заметкам, синтаксис под модель, клавиатурная навигация, варнинг рискованных тегов, свёрнутые миниатюры шаблонов (поиск, чипы, лимит), Ctrl+K находит сохранённые промпты.
- **Шелл** — модалка настроек (тема, язык, лимит списков; открывает и аватар; оттуда же смена профиля), шторка «Ещё» в мобильном таббаре (Карта, Промпты), справка по хоткеям («?» у поиска), тосты с ручным закрытием, честный статус сохранения в шапке («Сохранено локально · время» / «Сохраняется…» / «⚠ НЕ сохранено» + постоянный баннер с экспортом из памяти и повтором), баннер конфликта вкладок (принять чужую / перезаписать моей / скачать мою), блокирующий экран битого стора (raw-экспорт, резервная копия, пустой старт только по подтверждению).
- Сворачиваемые сайдбар-рейл и правая панель (персист), `Alt+0` — сбросить панели, `Ctrl+Alt+N` — новая заметка. Светлая/тёмная темы, RU/EN/KZ, мобильный таббар.

## Модель данных (`src/store.ts`)

```ts
Note  { id, title, content (Tiptap JSON), text, linkedIds: string[], calcs, updated }
Graph { id, title, noteIds: string[] }   // заметка может быть в 0..N графах
TaskItem { id, text, desc?, done, due?: ISO, noteId? }
PromptSave { id, kind: 'image'|'llm', title, model?, tokens?, templateId?, params?, noteId?, created }
Store { notes, tasks, trash, trashTasks, graphs, prompts, customTpls, activeId }  // + schemaVersion 5 при записи
```

Архитектурные решения (не менять молча):

1. **Связи — только по id, не по заголовкам.** Переименование O(1), висяков по построению нет: удаление заметки вычищает её id из чужих `linkedIds`. Заголовки уникальны (автосуффикс) — нужно поиску и диалогам.
2. **Нет поля «тетрадь».** Единственный источник принадлежности — `graph.noteIds`; «Без графа» вычисляется. Новые заметки стартуют без графа и назначаются через модалку состава.
3. **Миграции — чистая функция `migrate()` + `schemaVersion`.** Старые title-ссылки резолвятся в id за один проход, недостающие цели считаются и показываются тостом. Тесты: `src/store.test.ts`.
4. **Физика графа изолирована в `src/graphLayout.ts`** (единственное место, знающее про d3-force): ручные тики без таймера → детерминированность для e2e. Тесты: `src/graphLayout.test.ts`.
5. **Промпты живут в общем сторе**, а не в отдельном хранилище. Привязка односторонняя (`promptSave.noteId`), обратная сторона — вычисляемый фильтр. Словарь тегов — честно помеченный статический семпл (`promptData.ts`: версия, дата, источник), живого обновления нет по дизайну. Порог риска — именованная константа, синтаксис моделей — чисто презентационный `renderPrompt` (`promptUtils.ts` + тесты).
6. **Вес:** отчёт и предохранитель +50% от baseline, лимитов нет (`npm run check:weight`, baseline — `docs/weight-baseline.json`). Рост веса виден в отчёте.

## Профили (изоляция данных и настроек)

- **Реестр** — `grafnot-profiles-v1`: список профилей (`id`, имя, `created`) + `activeId` последнего активного.
- **Ключи профиля:** стор — `grafnot-store-<id>`; префы — `grafnot-theme|lang|side|right|hint-first:<id>`, `grafnot-list-limits:<id>`, `grafnot-tpl-limit:<id>`. Голые ключи — только legacy-путь до миграции.
- **Вход:** один профиль — автовход; несколько — экран `ProfilePicker` (вход, создание пустого, переименование, удаление через arm-confirm). Смена — кнопкой в настройках; дерево перемонтируется (`key={profileId}`), сессия (поиск, модалки, активный промпт) сбрасывается.
- **Миграция legacy:** первый запуск без реестра переносит `grafnot-store-v2` и голые префы в профиль «Основной» только после проверенной записи (read-back равен записанному); при нехватке места — блокирующий экран (скачать legacy / повторить / начать с пустого), реестр не создаётся, legacy цел, фантомных профилей нет. Нечитаемый legacy — блокировка до явного выбора; уцелевший остаток позже импортируется из пикера как отдельный профиль (тоже с проверкой записи).
- **Битый реестр** новым не затирается: бэкап `grafnot-profiles-v1:corrupt-<ts>`, восстановление из ключей `grafnot-store-*` (имена «Профиль N», тост), пустых default поверх данных нет.
- **Удаление профиля:** сначала реестр, потом данные (префы → стор последним); сбой удаления данных оставляет восстанавливаемую сироту (тост), а не призрачную запись.
- **Квота:** `saveStore` возвращает `false` — шапка показывает «⚠ НЕ сохранено», постоянный баннер (экспорт из памяти, повтор); смена/создание профиля блокируется до успеха или явного «Всё равно перейти».
- **Резервные копии и ручное восстановление:** нечитаемый стор копируется в `<ключ>:corrupt-<ts>` (не более 2 на ключ, дедуп по содержимому; если не влезла — отдельный тост + экспорт из памяти). Вручную: DevTools → Application → Local Storage → скопировать значение нужного ключа (`grafnot-store-<id>` или `:corrupt-*`) в файл; чтобы подсунуть его приложению — положить текст как значение ключа `grafnot-store-<id>` существующего/нового профиля и перезагрузить.

## Структура

```
src/
  App.tsx         — стор, действия, каркас (rail/tabbar/шапка), палитра (Ctrl+K), роутер хешей, хоткеи
  Palette.tsx     — Quick Add / палитра (группы по 3–4, Enter/Esc)
  paletteModel.ts — filterPalette (чистая) + тесты
  SettingsPage.tsx — настройки страницей #/settings/<section> (профили, вид, корзина, клавиши, данные)
   settingsNav.ts  — секции настроек (тип, список, заголовки; чистое)
   shortcuts.ts    — единый реестр шорткатов S12 (15 записей; из него Клавиши + G28-матрица)
  store.ts        — типы, migrate() до v5, localStorage, хелперы (сироты, битые, вставка, filterTasks)
  useListNav.ts   — общая клавиатурная навигация списков (стрелки + Enter)
  useListState.ts — общее состояние списков (запрос, лимит, показ, навигация)
  useArmConfirm.ts — общий arm-confirm необратимых удалений
   listPrefs.ts    — лимиты списков (один JSON-map + legacy-миграция; ключи per-profile)
   profiles.ts     — реестр профилей (CRUD, activeId, состав ключей, очистка данных)
   prefs.ts        — шелл-префы per-profile (prefKeyFor, migrateLegacyPrefs)
   ProfilePicker.tsx — экран выбора/создания/переименования/удаления профилей
  NotesView.tsx   — заметки master-detail (список 300px + редактор + [[ / sel-меню + контекстные вкладки)
  PlanList.tsx    — планировщик-список (композер, группы, строки, панель) + общая TaskPanel
  PlanWeek.tsx    — планировщик-неделя (сетка 7, попап, чипы, drag, Входящие, mobile)
  MapView.tsx     — карта: холст на всю область, тулбар, поиск узлов, peek-панель, протягивание связей, состав, сироты + mapCamera.ts (чистые) + тесты
  graphLayout.ts  — force-layout на d3-force (чистая функция)
  PromptBuilder.tsx — конструктор шаблонов (тело, таблица полей, ошибки, тип) + builderModel.ts (чистые) + тесты
  PromptLib.tsx   — библиотека (поиск, сегменты, строки 56px, бейджи, плотность) + promptLibrary.ts (чистые) + тесты
  PromptWorkbench.tsx — рабочая область текстового шаблона + панель результата + workbenchModel.ts (чистые) + тесты
  PromptImageWb.tsx — конструктор image-промпта (теги, чипы, вес, drag, модели) + imageTags.ts (чистые) + тесты; NoteAttach.tsx — общая «В заметку ▾» обеих областей
  promptData.ts   — статический словарь тегов v1.0.0-sample (57 тегов)
  promptUtils.ts  — риск, синтаксис, слоты, превью сейвов, сниппеты/подсветка (чистые)
  linkSuggest.ts  — matchLinkCandidate (title+text) + parseBracketQuery + rankLinkSuggest (recent-first; чистые) + тесты
  widgets.tsx     — тосты (×, dismissToast), модалка, иконки, Hi, fmtDue, copyText
  i18n.ts         — словарь RU/EN/KZ
  data.ts         — шаблоны {name, body, defaults} + 4 встроенных; SearchItem (+kind=prompt)
   index.css       — обе темы, rail-режимы, адаптив, подсветка совпадений, coarse-цели 44px (S11)
   JourneyMap.md — персона, эмоциональная кривая, этапы и точки роста
   promptUtils.test.ts, tplFilter.test.ts, store.test.ts, graphLayout.test.ts, promptData.test.ts, placement/router/useUndo.test.ts, weight-guard.test.js, paletteModel.test.ts, linkSuggest.test.ts, taskGroups.test.ts, weekCal.test.ts, promptLibrary.test.ts, workbenchModel.test.ts, imageTags.test.ts, builderModel.test.ts, mapCamera.test.ts — 131 тест ядра
   syncWording/settings/snippetTerms/promptSearch/listPrefs/mobileNav/shortcuts/toast/useListState/useArmConfirm/profiles/prefs/activeId/clipboard/newId/profileBoot.test.ts — 129 тестов UX-проходов и профилей
scripts/check-weight.js (+ weight-guard.js) — отчёт веса бандла + предохранитель
scripts/check-i18n.js — missing/parity/dead-гейт i18n-ключей (+ scripts/check-i18n.selftest.js — мутационный самотест гейта)
scripts/audit-targets.cjs — аудит целей N1 (report/enforce, desktop+mobile)
scripts/check-css-unused.cjs — поиск мёртвых .g-классов
e2e/check6.cjs — 94 e2e-проверки (npm run e2e: P5–P28 база, P29 блокировки стора, P30 ErrorBoundary, P31 сохранения, P32 две вкладки, P33 реестр, P34–P36 адопция legacy, S2 каркас/палитра/настройки, S3 заметки master-detail/[[ /меню/Undo)
docs/ux-baseline.md + docs/ux-audit-raw.json — база S0 «до» (аудит 375 элементов, 5 сценариев)
docs/fitts-report.md — S13 «до/после» по 5 сценариям (D, W, ID) + бюджеты G29
start.bat         — быстрый запуск dev-сервера на Windows
```

## UI — testid-контракт (S0 заморожен; изменение S2 записано здесь)

| testid | Назначение | Статус S2 |
|---|---|---|
| nav-notes, nav-plan, nav-map, nav-prompt, nav-settings | Навигация rail (ровно 4 раздела + настройки) | Есть (S2: nav-home/tasks/cal/trash заменены) |
| tabbar, tab-notes, tab-plan, tab-add, tab-map, tab-prompts | Мобильный таббар (5 кнопок) | Есть (S2, заменяет bottombar+«Ещё») |
| quickadd, palette-open, palette, palette-input, palette-item-N | Quick Add / палитра Ctrl+K | Есть (S2) |
| page-header, save-state | Шапка страницы + статус сохранения | Есть (S2, topbar удалён) |
| plan-view-list, plan-view-week | Переключатель Планировщика | Есть (S2) |
| notes-back | Назад из редактора к списку | Есть (S2) |
| settings-page, settings-nav-profiles/appearance/trash/keys/data | Настройки страницей (модалки удалены) | Есть (S2) |
| note-list, note-item | Список/строка заметок (вся строка цель, N9 порции по 50) | Есть (S3; notedel удалён — удаление через ⋯+Undo) |
| editor, title-in | Редактор + крупный inline-заголовок (Enter в текст) | Есть (S3) |
| sel-menu, sel-bold/italic/h/link/task | Меню выделения | Есть (S3; однобуквенный тулбар удалён) |
| link-suggest, link-suggest-item-N, link-suggest-create | [[-подсказка (недавние сверху + создать) | Есть (S3; LinkDialog удалён) |
| slash-menu, slash-item-N | /-меню блоков | Есть (S3) |
| notes-more, notes-menu(-export/duplicate/trash) | ⋯ заголовка (Экспорт/Дублировать/В корзину+Undo) | Есть (S3) |
| ctx-tabs, ctx-tab-links/similar/tasks/prompts/snip, notes-search | Контекстная панель (одна вкладка) + поиск списка (/) | Есть (S3) |
| task-composer, task-composer-title, task-row | Композер/поле/строка Планировщика | Есть (S4; фильтр active/done/all и лимит-сег удалены) |
| task-due-today/tomorrow/week/none, task-add, task-search | Чипы срока/Добавить/поиск (`/`) | Есть (S4) |
| task-row-menu, task-menu-del, task-panel, task-panel-title/desc/due-*, task-panel-delete | ⋯ строки, панель задачи (название/описание/срок/источник/Удалить+Undo) | Есть (S4; TaskDialog удалён) |
| task-group-overdue/today/tomorrow/week/later/undated/done | Группы по срокам со счётчиками | Есть (S4) |
| plan-week, day-cell-<iso>, day-add-<iso>, day-popup, day-popup-title, day-popup-add | Неделя/ячейка/полоса +/попап (название/Добавить) | Есть (S5; undated-секция удалена) |
| week-inbox | Входящие (задачи без срока; принимают drop) | Есть (S5) |
| task-panel-close | Закрытие панели | Есть (S5) |
| map-view, map-search, map-tools, map-graphs(-pop), map-menu, map-link, map-orphans, map-peek, map-members, map-broken | Карта: холст/поиск/тулбар/переключатель/меню/связь/сироты/пик/состав/битые | Есть (S10; табы/карточки/модалки/замок удалены) |
| prompt-library, prompt-search, prompt-item | Библиотека/поиск/строка (бейджи типа/происхождения) | Есть (S6; legacy-дубли удалены в S9) |
| prompt-builder, builder-name/body/insert, builder-field-<name>, builder-errors | Конструктор шаблонов | Есть (S9; TplEditor-модалка удалена) |
| prompt-workbench, prompt-result, copy-prompt | Рабочая область текстового шаблона/превью/копировать | Есть (S7; image-конструктор — S8) |
| prompt-wb-more, prompt-rename | ⋯ области, переименование сейва в строке | Есть (S7) |
| tag-input, tag-suggest-item-N, tag-chip, tag-recent | Поле/подсказки/чипы/недавние image-конструктора | Есть (S8) |
| adoption-blocked, profile-picker, profile-row-*, profile-name-in | Профили/адопция | Есть |
| keys-row | Строка Клавишей (строится из реестра shortcuts.ts) | Есть (S12; контракт дополнен здесь) |

Правило: тесты используют testid и role, а не тексты и классы.

## Долги (осознанно не сделано)

- Корзина без 30-дневной очистки (политика заявлена, enforcement нет).
- Нет истории версий заметок.
- Нет экспорта/импорта всей рабочей области одним файлом (только per-store raw и `.md`-экспорт заметок).
- Конфликт вкладок не мержится: три явных выбора (принять чужую / перезаписать моей / скачать мою), слияния нет.
- S13: сьютовые флаки полного прогона (перекрытие Undo-тостов по TTL в P12, доставка клавиш в редактор в G19 — группы зелёные изолированно, финал 164/164); в CI не заведены `check:contrast` и audit enforce; остатков старого UI нет.
