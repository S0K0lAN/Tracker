import type { AppState, Task } from './models'

export const DEMO_DATA_VERSION = '2026-08-01'

const task = (data: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({
  id: data.id,
  title: data.title,
  description: data.description ?? '',
  projectId: data.projectId ?? 'personal',
  startAt: data.startAt,
  deadline: data.deadline,
  urgencyThresholdHours: data.urgencyThresholdHours ?? 72,
  urgencyOverride: data.urgencyOverride,
  importance: data.importance ?? 'low',
  tags: data.tags ?? [],
  subtasks: data.subtasks ?? [],
  attachments: data.attachments ?? [],
  reminders: data.reminders ?? [],
  status: data.status ?? 'active',
  createdAt: data.createdAt ?? new Date().toISOString(),
  updatedAt: data.updatedAt ?? new Date().toISOString(),
  completedAt: data.completedAt,
  archivedAt: data.archivedAt,
  deletedAt: data.deletedAt,
  previousStatus: data.previousStatus,
  focusMinutes: data.focusMinutes ?? 0,
})

export const createSeedState = (): AppState => {
  const reference = new Date()
  const dateAt = (days: number, hour: number, minutes = 0) => {
    const value = new Date(reference)
    value.setDate(value.getDate() + days)
    value.setHours(hour, minutes, 0, 0)
    return value.toISOString()
  }
  const dateKeyAt = (days: number) => {
    const value = new Date(reference)
    value.setDate(value.getDate() + days)
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-')
  }
  const scheduledCompletions = (targetDays: number[], offsets: number[]) => offsets
    .map((offset) => {
      const date = new Date(reference)
      date.setDate(date.getDate() + offset)
      return { date, key: dateKeyAt(offset) }
    })
    .filter(({ date }) => targetDays.includes(date.getDay()))
    .map(({ key }) => key)

  const weekdays = [1, 2, 3, 4, 5]
  const everyDay = [1, 2, 3, 4, 5, 6, 0]

  return {
    schemaVersion: 2,
    projects: [
      { id: 'inbox', name: 'Без проекта', color: '#9ca89c', createdAt: dateAt(-100, 9) },
      { id: 'work', name: 'Работа', color: '#778c70', description: 'Рабочие задачи и инициативы', createdAt: dateAt(-90, 9) },
      { id: 'personal', name: 'Личное', color: '#9b7fbd', description: 'Личные планы и развитие', createdAt: dateAt(-80, 9) },
      { id: 'shopping', name: 'Покупки', color: '#d78b69', description: 'Списки покупок и быт', createdAt: dateAt(-70, 9) },
      { id: 'learning', name: 'Обучение', color: '#6f8fa8', description: 'Курсы, книги и практика', createdAt: dateAt(-60, 9) },
      { id: 'health', name: 'Здоровье', color: '#75a88a', description: 'Спорт, врачи и восстановление', createdAt: dateAt(-50, 9) },
    ],
    tasks: [
      task({
        id: 'task-plan',
        title: 'Подготовить план недели',
        description: 'Сверить встречи и выбрать три главных результата.',
        projectId: 'work',
        startAt: dateAt(0, 9),
        deadline: dateAt(0, 18),
        importance: 'high',
        tags: ['фокус', 'планирование'],
        subtasks: [
          { id: 'sub-1', title: 'Проверить календарь', completed: true },
          { id: 'sub-2', title: 'Определить приоритеты', completed: false },
          { id: 'sub-3', title: 'Зарезервировать фокус-блоки', completed: false },
        ],
        reminders: [{ id: 'reminder-plan', at: dateAt(0, 8, 45) }],
        focusMinutes: 50,
        createdAt: dateAt(-7, 11),
      }),
      task({
        id: 'task-team-sync',
        title: 'Синхронизация с командой',
        description: 'Коротко пройти статус задач и снять блокеры.',
        projectId: 'work',
        startAt: dateAt(0, 10),
        deadline: dateAt(0, 11),
        tags: ['работа', 'встречи'],
        createdAt: dateAt(-3, 12),
      }),
      task({
        id: 'task-design-review',
        title: 'Провести дизайн-ревью',
        description: 'Проверить календарные сценарии на desktop и mobile.',
        projectId: 'work',
        startAt: dateAt(0, 10, 30),
        deadline: dateAt(0, 12),
        importance: 'high',
        tags: ['продукт', 'дизайн'],
        attachments: [{
          id: 'attachment-calendar-mockup',
          name: 'calendar-demo.svg',
          type: 'image/svg+xml',
          size: 294,
          dataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0ODAiIGhlaWdodD0iMjcwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZTJlOWRmIi8+PGNpcmNsZSBjeD0iODAiIGN5PSI4MCIgcj0iMzYiIGZpbGw9IiM1ZTc2NTkiLz48dGV4dCB4PSI0MCIgeT0iMTgwIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIzMiIgZmlsbD0iIzI4MzEyOSI+Rm9jdXMgRmxvdyBkZW1vPC90ZXh0Pjwvc3ZnPg==',
        }],
        createdAt: dateAt(-2, 15),
      }),
      task({
        id: 'task-workout',
        title: 'Вечерняя тренировка',
        description: 'Разминка, силовой блок и спокойная заминка.',
        projectId: 'health',
        startAt: dateAt(0, 18, 30),
        deadline: dateAt(0, 19, 30),
        tags: ['здоровье', 'спорт'],
        reminders: [{ id: 'reminder-workout', at: dateAt(0, 18) }],
        createdAt: dateAt(-4, 18),
      }),
      task({
        id: 'task-release',
        title: 'Подготовить демонстрационный релиз',
        description: 'Многодневный пример для диапазонной диаграммы дедлайнов.',
        projectId: 'work',
        startAt: dateAt(-1, 14),
        deadline: dateAt(4, 17),
        importance: 'high',
        tags: ['релиз', 'продукт', 'фокус'],
        subtasks: [
          { id: 'sub-release-1', title: 'Проверить сборку', completed: true },
          { id: 'sub-release-2', title: 'Обновить changelog', completed: false },
          { id: 'sub-release-3', title: 'Подготовить демонстрацию', completed: false },
        ],
        attachments: [{
          id: 'attachment-release-brief',
          name: 'release-brief.txt',
          type: 'text/plain',
          size: 26,
          dataUrl: 'data:text/plain;base64,Rm9jdXMgRmxvdyBkZW1vIGF0dGFjaG1lbnQ=',
        }],
        reminders: [
          { id: 'reminder-release-1', at: dateAt(3, 10) },
          { id: 'reminder-release-2', at: dateAt(4, 15) },
        ],
        focusMinutes: 75,
        createdAt: dateAt(-12, 10),
      }),
      task({
        id: 'task-groceries',
        title: 'Купить продукты на неделю',
        projectId: 'shopping',
        deadline: dateAt(1, 19),
        tags: ['дом', 'покупки'],
        createdAt: dateAt(-2, 9),
      }),
      task({
        id: 'task-weekly-report',
        title: 'Собрать недельный отчёт',
        description: 'Свести результаты, риски и следующие шаги на одной странице.',
        projectId: 'work',
        startAt: dateAt(1, 9, 30),
        deadline: dateAt(1, 11),
        importance: 'high',
        tags: ['работа', 'отчёт'],
        reminders: [{ id: 'reminder-report', at: dateAt(1, 8, 30) }],
        createdAt: dateAt(-5, 13),
      }),
      task({
        id: 'task-doctor',
        title: 'Записаться на профилактический осмотр',
        projectId: 'health',
        startAt: dateAt(2, 11),
        deadline: dateAt(2, 12),
        tags: ['здоровье'],
        reminders: [{ id: 'reminder-doctor', at: dateAt(2, 9) }],
        createdAt: dateAt(-8, 16),
      }),
      task({
        id: 'task-bills',
        title: 'Оплатить счета за квартиру',
        description: 'Дедлайновая задача без отдельного времени начала.',
        projectId: 'personal',
        deadline: dateAt(3, 9),
        importance: 'high',
        tags: ['дом', 'финансы'],
        reminders: [{ id: 'reminder-bills', at: dateAt(2, 19) }],
        createdAt: dateAt(-9, 10),
      }),
      task({
        id: 'task-filters',
        title: 'Заказать фильтры для воды',
        projectId: 'shopping',
        startAt: dateAt(3, 19),
        deadline: dateAt(3, 20),
        tags: ['дом', 'покупки'],
        createdAt: dateAt(-1, 17),
      }),
      task({
        id: 'task-prototype',
        title: 'Проверить прототип интерфейса',
        description: 'Пройти основные сценарии на десктопе и мобильном.',
        projectId: 'work',
        deadline: dateAt(5, 16),
        importance: 'high',
        tags: ['продукт', 'фокус'],
        createdAt: dateAt(-6, 14),
      }),
      task({
        id: 'task-course',
        title: 'Пройти модуль по продуктовой аналитике',
        description: 'Посмотреть урок и законспектировать основные метрики.',
        projectId: 'learning',
        startAt: dateAt(6, 19),
        deadline: dateAt(6, 21),
        tags: ['обучение', 'аналитика'],
        subtasks: [
          { id: 'sub-course-1', title: 'Посмотреть урок', completed: false },
          { id: 'sub-course-2', title: 'Выполнить упражнение', completed: false },
        ],
        createdAt: dateAt(-10, 19),
      }),
      task({
        id: 'task-trip',
        title: 'Подготовиться к поездке',
        description: 'Длинный диапазон для проверки календаря на месяц и год.',
        projectId: 'personal',
        startAt: dateAt(8, 9),
        deadline: dateAt(12, 20),
        importance: 'high',
        tags: ['личное', 'поездка'],
        subtasks: [
          { id: 'sub-trip-1', title: 'Проверить билеты', completed: true },
          { id: 'sub-trip-2', title: 'Составить список вещей', completed: false },
          { id: 'sub-trip-3', title: 'Забронировать трансфер', completed: false },
        ],
        reminders: [{ id: 'reminder-trip', at: dateAt(7, 18) }],
        createdAt: dateAt(-15, 9),
      }),
      task({
        id: 'task-book',
        title: 'Прочитать главу книги',
        description: 'Недатированная задача для проверки Входящих и поиска.',
        projectId: 'personal',
        tags: ['развитие', 'чтение'],
        createdAt: dateAt(-4, 20),
      }),
      task({
        id: 'task-ideas',
        title: 'Разобрать идеи для следующих улучшений',
        description: 'Пример задачи без проекта и дат — готова к планированию позже.',
        projectId: 'inbox',
        tags: ['идеи', 'продукт'],
        createdAt: dateAt(0, 7, 30),
      }),
      task({
        id: 'task-done',
        title: 'Разобрать входящие заметки',
        projectId: 'personal',
        status: 'completed',
        completedAt: dateAt(-1, 20),
        tags: ['порядок'],
        focusMinutes: 25,
        createdAt: dateAt(-5, 18),
      }),
    ],
    habits: [
      {
        id: 'habit-water',
        name: 'Пить воду',
        description: 'Поддерживать водный баланс в течение дня',
        icon: 'water',
        targetDays: everyDay,
        completions: scheduledCompletions(everyDay, [-1, -2, -3, -5, -6]),
        color: '#75a8b5',
      },
      {
        id: 'habit-read',
        name: 'Читать 20 минут',
        description: 'Небольшой спокойный слот без уведомлений',
        icon: 'book',
        targetDays: weekdays,
        completions: scheduledCompletions(weekdays, [-1, -2, -3, -4, -7, -8, -9]),
        color: '#9b7fbd',
      },
      {
        id: 'habit-walk',
        name: 'Прогулка',
        description: 'Выйти на воздух и немного размяться',
        icon: 'nature',
        targetDays: everyDay,
        completions: scheduledCompletions(everyDay, [-1, -3, -4, -7]),
        color: '#778c70',
      },
      {
        id: 'habit-stretch',
        name: 'Утренняя разминка',
        description: 'Пять минут мягкой подвижности перед началом дня',
        icon: 'activity',
        targetDays: weekdays,
        completions: scheduledCompletions(weekdays, [-1, -2, -4, -5, -8]),
        color: '#d78b69',
      },
    ],
    savedFilters: [],
    pomodoro: {
      mode: 'focus',
      durationSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      completedFocusSessions: 3,
    },
    settings: {
      theme: 'light',
      accent: 'sage',
      compactMode: false,
      reduceMotion: false,
      autoSync: false,
      defaultUrgencyThresholdHours: 72,
      syncProvider: 'demo',
      inboxView: 'list',
      inboxSort: 'created-desc',
      backgroundPreset: 'none',
      backgroundDim: 35,
    },
    sync: { status: 'idle' },
  }
}
