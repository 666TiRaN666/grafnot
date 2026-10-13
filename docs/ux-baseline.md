# UX baseline S0 — до редизайна

Дата: 2026-10-08. Preview :5199, seed 20 заметок (карта разблокирована), viewports desktop 1440x900 + mobile 390x844.

## S0.1 команды

- `npm test` — vitest run
- `npm run build` — `tsc -b && vite build`
- `npm run check:weight` — `node scripts/check-weight.js`
- `npm run check:i18n` — `node scripts/check-i18n.js`
- `npm run check:i18n:selftest` — `node scripts/check-i18n.selftest.js`
- `npm run e2e` — `node e2e/check6.cjs` (нужен `node node_modules/vite/bin/vite.js preview --port 5199`)
- `node scripts/sync-readme.js --check` — сверка чисел README (npm-скрипта нет, вызов напрямую)
- `node scripts/audit-targets.cjs report` — новый аудит целей S0
- `node scripts/check-css-unused.cjs report` — новый поиск мёртвого CSS S0

## S0.2 базовая линия

- unit: 205/22 файлов (`npm test` 2026-10-08)
- e2e: EXPECTED_CHECKS=81 (`e2e/check6.cjs:9`)
- вес: total 234.4 КБ, initial 82.9 КБ (`npm run check:weight`; лимиты 240/200 отменены в W1)
- oxlint: 0 errors, 8 warnings
- i18n: 243 keys, 239 referenced, OK; selftest 6/6
- tsc -b: OK; sync-readme --check: OK (unit 205/22, e2e 81)

## S0.3 инвентаризация

