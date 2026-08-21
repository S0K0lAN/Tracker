# Временный отчёт об аудите Focus Flow

> Дата: 21 августа 2026 года. Файл собран как временный рабочий артефакт и
> может быть удалён после переноса принятых решений в постоянную документацию
> и GitHub issues.

## 1. Объём и методика

Проверены:

- все девять маршрутов приложения и fallback неизвестного URL;
- основной цикл «быстро записать → увидеть во времени и матрице → выполнить»;
- desktop 1440×900, промежуточная ширина 1024×900 и mobile 390×844;
- клавиатура, focus management, доступные имена, light/dark и reduced motion;
- модели, миграции schema v1–v4, localStorage recovery, portable import/export;
- OAuth runtime, Google Drive adapter, remote snapshots и plugin registry;
- 19 открытых GitHub issues через публичный GitHub API;
- зависимости (`npm audit` и production-only audit);
- unit/component, TypeScript/build и Playwright E2E baseline.

Discovery независимо выполняли три агента: security/privacy, UI/UX/accessibility
и product/domain/architecture. Ведущий агент отдельно воспроизвёл критичные
сценарии и свёл выводы с `docs/business-requirements.md` и `AGENTS.md`.
Оставшиеся исправления независимо перепроверяли отдельные агенты по UI/router,
storage races, durable drafts и data integrity; найденные ими P1/P2 получили
точные regression-тесты до финального общего gate.

Baseline до исправлений:

- `npm test`: 184/184 теста прошли;
- `npm run build`: успешно;
- `npm run test:e2e`: 34/34 сценария прошли;
- performance gate на 500 задач: render 345 ms, p95 frame 24,6 ms,
  long frames 0%;
- Axe не нашёл автоматических WCAG AA-нарушений, но ручной аудит нашёл
  несколько сценариев, которые статический анализ не видит.

## 2. Краткий результат аудита концепций

### Быстрый захват и карточка задачи

Сильные стороны: для создания достаточно названия, есть `Ctrl/Cmd+K`, голосовой
parser, подзадачи, даты, проект, теги, напоминания и вложения. Существующая
задача сначала открывается в читаемом режиме.

Исправлено в текущем цикле:

- создание из страницы проекта наследует проект, включая отдельное mobile-действие;
- дедлайн раньше начала блокируется с доступной ошибкой и фокусом поля;
- черновик редактора восстанавливается после reload/закрытия, ограничен по
  размеру и удаляется только после подтверждённого сохранения или явного отказа;
- добавлены `Ctrl/Cmd+Enter` и подсказка быстрого сохранения;
- после удаления, завершения и архивации фокус переходит на соседнюю карточку
  либо устойчивый заголовок страницы.

### Сегодня

Экран правильно разделяет просроченные, запланированные и deadline-only задачи,
не дублируя одну задачу в двух сегодняшних секциях. Общий минутный clock теперь
обновляет дату и срочность при переходе порога/полуночи без перезагрузки.

Пустой день теперь показывает один содержательный empty state без двух
дублирующих пустых секций.

### Входящие

Подтверждённая концепция удачна: это единое представление всех задач, включая
проектные, с list/board, фильтрами и сортировкой. Нельзя реализовывать issue #22
как изменение смысла маршрута. Совместимое решение — сохранённый фильтр
«Неразобранное»: `projectId=inbox AND no startAt AND no deadline`.

Исправлено:

- на 21 августа 2026 года заголовок показывал захардкоженное «Четверг»;
- счётчик «На сегодня» учитывал только `startAt`, тогда как быстрый фильтр и
  Today учитывают `startAt OR deadline`;

Остаётся:

- windowed list сохраняет performance, но в accessibility tree присутствует
  только текущее окно. Нужен отдельный keyboard/AT design: доступная пагинация
  или виртуализатор, способный последовательно достигнуть всех элементов.

### Проекты

Плоские личные проекты соответствуют single-user scope. Создание, редактирование,
удаление и перенос задач в системный inbox работают. Деталь проекта получила
прямой URL `/projects/:id`, корректные reload/Back/Forward и переход из поиска;
несуществующий или удалённый проект безопасно возвращает к списку. Общий codec
добавляет сегменту непустой префикс, поэтому импортированные ID `.`/`..` не
нормализуются браузером в другой маршрут.

### Календарь и дедлайны

Режимы год/месяц/неделя/3 дня/день/дедлайны реализованы. Timed events используют
`startAt`; deadline остаётся отдельной семантикой. Пересечения раскладываются по
колонкам.

Исправленные дефекты текущего цикла:

