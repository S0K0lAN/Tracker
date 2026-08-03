# Acceptance-матрица расширенной функциональности

## Назначение

Матрица переводит расширенные продуктовые запросы в наблюдаемые критерии
приёмки. Актуальный срез повторно проверен 31 июля 2026 года после интеграции
новых страниц, task lifecycle, раскладок входящих, Pomodoro, голосового
разбора, вложений и фонов.

Статусы:

- **Готово** — явный пользовательский scope браузерного MVP реализован и
  подтверждён релевантным автоматическим тестом либо независимой визуальной
  проверкой, если критерий по природе визуальный.
- **Частично** — основной happy path существует, но отсутствует обязательный
  исход, error/edge case или независимое тестовое доказательство.
- **Не реализовано** — пользовательский сценарий отсутствует.

Статус оценивается по наблюдаемому DOM, URL или сохранённым данным. Само
наличие элемента с `onClick` доказательством не считается.

## Общие gates

Для статуса «Готово» также обязательны:

1. локальное действие и результат сохраняются после reload;
2. прямой URL, навигация и browser history работают;
3. интерактивные элементы имеют доступные имена и keyboard/focus UX;
4. desktop 1440×900 и mobile 390×844 не имеют horizontal overflow;
5. светлая и тёмная темы проходят WCAG AA color-contrast;
6. нет `pageerror` и необработанных `console.error`;
7. проходят `npm test`, `npm run build` и `npm run test:e2e`.

Будущие platform/next-stage функции не расширяют задним числом Definition of
Done браузерного MVP. Они честно вынесены в отдельный раздел ограничений.

## Матрица