- Страницы: home (HomePage), notes (NotesPage), tasks (TasksPage), cal (CalendarPage), map (MapPage), prompt (PromptPage), профили (ProfilePicker)
- Компоненты: App (шелл), HomePage, NotesPage, TasksPage, TaskDialog, CalendarPage, MapPage, PromptPage, LinkDialog, ProfilePicker, widgets (Modal, ToastStack, StatusBanner, Icon, Hi), graphLayout, store, profiles, storage/profileBoot, prefs, listPrefs, useListState, useListNav, useArmConfirm, promptUtils, promptData, data, exportRaw
- Модалки: trash, settings, shortcuts, moreNav (Ещё), adoption-blocked, LinkDialog, TaskDialog, graphMembers, tpl edit/new, pickNote, profile delete (arm-confirm)
- testid литералы: adoption-blocked, profile-name-in, profile-picker
- testid динамики: "tpl-card-" + t.id, "tpl-mini-" + t.id, `profile-row-${p.id, testid
- .g-классы: defined 191, used-defined 172, unused 19
- топ использований: g-btn=85, g-linkbtn=34, g-card-t=17, g-sugg=16, g-card=13, g-in=13, g-danger-arm=11, g-tpl-more=9
- UNUSED19: g-banner-ok, g-calc, g-calc-in, g-chiprow, g-dot, g-maphead, g-node, g-onboard, g-onboard-b, g-onboard-t, g-pop, g-pop-b, g-pop-t, g-promptline, g-rename-list, g-tabs, g-tasks, g-thead, g-trow

## S0.4 аудит целей (report)

Всего элементов: 375, нарушений N1: 244. Сырые данные: `docs/ux-audit-raw.json`.

| viewport | page | всего | нарушений |
|---|---|---|---|
| desktop 1440x900 | cal | 38 | 16 |
| desktop 1440x900 | home | 45 | 32 |
| desktop 1440x900 | map | 36 | 25 |
| desktop 1440x900 | notes | 37 | 25 |
| desktop 1440x900 | prompt | 40 | 19 |
| desktop 1440x900 | tasks | 29 | 13 |
| mobile 390x844 | cal | 25 | 19 |
| mobile 390x844 | home | 25 | 19 |
| mobile 390x844 | map | 25 | 19 |
| mobile 390x844 | notes | 25 | 19 |
| mobile 390x844 | prompt | 25 | 19 |
| mobile 390x844 | tasks | 25 | 19 |

Топ-40 нарушений (самые мелкие цели):

| viewport | page | tag | текст/testid | WxH | N1 |
|---|---|---|---|---|---|
| desktop 1440x900 | prompt | input | on | 13x13 | FAIL h<32 (13x13) |
| desktop 1440x900 | prompt | input | on | 13x13 | FAIL h<32 (13x13) |
| desktop 1440x900 | prompt | input | on | 13x13 | FAIL h<32 (13x13) |
| desktop 1440x900 | home | button | × | 23x18 | FAIL h<32 (23x18) |
| mobile 390x844 | home | button | × | 23x18 | FAIL touch<44 (23x18) |
| mobile 390x844 | notes | button | × | 23x18 | FAIL touch<44 (23x18) |
| mobile 390x844 | tasks | button | × | 23x18 | FAIL touch<44 (23x18) |
| mobile 390x844 | cal | button | × | 23x18 | FAIL touch<44 (23x18) |
| mobile 390x844 | map | button | × | 23x18 | FAIL touch<44 (23x18) |
| mobile 390x844 | prompt | button | × | 23x18 | FAIL touch<44 (23x18) |
| desktop 1440x900 | notes | button | Note 20 | 54x20 | FAIL h<32 (54x20) |
| desktop 1440x900 | notes | button | Note 19 | 54x20 | FAIL h<32 (54x20) |
| desktop 1440x900 | notes | button | Note 18 | 54x20 | FAIL h<32 (54x20) |
| desktop 1440x900 | notes | button | Note 17 | 54x20 | FAIL h<32 (54x20) |
| desktop 1440x900 | notes | button | Note 16 | 54x20 | FAIL h<32 (54x20) |
| desktop 1440x900 | notes | button | Note 15 | 54x20 | FAIL h<32 (54x20) |
| desktop 1440x900 | notes | button | Note 14 | 54x20 | FAIL h<32 (54x20) |
| desktop 1440x900 | notes | button | × | 19x21 | FAIL h<32 (19x21) |
| desktop 1440x900 | notes | button | × | 19x21 | FAIL h<32 (19x21) |
| desktop 1440x900 | notes | button | × | 19x21 | FAIL h<32 (19x21) |
| desktop 1440x900 | notes | button | × | 19x21 | FAIL h<32 (19x21) |
| desktop 1440x900 | notes | button | × | 19x21 | FAIL h<32 (19x21) |
| desktop 1440x900 | notes | button | × | 19x21 | FAIL h<32 (19x21) |
| desktop 1440x900 | notes | button | × | 19x21 | FAIL h<32 (19x21) |
| desktop 1440x900 | home | button | • Note 2 | 56x21 | FAIL h<32 (56x21) |
| desktop 1440x900 | home | button | • Note 3 | 56x21 | FAIL h<32 (56x21) |
| desktop 1440x900 | home | button | • Note 4 | 56x21 | FAIL h<32 (56x21) |
| desktop 1440x900 | home | button | • Note 1 | 56x21 | FAIL h<32 (56x21) |
| desktop 1440x900 | home | button | • Note 2 | 56x21 | FAIL h<32 (56x21) |
| desktop 1440x900 | home | button | • Note 3 | 56x21 | FAIL h<32 (56x21) |
| desktop 1440x900 | home | button | • Note 4 | 56x21 | FAIL h<32 (56x21) |
| desktop 1440x900 | map | button | [Открыть] | 66x21 | FAIL h<32 (66x21) |
| desktop 1440x900 | map | button | [Открыть] | 66x21 | FAIL h<32 (66x21) |
| desktop 1440x900 | map | button | [Открыть] | 66x21 | FAIL h<32 (66x21) |
| desktop 1440x900 | map | button | [Открыть] | 66x21 | FAIL h<32 (66x21) |
| desktop 1440x900 | map | button | [Открыть] | 66x21 | FAIL h<32 (66x21) |
| desktop 1440x900 | map | button | [Открыть] | 66x21 | FAIL h<32 (66x21) |
| desktop 1440x900 | map | button | [Открыть] | 66x21 | FAIL h<32 (66x21) |
| desktop 1440x900 | map | button | [Открыть] | 66x21 | FAIL h<32 (66x21) |
| desktop 1440x900 | map | button | [Открыть] | 66x21 | FAIL h<32 (66x21) |

Полная таблица — в `docs/ux-audit-raw.json` (375 строк, поля viewport/page/tag/text/testid/w/h/n1).

## S0.5 пять сценариев «до» (действия + D/W)

Метод: шаги по текущему UI, W из DOM-замеров выше, D — евклидово расстояние между центрами последовательных целей на desktop 1440x900 (оценка по раскладке, точность ±80px). ID для S13: log2(D/W+1).

### 1. Добавить задачу (Tasks)
- Шаг1: rail nav-tasks (W~64) -> поле Новая задача (W~420): D~420, действий 1 клик
- Шаг2: ввод текста (0 кликов, клавиатура)
- Шаг3: поле -> кнопка Добавить (W~90): D~180, 1 клик
- Итого: 3 фокуса/клика + текст. Узкое место: кнопка 90px далеко от поля на узких экранах.

### 2. Добавить задачу в день (Calendar)
- Шаг1: nav-cal -> ячейка дня g-day (W~140): D~500, 1 клик (выбор даты)
- Шаг2: ячейка -> поле g-addtask input (W~220): D~160, 1 клик
- Шаг3: поле -> Добавить g-btn sm (W~80): D~140, 1 клик + Enter
- Итого: 3 клика + текст. Узкое место: два прыжка поле->кнопка, кнопка sm h~28 (<32).

### 3. Скопировать промпт из шаблона (Prompt)
- Шаг1: nav-prompt -> миниатюра tpl-mini (W~200): D~480, 1 клик
- Шаг2: миниатюра -> поле слота input (W~300): D~380, 1 клик
- Шаг3: поле -> Копировать (W~140): D~420, 1 клик (или Ctrl+Enter)
- Итого мышью: 3 клика + заполнение; клавиатурой: / + Enter + Ctrl+Enter. Узкое место: результат справа в 360px колонке, D большой.

### 4. Сменить заметку (Notes/Home)
- Шаг1: список NotesPage строка g-linkbtn Note (W~54 h~20 — нарушение N1): D~300 от редактора, 1 клик
- Итого: 1 клик. Узкое место: цель 54x20 вместо строки >=40px высотой, промахи по Фиттсу.

### 5. Создать связь (Home -> LinkDialog)
- Шаг1: редактор -> кнопка Связать g-btn sm (W~90): D~350, 1 клик
- Шаг2: диалог input поиск (W~320): D~260 (прыжок в центр модалки), 1 клик + запрос
- Шаг3: строка кандидата -> Связать (W~90): D~180, 1 клик + Enter
- Итого: 3 клика + запрос. Узкое место: центрированная модалка вместо попапа у объекта (нарушение N2), D суммарно ~790px.

## S0.6 бюджет (факт)

- Старт S0: total 234.4 КБ, initial 82.9 КБ (лимиты 240/200 отменены в W1).
- Удалено: 19 мёртвых .g-классов (`node scripts/check-css-unused.cjs report` теперь 0), CSS gzip 6.28→5.94 КБ.
- JS-вес не сдвинулся: total 234.4, initial 82.9 (CSS вне JS-отчёта). Неиспользуемых экспортов для веса нет (`DATASET_SOURCE` — строка документации, оставлена).
- Отметка 12 КБ мёртвым CSS/экспортами недостижима без урезания фич — остановлено по правилу S0.6, сообщается в отчёте этапа.
