# Acceptance-матрица расширенной функциональности

## Назначение

Матрица переводит расширенные продуктовые запросы в наблюдаемые критерии
приёмки. Документация актуализирована 21 августа 2026 года по результатам
независимого аудита и полного локального test/browser gate.
Текущий результат команд отделён ниже от исторических browser gates:
наличие теста в репозитории само по себе не считается свежим evidence.

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
4. desktop 1440×900, промежуточный viewport 1024×900 и mobile 390×844 не
   имеют horizontal overflow и сохраняют доступную навигацию;
5. светлая и тёмная темы проходят WCAG AA color-contrast;
6. нет `pageerror` и необработанных `console.error`;
7. проходят `npm test`, `npm run build` и `npm run test:e2e`.

Будущие platform/next-stage функции не расширяют задним числом Definition of
Done браузерного MVP. Они честно вынесены в отдельный раздел ограничений.

## Матрица

| ID | Требование | Статус | Evidence текущего scope |
|---|---|---|---|
| UX-01 | Выровнять положения всех иконок | **Готово** | Единые размеры Lucide и control CSS, исправленный mobile containing block; независимый visual QA desktop/mobile и pointer E2E task-actions подтверждают отсутствие смещения, clipping и interception. |
| UX-02 | Единые dropdown в редакторе задачи | **Готово** | `SelectMenu` используется для проекта, важности, порога и override; portal расположен выше modal backdrop, а pointer/keyboard/Escape/Tab сценарии редактора покрыты component и Playwright. |
| UX-03 | Понятное отображение важности | **Готово** | `TaskCard` показывает текст «Обычно/Важно» и контурный/заполненный флаг, поэтому значение не зависит только от цвета и одинаково читается в task layouts. |
| UX-04 | Улучшенный выбор проекта | **Готово** | Searchable `SelectMenu` показывает цвет и описание; create project → select in task → reload → URL-addressable project detail и переход из поиска покрыты component/E2E. |
| UX-05 | Просмотр задачи до редактирования | **Готово** | `TaskDetails` показывает содержимое без полей ввода; component и отдельный E2E проверяют явный переход к редактору, таймер, завершение/возврат и focus restore. |
| NAV-01 | Отдельная страница «Сегодня» | **Готово** | `/today` есть в desktop/mobile navigation; component-тест проверяет секции и отсутствие дубля scheduled deadline, E2E — direct URL, Back/Forward и heading. |
| NAV-02 | Доступная навигация на промежуточной ширине | **Готово** | React и CSS используют единый breakpoint 820 px; desktop Sidebar остаётся доступным на 1024 px, а mobile drawer получает dialog/inert semantics. Сценарии покрыты Playwright. |
| PRJ-01 | Создание и lifecycle проектов | **Готово** | `/projects` поддерживает создание и редактирование названия/цвета/описания, detail и подтверждаемое удаление. Component проверяет menu/edit; reducer при удалении переносит задачи в system Inbox и очищает `projectId` сохранённых фильтров. Архив/иерархия и duplicate-name UX остаются вне критерия. |
| ATT-01 | Просмотр фото и файлов | **Готово** | Viewer открывает image/PDF/text, поддерживает zoom, download, `Escape` и возврат focus; E2E загружает text attachment и повторно открывает после reload в пределах лимита браузерного MVP. |
| FLT-01 | Составной и сохраняемый фильтр | **Готово** | Есть status/project/importance/urgency/tags ANY/ALL; UI показывает активные условия, сброс; E2E сохраняет и применяет named filter после reload. |
| SEARCH-01 | Поиск задач, проектов, тегов и фильтров | **Готово** | `/search` регистронезависимо группирует четыре типа результатов; component/E2E подтверждают кириллический поиск, empty state, сохранение и повторное применение фильтра. |
| TRASH-01 | Корзина удалённых задач | **Готово** | Soft delete → `/trash` → reload → restore → Inbox проходит E2E; permanent delete требует и component-тестом проверяет явное второе подтверждение. |
| POM-01 | Таймер фокуса для задачи | **Готово** | Действие явно подписано «Таймер фокуса · 25 минут»; desktop/mobile E2E проверяют task binding, pause и timestamp persistence после reload. |
| CAL-01 | Дедлайны и навигация календаря | **Готово** | Deadline-only task отображается marker в week/month, многодневные сроки — полосами месяца; отдельный deadlines mode удалён, а E2E проверяет смену периода горизонтальным drag. |
| INB-01 | Сортировка входящих | **Готово** | Доступны created desc, nearest deadline, importance и title; component проверяет порядок, E2E — сохранение выбора после reload. |
| ARC-01 | Архив выполненных задач | **Готово** | Individual/bulk archive, отдельный Archive tab, restore и reload реализованы; component/E2E проверяют полный цикл возврата в completed Inbox. |
| HAB-01 | Правильный «Ваш ритм» и серии | **Готово** | Pure test с фиксированным временем проверяет independent schedule/progress/streak, UI считает только плановые прошедшие дни привычки. |
| HAB-02 | Независимое выполнение привычек | **Готово** | Component/E2E отмечают одну привычку, доказывают неизменность другой и persistence после reload. |
| HAB-03 | 10 векторных иконок привычки | **Готово** | Component проверяет все 10 Lucide radio-options и выбранную «Книгу»; E2E подтверждает иконку после reload. |
| HAB-04 | Описание и редактирование привычки | **Готово** | Создание, редактирование и reload имени, optional description, иконки и истории покрыты component/E2E. Настройка `targetDays` и цвета в этот критерий не входит и ещё не реализована. |
| INB-02 | List/board и отдельный календарь | **Готово** | Component проверяет list/board, persistence и отсутствие устаревших calendar view/shortcut; `/calendar` остаётся самостоятельным маршрутом общей навигации. |
| BG-01 | Встроенные фоны | **Готово** | Presets, «без фона», dim и global application реализованы; E2E проверяет preset/reload, все страницы — light/dark desktop/mobile contrast и overflow. |
| BG-02 | Собственный фон | **Готово** | MIME/size validation, upload, global application и reload покрыты E2E в честно документированных browser/localStorage лимитах. |
| TYPE-01 | Настройка шрифта всего приложения | **Готово** | Три локальных системных стека и масштаб 90–120% применяются CSS variables; schema v2 мигрирует в v3, component/E2E проверяют persistence и отсутствие mobile overflow при 120%. |
| DATA-01 | Скачать и импортировать переносимую JSON-копию | **Готово** | Экспорт исключает OAuth/device-local sync config; импорт до изменения данных проверяет 10 МБ, схему, вложения и фон, показывает preview, требует подтверждение, сохраняется после reload и оставляет восстанавливаемую предыдущую копию. |
| VOICE-01 | Надиктовывание задачи | **Готово** | Web Speech ru-RU и ручной fallback интегрированы; fallback остаётся рабочим при отсутствии API и проверен E2E. |
| VOICE-02 | Разбор надиктованной задачи | **Готово** | Unit с фиксированным `now` проверяет default `startAt`, явные «до»/«дедлайн»/«срок», weekday, time, importance, tags и project; component/E2E — preview → взаимоисключающее применение даты → saved task. |
| DES-01 | Лаконичный дизайн Todoist/Singularity | **Готово** | Общие tokens и progressive disclosure реализованы; независимый аудит desktop 1440×900, intermediate 1024×900 и mobile 390×844 подтвердил layering, focus и отсутствие horizontal overflow. |
| QA-01 | Независимое покрытие новых функций | **Готово** | Набор содержит unit/component/E2E с наблюдаемыми эффектами, browser-error collection, обе темы и desktop/intermediate/mobile loops. Полный локальный gate 21 августа 2026 года записан ниже; непрерывного CI пока нет. |
| DOC-01 | Синхронизировать документацию | **Готово** | `README.md`, `AGENTS.md`, `docs/business-requirements.md`, `docs/extended-features.md` и эта матрица согласованы по девяти маршрутам, schema v4, миграциям v1–v3, ограничениям и тестам. |
| SYNC-01 | Подключить Google Drive через OAuth без сохранения token | **Готово** | GIS runtime использует только `drive.appdata`; подключение лишь авторизует и не переносит данные. Unit и mock-browser E2E проверяют connect, повторный вход после reload/401 и отсутствие token в localStorage/remote envelope. Live smoke честно вынесен за scope без credentials. |
| SYNC-02 | Разделить получение, отправку и согласование данных | **Готово** | «Получить» не пишет remote, при отсутствии файла ничего не меняет, а применение отличающейся копии требует preview/confirm и создаёт rollback backup. «Отправить» не применяет remote локально, использует revision precondition и требует confirm при различии. Ручное «Синхронизировать» и авто-sync используют reconcile; component/unit и mock-browser E2E проверяют наблюдаемые эффекты каждого направления и конфликтов. |
| SYNC-03 | Задел под новые хранилища | **Готово** | Второй configurable interactive provider полностью подключается через registry descriptor/runtime; component-тест проверяет defaults, required public config, connect и upload без Google-specific ветки. Secret config registry отклоняет. |