| ID | Требование | Статус | Evidence текущего scope |
|---|---|---|---|
| UX-01 | Выровнять положения всех иконок | **Готово** | Единые размеры Lucide и control CSS, исправленный mobile containing block; независимый visual QA desktop/mobile и pointer E2E task-actions подтверждают отсутствие смещения, clipping и interception. |
| UX-02 | Единые dropdown в редакторе задачи | **Готово** | `SelectMenu` используется для проекта, важности, порога и override; поддерживает поиск, стрелки, `Home/End`, `Enter/Space`, `Escape` и возврат focus. Регрессия доказывает, что `Escape` закрывает только dropdown и сохраняет draft. |
| UX-03 | Понятное отображение важности | **Готово** | `TaskCard` показывает текст «Обычно/Важно» и контурный/заполненный флаг, поэтому значение не зависит только от цвета и одинаково читается в task layouts. |
| UX-04 | Улучшенный выбор проекта | **Готово** | Searchable `SelectMenu` показывает цвет и описание; E2E доказывает create project → select in task → reload → project detail. |
| NAV-01 | Отдельная страница «Сегодня» | **Готово** | `/today` есть в desktop/mobile navigation; component-тест проверяет секции и отсутствие дубля scheduled deadline, E2E — direct URL, Back/Forward и heading. |
| PRJ-01 | Страница и создание проектов | **Готово** | `/projects`, форма с названием/цветом/описанием, detail и задача проекта работают и переживают reload; пустое имя блокируется. |
| ATT-01 | Просмотр фото и файлов | **Готово** | Viewer открывает image/PDF/text, поддерживает zoom, download, `Escape` и возврат focus; E2E загружает text attachment и повторно открывает после reload в пределах лимита браузерного MVP. |
| FLT-01 | Составной и сохраняемый фильтр | **Готово** | Есть status/project/importance/urgency/tags ANY/ALL; UI показывает активные условия, сброс; E2E сохраняет и применяет named filter после reload. |
| SEARCH-01 | Поиск задач, проектов, тегов и фильтров | **Готово** | `/search` регистронезависимо группирует четыре типа результатов; component/E2E подтверждают кириллический поиск, empty state, сохранение и повторное применение фильтра. |
| TRASH-01 | Корзина удалённых задач | **Готово** | Soft delete → `/trash` → reload → restore → Inbox проходит E2E; permanent delete требует и component-тестом проверяет явное второе подтверждение. |
| POM-01 | Таймер фокуса для задачи | **Готово** | Действие явно подписано «Таймер фокуса · 25 минут»; desktop/mobile E2E проверяют task binding, pause и timestamp persistence после reload. |
| CAL-01 | Дедлайны и навигация календаря | **Готово** | Deadline-only task отображается marker в week/month; отдельный deadlines mode сохранён, а E2E проверяет смену периода горизонтальным drag. |
| INB-01 | Сортировка входящих | **Готово** | Доступны created desc, nearest deadline, importance и title; component проверяет порядок, E2E — сохранение выбора после reload. |
| ARC-01 | Архив выполненных задач | **Готово** | Individual/bulk archive, отдельный Archive tab, restore и reload реализованы; component/E2E проверяют полный цикл возврата в completed Inbox. |
| HAB-01 | Правильный «Ваш ритм» и серии | **Готово** | Pure test с фиксированным временем проверяет independent schedule/progress/streak, UI считает только плановые прошедшие дни привычки. |
| HAB-02 | Независимое выполнение привычек | **Готово** | Component/E2E отмечают одну привычку, доказывают неизменность другой и persistence после reload. |
| HAB-03 | 10 векторных иконок привычки | **Готово** | Component проверяет все 10 Lucide radio-options и выбранную «Книгу»; E2E подтверждает иконку после reload. |
| HAB-04 | Описание и редактирование привычки | **Готово** | Создание, редактирование и reload имени, optional description, иконки и истории покрыты component/E2E. |
| INB-02 | List/board и отдельный календарь | **Готово** | Component переключает список/доску и проверяет явный переход в `/calendar`; E2E проверяет общий sort и persistence вида. |
| BG-01 | Встроенные фоны | **Готово** | Presets, «без фона», dim и global application реализованы; E2E проверяет preset/reload, все страницы — light/dark desktop/mobile contrast и overflow. |
| BG-02 | Собственный фон | **Готово** | MIME/size validation, upload, global application и reload покрыты E2E в честно документированных browser/localStorage лимитах. |
| VOICE-01 | Надиктовывание задачи | **Готово** | Web Speech ru-RU и ручной fallback интегрированы; fallback остаётся рабочим при отсутствии API и проверен E2E. |
| VOICE-02 | Разбор надиктованной задачи | **Готово** | Unit с фиксированным `now` проверяет title, relative/weekday deadline, time, importance, unique tags и project; E2E — preview → apply → saved task. |
| DES-01 | Лаконичный дизайн Todoist/Singularity | **Готово** | Новые страницы используют общие tokens и progressive disclosure; пройдены independent visual QA, automated contrast/overflow, mobile action и menu clipping regressions. |
| QA-01 | Независимое покрытие новых функций | **Готово** | Test-only агент добавил unit/component/E2E с наблюдаемыми эффектами, browser-error collection и theme/mobile loops; полный gate зелёный. |
| DOC-01 | Синхронизировать документацию | **Готово** | `README.md`, `AGENTS.md`, `docs/business-requirements.md`, `docs/extended-features.md` и эта матрица согласованы по девяти маршрутам, schema v2, ограничениям и тестам. |

Итого по явному scope браузерного MVP: **26 готовых**, **0 частично
готовых**, **0 отсутствующих** критериев.

## Тестовая трассировка

### Unit и component

- `src/domain/voiceParser.test.ts` — 5 сценариев русского парсинга с
  фиксированным `now`, включая Unicode-safe границы кириллических токенов.
- `src/NewFeatures.test.tsx` — Today, Projects, Search, soft delete/restore,
  permanent delete confirmation, archive/restore, сортировка, три Inbox
  layout, Pomodoro, deadline-only week/month, `Escape` внутри `SelectMenu` и
  keyboard navigation task action-menu, 42-cell calendar и focus trap/restore
  TaskEditor, AttachmentViewer и mobile Sidebar.