- в deadline lane `Ещё N` не было интерактивным, поэтому скрытые задачи нельзя
  было открыть (#35);
- месячные диапазоны дробились на отдельные cell-local chips вместо стабильных
  непрерывных полос в пределах недельной строки (#33, конкретный UPD issue);
- неограниченное число месячных полос могло создать тысячи tab-stop и страницу
  высотой десятки тысяч пикселей. Теперь видимы три стабильные lane, остальные
  доступны по отдельной кнопке полного списка дня.

Не следует смешивать в один патч три разные сущности: all-day событие,
плановый интервал и deadline. Сначала нужна отдельная модель date-only/all-day.

На mobile недельные семь колонок слишком узкие: подписи почти исчезают. После
стабилизации полос разумный default — «3 дня», но смена default требует
продуктового решения и persistence/URL-state.

### Матрица Эйзенхауэра

Модель с независимыми importance и urgency понятна и соответствует требованиям.
Перенос порога срочности целиком в проект (#31) сломал бы индивидуальный порог
задачи. Совместимое будущее расширение: project default + явное наследование/
override на задаче.

### Поиск

Поиск задач, проектов, тегов и saved filters реализован. Нижний дубликат quick
add уже удалён commit `12f95c8`; остаются обычная page action и глобальная
кнопка согласно общему правилу. Результат проекта ведёт в URL-addressable
project detail, а запрос и вкладка сохраняются в query string и истории.

### Привычки

Текущая статистика полезна: индивидуальный planned-day progress, streak и
14-дневный trend. Для новой привычки отсутствует `createdAt`, поэтому прошлые
плановые дни могут сразу ухудшать процент. Расширенную статистику нельзя
проектировать по пустому issue #48; сначала зафиксировать метрики 7/28/90 дней,
current/best streak и heatmap.

График получил скрытую визуально семантическую таблицу с дневными значениями;
она не создаёт горизонтальный overflow на mobile.

### Корзина, архив и данные

Soft delete, restore, permanent delete и отдельный archive работают. Reset demo
требует подтверждение, транзакционно сохраняет предыдущую копию и даёт undo.
Интерфейс явно объясняет retention: backup/import-backup и ранее выгруженный
JSON могут продолжать содержать сущность после «Удалить навсегда». Аварийный
journal самой задачи при окончательном удалении очищается.

### Настройки, синхронизация и расширения

Темы, typography, background, import/export и sync UX развиты хорошо для MVP.
UI теперь честно называет текущий in-process `PluginRegistry` экспериментальным
каркасом: permissions/sandbox пока отсутствуют, внешние плагины не загружаются.

Production-ready Google Drive нельзя заявлять без live OAuth smoke. Browser GIS
с фиксированным `drive.appdata` scope — проверяемый MVP, не замена desktop PKCE
и secret store.

## 3. GitHub issues

Состояние получено 21 августа 2026 года из
`https://github.com/S0K0lAN/Tracker/issues`.

| Issue | Решение текущего аудита | Предложение / основание |
| --- | --- | --- |
| [#49 Повторяющиеся задачи](https://github.com/S0K0lAN/Tracker/issues/49) | Future, не реализовывать | ADR для recurrence rule, instances/exceptions, edit this/future/all, timezone/date-only и tombstones; затем schema migration. |
| [#48 Статистика привычек](https://github.com/S0K0lAN/Tracker/issues/48) | Needs thought | Сначала определить planned/completed, 7/28/90, current/best streak, heatmap и дату создания привычки. |
| [#47 Убрать календари на год](https://github.com/S0K0lAN/Tracker/issues/47) | Конфликт требований | Year — подтверждённый режим. При нехватке места скрывать его в overflow, не удалять модель/маршрут. |
| [#46 Длительность задачи](https://github.com/S0K0lAN/Tracker/issues/46) | Нужна смена модели | Сейчас deadline заменяет end. Возможное будущее: `durationMinutes`/`endAt`, deadline отдельно; следующая schema migration, DST и overnight tests. |
| [#45 Плашка сроков/all-day](https://github.com/S0K0lAN/Tracker/issues/45) | Future/dependency | Зависит от #44/#46. После date-only модели объединить all-day events и deadline bands, сохраняя семантическое различие. |
| [#44 Задачи на весь день](https://github.com/S0K0lAN/Tracker/issues/44) | Future/open question | `allDay` + локальная дата `YYYY-MM-DD`, без UTC midnight; migration, timezone/DST/import tests. |
| [#39 Кнопка в Поиске](https://github.com/S0K0lAN/Tracker/issues/39) | Закрыто как выполненное | Нижний дубликат удалён `12f95c8`; общая page/global create affordance сохранена. |
| [#35 Кликабельность сроков](https://github.com/S0K0lAN/Tracker/issues/35) | Исправлено и закрыто | `Ещё N`/deadline panel открывает полный доступный список дня, item открывает task details, focus возвращается. |
| [#34 Новые фоны](https://github.com/S0K0lAN/Tracker/issues/34) | Needs thought | Нужны brief, лицензии, light/dark screenshots, contrast и size/performance budget. Исправить только доказанный contrast defect. |
| [#33 Дедлайны на месяце](https://github.com/S0K0lAN/Tracker/issues/33) | Исправлено и закрыто по конкретному UPD | Непрерывные bands в week row, stable lanes, continuation на границах, deadline-only = 1 день, keyboard/mobile; число видимых lane ограничено тремя. |
| [#31 Порог срочности проекта](https://github.com/S0K0lAN/Tracker/issues/31) | Конфликт требований | Сохранить per-task threshold; возможен project default с явным inherit/override. |
| [#30 Google auth](https://github.com/S0K0lAN/Tracker/issues/30) | UI/code закрыто с оговоркой | GIS одна кнопка, build-time client ID и `drive.appdata`; credentialed live smoke остаётся отдельным release gate. |
| [#27 Выбор времени](https://github.com/S0K0lAN/Tracker/issues/27) | Закрыто как выполненное | Общий DateTimePicker, manual mask, date/time popover, keyboard/component/E2E. |
| [#22 Смысл Входящих](https://github.com/S0K0lAN/Tracker/issues/22) | Конфликт требований | Не сужать Inbox; добавить smart filter «Неразобранное». |
| [#21 Статистика дня/AI](https://github.com/S0K0lAN/Tracker/issues/21) | Future/question | Сначала локальная deterministic card: completed today, planned done/total, overdue carry, focus minutes. AI — отдельный opt-in/privacy/cost design. |
| [#18 Команды](https://github.com/S0K0lAN/Tracker/issues/18) | Новое направление, вне scope | Потребуются tenant/auth/ACL/server sync/audit/concurrency; текущий продукт single-user. |
| [#17 Гант](https://github.com/S0K0lAN/Tracker/issues/17) | Future/plan | Текущий deadline view — light Gantt. Полный Gantt требует duration, dependencies, progress и keyboard drag parity. |
| [#16 Календари проектов](https://github.com/S0K0lAN/Tracker/issues/16) | Future/plan | Предпочтительно project filter в едином Calendar + URL/query/deep-link из Project, не отдельные копии календаря. |
| [#12 Дедлайны на календаре](https://github.com/S0K0lAN/Tracker/issues/12) | Needs thought/duplicate | Консолидировать с #33/#35/#45 после выбора all-day/date-only модели. |

Повторная проверка после исправлений показала ровно 14 открытых issues:
#12, #16, #17, #18, #21, #22, #31, #34 и #44–#49. Все относятся к
future/needs-thought/conflict scope; новых однозначно исполнимых issues нет,
поэтому они оставлены открытыми без изменения.

## 4. Security и privacy

### Подтверждённые риски до исправлений

1. Snapshot принимал произвольный `Project.color`/`Habit.color`. Значение
   `url(http://host/beacon)` попадало в inline `background`; Chrome подтвердил
   внешний GET. Это privacy leak и blind request к доступному браузеру адресу.
2. Quarantine localStorage могла падать по quota до чтения валидного backup.
   Ошибка записи восстановленного primary ошибочно считалась повреждением backup
   и могла удалить единственную хорошую копию.
3. Drive adapter игнорировал metadata `size` и целиком выполнял `response.json()`;
   повреждённый удалённый файл мог исчерпать память/CPU до validation.
4. Snapshot validation принимала непарсибельные даты; TaskCard мог вызвать
   `RangeError` в `Intl.DateTimeFormat` и уронить страницу.
5. Некорректный GIS response с token и invalid expiry оставлял orphan token и
   прикладывал token-bearing response как error cause.
6. Dev server по умолчанию слушал `0.0.0.0`; использование HTTP на недоверенной
   Wi‑Fi сети позволяет активному посреднику подменить JS и прочитать данные.

### Исправлено по результатам security review

- schema повышена до v4: v1–v3 безопасно нормализуются, v4 строго проверяет
  даты, порядок начала/дедлайна, цвета, пороги и `pomodoro.runningSince`;
- CSS-цвета проектов/привычек ограничены `#RRGGBB`, поэтому import/sync больше
  не может инициировать внешний request через `url(...)`;
- recovery не удаляет источник при неуспешной quarantine и не принимает ошибку
  записи primary за повреждение валидного backup;
- download и upload Drive ограничены 10 МиБ до JSON parse/первого запроса;
- malformed/late OAuth responses отзывают orphan token, token-bearing response
  не попадает в error cause;
- некорректная дата TaskCard/Pomodoro больше не роняет UI и не начисляет ложные
  минуты;
- обычные `npm run dev`/`npm run preview` слушают loopback; LAN вынесен в явные
  `dev:lan`/`preview:lan` с предупреждением в README;
- экспорт явно помечен как незашифрованный конфиденциальный JSON.
- snapshot ограничен по глубине и сложности; v4 проверяет уникальность ID,
  canonical inbox и ссылки задач, фильтров и Pomodoro, а legacy v1–v3
  детерминированно восстанавливаются;
- outgoing portable/remote snapshot валидируется до публикации, поэтому
  приложение не создаёт экспорт, который само не сможет безопасно прочитать;
- сохранения сериализованы и coalesce-ятся; import/reset/remote replace не
  позволяют поздней записи затереть более новое локальное состояние.
- задача закрывается только после реального успешного `StorageAdapter.save`;
  delayed/rejected save, debounce и CAS новой вкладки покрыты регрессиями;
- permanent delete и успешные import/restore/reset очищают соответствующие
  аварийные journals, а неуспешная замена сохраняет их для восстановления;
- изменение device-local `autoSync` во время remote replace не затирается, и
  stale операция больше не оставляет UI в бесконечном `syncing`.

### Dependency audit

- production dependencies: 0 известных advisories;
- полный audit до исправления: dev-only `nanoid@3.3.16`, advisory
  `GHSA-2v37-7h3g-55p8` через Vite/PostCSS. Lockfile обновлён до `nanoid@3.3.18`;
  итоговые production/full audit сообщают 0 advisories.

### Уже защищено

- нет `dangerouslySetInnerHTML`, `innerHTML`, `eval` или `new Function`;
- React экранирует пользовательский текст;
- `javascript:`/external attachment URLs отклоняются, MIME сверяется;
- PDF preview sandboxed;
- OAuth scope ограничен `drive.appdata`, Drive IDs URL-encoded;
- access token остаётся в memory-only runtime и исключён из local/remote state;
- secret-like provider config keys отклоняются;
- tracked secrets не найдены.

### Deployment recommendations

Vite dev server не является production-hosting. На production-host/Tauri shell
нужны CSP и заголовки:

- `frame-ancestors 'none'` / `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- строгие `Referrer-Policy` и `Permissions-Policy`;
- GIS allowlist в `script-src`, `frame-src`, `connect-src`;
- для OAuth popup проверить `Cross-Origin-Opener-Policy: same-origin-allow-popups`.

CSP нельзя добавлять вслепую без live Google smoke. Для LAN dev нужен отдельный
явный скрипт и доверенный HTTPS; обычный `npm run dev` безопаснее bind к loopback.

Экспорт содержит незашифрованные задачи и вложения. UI должен предупреждать,
что JSON-файл конфиденциален. В будущем нужны команды удаления remote Drive copy
и полного уничтожения local primary/backups/quarantine с понятной retention
policy.

## 5. Неисправленные архитектурные риски и предлагаемый порядок

В этом цикле закрыты три прежних риска: `StorageAdapter` инъецируется на время
жизни provider и пишет через последовательную очередь; TaskEditor использует
durable recovery journal; import/sync/export проверяют IDs, ссылки, глубину и
complexity budgets.

1. Вынести reducer из `AppContext` в application commands/repositories.
2. Ввести device UUID, entity revision, `deletedAt` tombstones, base snapshot,
   `If-Match`/ETag и трёхсторонний merge.
3. Вынести attachments в BlobStore/IndexedDB, затем platform storage.
4. Создать Tauri adapter с atomic temp→backup→replace и реальным Ubuntu smoke.
5. Plugin API проектировать только после permissions, sandbox/capability RPC,
   namespaced storage и запрета прямого DOM/localStorage/token access.

## 6. Итоговый verification

- чистая установка `npm ci`: успешно;
- `npm test`: 35 файлов, 376/376 тестов;
- `npm run build`: TypeScript и production build успешно;
- `npm run test:e2e`: 40/40 сценариев;
- `npm audit` и `npm audit --omit=dev`: 0 advisories;
- 500 задач: render 552 ms, p95 frame 23,0 ms, long frames 0%;
- light/dark WCAG AA automation и horizontal-overflow gate прошли;
- визуально проверены 1440×900, 1024×900 и 390×844: deadline bands,
  desktop/sidebar breakpoint и mobile project context action;
- browser gate собирал `pageerror`/`console.error`; новых ошибок нет.

Основной снимок опубликован commit
[`f123105`](https://github.com/S0K0lAN/Tracker/commit/f123105581a44cd2818067977d143b5f3b32f580).
Issues #27, #30, #33, #35 и #39 получили комментарии с test evidence и закрыты
как выполненные. Future/needs-thought/conflict issues остались открыты и не
изменялись; предложения по ним находятся в разделе 3.

Оставшиеся подтверждённые замечания опубликованы отдельным commit
[`080bb13`](https://github.com/S0K0lAN/Tracker/commit/080bb132c157397a7de3f246d3d3b5542ecd8d6b)
в [draft PR #50](https://github.com/S0K0lAN/Tracker/pull/50). PR не закрывает и
не меняет future/needs-thought/conflict issues.