Итого по явному scope браузерного MVP: **33 готовых**, **0 частично готовых**,
**0 отсутствующих** критериев.

## Тестовая трассировка

### Unit и component

- `src/domain/voiceParser.test.ts` — 9 сценариев русского парсинга с
  фиксированным `now`, включая Unicode-safe границы кириллических токенов.
- `src/components/TaskEditor.test.tsx` — применение голосовой даты к началу или
  дедлайну, очистка второго поля и сброс невалидного ручного ввода.
- `src/components/TaskDetails.test.tsx` — read mode, подзадачи, task actions и
  focus restore; `SettingsTypography.test.tsx` — применение/миграция шрифта.
- `src/pages/ProjectsPage.test.tsx` — menu проекта, редактирование и сохранение
  обновлённого названия/описания/цвета.
- `src/NewFeatures.test.tsx` — Today, Projects, Search, soft delete/restore,
  permanent delete confirmation, archive/restore, сортировка, list/board
  Входящих и отдельный календарь, Pomodoro, deadline-only week/month, `Escape` внутри `SelectMenu` и
  keyboard navigation task action-menu, 42-cell calendar и focus trap/restore
  TaskEditor, AttachmentViewer и mobile Sidebar.
- `src/pages/HabitsPage.test.tsx` — rhythm/streak, независимый toggle,
  10 иконок и optional description.