- `src/pages/HabitsPage.test.tsx` — rhythm/streak, независимый toggle,
  10 иконок и optional description.
- `src/domain/models.test.ts` — urgency/overdue.
- `src/core/sync/GoogleDriveAdapter.test.ts` — контрактные сценарии Drive.

### Browser E2E

`e2e/new-features.spec.ts` покрывает:

1. direct URL и Back/Forward новых страниц;
2. mobile task action → Pomodoro без clipping/interception;
3. 42-cell mobile calendar, видимый deadline marker и 44 px compact targets;
4. exact focus restore для Editor, Viewer и mobile drawer;
5. project → task → reload;
6. soft delete → reload → restore → complete → archive → reload → restore;
7. inbox sort/layout persistence и работающий Pomodoro после reload;
8. search → named filter → reload → apply;
9. voice fallback → parsed fields → attachment viewer → reload;
10. preset/custom background → reload;
11. habit icon/description/completion independence → reload;
12. light/dark contrast и overflow для `/today`, `/projects`, `/search`,
    `/trash` на desktop/mobile.

`e2e/app.spec.ts` сохраняет регрессионное покрытие базового task flow,
календаря, матрицы, привычек, настроек, mobile dialog и доступных имён.

`e2e/ui-quality.spec.ts` выполняет:

- WCAG AA color-contrast и overflow audit прежних основных маршрутов в двух
  темах и viewport;
- performance gate списка из 500 задач: первая отрисовка < 2 секунд,
  p95 кадра < 40 мс и доля кадров > 50 мс < 8%.

### Независимый visual QA

Вручную и через Playwright осмотрены `/today`, `/projects`, `/search`,
`/trash`, `/inbox`, `/calendar`, `/habits`, `/settings` на 1440×900 и
390×844, в светлой и тёмной темах. Проверялись TaskEditor, четыре dropdown,
viewer image/text, list/board/calendar, создание проекта, фильтры,
trash/archive, Pomodoro, привычки, preset/custom background и voice fallback.

Аудит дал 0 Axe A/AA нарушений, 0 document overflow, 0 console/pageerror.
Найденные им проблемы icon alignment/clipping, mobile ellipsis, 35-cell
calendar, скрытых mobile deadline markers, hit targets, animation/route
flicker и focus trap/restore были исправлены и повторно проверены. Chrome
runtime подтвердил exact focus return к preview, task opener и menu opener.

### Финальный gate 31 июля 2026 года

- `npm test`: **6 файлов, 35/35 тестов**;
- `npm run build`: TypeScript и production Vite build — **успешно**;
- `npm run test:e2e`: **21/21 сценарий**;
- performance в полном E2E: render **1566 мс**, p95 **19,1 мс**, long
  frames **0%**;
- isolated 500-task repeat после hot-path optimization: render
  **1621/1649/1734/1662/1641 мс**, p95 **19,2–20,6 мс**, long frames **0%**,
  **5/5 запусков**;
- пороги не ослаблялись; Playwright использует один worker, чтобы performance
  gate не измерял конкуренцию нескольких Axe/Chrome процессов за CPU.

## Известные ограничения перед следующим этапом

1. Перенести attachments и custom background из data URL/localStorage в
   IndexedDB BlobStore, затем в platform storage.
2. Добавить fake-clock тест полного Pomodoro cycle и историю сессий.
3. Реализовать date-range filter и табличный contract suite комбинаций.
4. Довести project lifecycle: rename/archive/delete и duplicate-name UX.
5. Добавить habit editing.
6. Вынести Web Speech за adapter и явно показать permission/error states.
7. Добавить visual snapshots/geometry assertions для иконок, menus и focus.
8. Реализовать platform/Tauri adapters и настоящие Ubuntu/Android/Windows
   build/install/launch smoke; браузерный MVP не является их доказательством.