- `src/domain/models.test.ts` — urgency/overdue.
- `src/core/sync/GoogleDriveAdapter.test.ts` — контрактные сценарии Drive.
- `src/core/auth/GoogleIdentityAuthorization.test.ts` — GIS scope/session,
  expiry, revoke, retry загрузки script и отмена позднего OAuth callback.
- `src/core/sync/RemoteSnapshot.test.ts`, `SyncDecision.test.ts` и
  `SyncProviderRegistry.test.ts` — envelope, hash/base decision, credential
  isolation, глубокая проверка remote data и расширяемый registry contract.
- `src/core/storage/LocalStorageAdapter.test.ts` и
  `src/components/AttachmentViewer.test.tsx` — quarantine/transactional restore,
  совместимость исторической schema v2 и блокировка executable attachment URL.
- `src/state/AppContext.sync.test.tsx` — независимые pull/push/reconcile,
  download/upload/reset races и новый runtime после `401`;
  `SettingsSyncProvider.test.tsx` — три отдельные операции и второй
  configurable interactive provider без специальных веток.

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
13. Google OAuth без переноса данных при входе → отдельное получение remote с
    preview/backup → отдельная отправка local с revision guard → reconcile
    автосинхронизации → reload без сохранения token → восстановление backup до
    импорта.

`e2e/task-details.spec.ts` отдельно проверяет, что карточка открывает просмотр,
редактирование остаётся явным, а timer/menu actions меняют DOM и persisted state.

`e2e/app.spec.ts` сохраняет регрессионное покрытие базового task flow,
календаря, матрицы, привычек, настроек, mobile dialog и доступных имён.

`e2e/ui-quality.spec.ts` выполняет:

- WCAG AA color-contrast и overflow audit прежних основных маршрутов в двух
  темах и viewport;
- performance gate списка из 500 задач: первая отрисовка < 2 секунд,
  p95 кадра < 40 мс и доля кадров > 50 мс < 8%.

### Исторический независимый visual QA

В срезе 3 августа 2026 года вручную и через Playwright осмотрены `/today`, `/projects`, `/search`,
`/trash`, `/inbox`, `/calendar`, `/habits`, `/settings` на 1440×900 и
390×844, в светлой и тёмной темах. Проверялись TaskEditor, четыре dropdown,
viewer image/text, Inbox list/board и отдельная страница Calendar, создание проекта, фильтры,
trash/archive, Pomodoro, привычки, preset/custom background и voice fallback.

Аудит дал 0 Axe A/AA нарушений, 0 document overflow, 0 console/pageerror.
Найденные им проблемы icon alignment/clipping, mobile ellipsis, 35-cell
calendar, скрытых mobile deadline markers, hit targets, animation/route
flicker и focus trap/restore были исправлены и повторно проверены. Chrome
runtime подтвердил exact focus return к preview, task opener и menu opener.

### Исторический зелёный gate 3 августа 2026 года

- `npm test`: **18 файлов, 126/126 тестов**;
- `npm run build`: TypeScript и production Vite build — **успешно**;
- `npm run test:e2e`: **30/30 сценариев**;
- performance gate прошёл и в полном E2E; isolated 500-task repeat после
  windowed-list optimization: render **377/395/378 мс**, p95
  **22,8/22,1/25,7 мс**, long frames **0%**, **3/3 запуска**;
- пороги не ослаблялись; Playwright использует один worker, чтобы performance
  gate не измерял конкуренцию нескольких Axe/Chrome процессов за CPU.

Этот результат относится к тогдашнему набору и не доказывает последующие
сценарии после новых изменений.

### Исторический локальный аудит 10–11 августа 2026 года

- inventory: **25 Vitest-файлов / 184 теста** и **4 Playwright-файла /
  34 сценария**;
- на Node.js 26 обычный `npm test` падает в setup из-за конфликта
  экспериментального Web Storage Node с jsdom;
- 11 августа `NODE_OPTIONS=--no-experimental-webstorage npm test`:
  **184/184 успешно**;
- 11 августа `npm run build`: TypeScript и production Vite build — **успешно**;
- 10 августа `npm run test:e2e`: browser assertions не выполнялись, потому что
  конфигурация требует отсутствующий в среде системный Google Chrome;
- CI в репозитории отсутствует, а `npm run check` не включает E2E.

Этот датированный срез не считался полным зелёным gate; его заменяет более
новая проверка ниже.

### Полный локальный аудит 21 августа 2026 года

- Node.js **18.19.1**, npm **9.2.0**;
- `npm test`: **35 Vitest-файлов, 376/376 тестов**;
- `npm run build`: TypeScript и production Vite build — **успешно**;
- `npm run test:e2e`: **5 Playwright-файлов, 40/40 сценариев**;
- `npm audit` и `npm audit --omit=dev`: **0 известных уязвимостей**;
- 500 задач: первая отрисовка **552 мс**, p95 кадра **23,0 мс**, длинные
  кадры **0%**;
- автоматические WCAG AA, light/dark, horizontal-overflow и browser-error
  gates прошли на desktop/mobile; отдельный сценарий подтвердил доступную
  навигацию на промежуточной ширине **1024×900**.

Независимые агенты отдельно проверили security/privacy, целостность данных,
storage races, durable TaskEditor journal, UI/UX/focus и маршрутизацию. После
интеграционного review все найденные blocker/P1/P2 были закрыты regression-
тестами. CI в репозитории по-прежнему отсутствует, поэтому это датированный
локальный снимок, а не непрерывная гарантия.

## Известные ограничения перед следующим этапом

1. Перенести attachments и custom background из data URL/localStorage в
   IndexedDB BlobStore, затем в platform storage.
2. Добавить fake-clock тест полного Pomodoro cycle и историю сессий.
3. Реализовать date-range filter и табличный contract suite комбинаций.
4. Добавить иерархию/архив проектов и duplicate-name UX; rename/delete уже
   реализованы.
5. Зафиксировать проверяемую Node-линию и CI; сделать Chrome/Chromium
   prerequisite E2E воспроизводимым.
6. Вынести Web Speech за adapter и явно показать permission/error states.
7. Добавить visual snapshots/geometry assertions для иконок, menus и focus.
8. Реализовать platform/Tauri adapters и настоящие Ubuntu/Android/Windows
   build/install/launch smoke; браузерный MVP не является их доказательством.
