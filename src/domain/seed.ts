import type { AppState, Task } from './models'

const dateAt = (days: number, hour: number) => {
  const value = new Date()
  value.setDate(value.getDate() + days)
  value.setHours(hour, 0, 0, 0)
  return value.toISOString()
}

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

export const createSeedState = (): AppState => ({
  schemaVersion: 2,
  projects: [
    { id: 'inbox', name: 'Без проекта', color: '#9ca89c', createdAt: dateAt(-100, 9) },
    { id: 'work', name: 'Работа', color: '#778c70', description: 'Рабочие задачи и инициативы', createdAt: dateAt(-90, 9) },
    { id: 'personal', name: 'Личное', color: '#9b7fbd', description: 'Личные планы и развитие', createdAt: dateAt(-80, 9) },
    { id: 'shopping', name: 'Покупки', color: '#d78b69', description: 'Списки покупок и быт', createdAt: dateAt(-70, 9) },
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
      ],
    }),
    task({
      id: 'task-groceries',
      title: 'Купить продукты на неделю',
      projectId: 'shopping',
      deadline: dateAt(1, 19),
      tags: ['дом'],
    }),
    task({
      id: 'task-prototype',
      title: 'Проверить прототип интерфейса',
      description: 'Пройти основные сценарии на десктопе и мобильном.',
      projectId: 'work',
      deadline: dateAt(5, 16),
      importance: 'high',
      tags: ['продукт', 'фокус'],
    }),
    task({
      id: 'task-book',
      title: 'Прочитать главу книги',
      projectId: 'personal',
      tags: ['развитие'],
    }),
    task({
      id: 'task-done',
      title: 'Разобрать входящие заметки',
      projectId: 'personal',
      status: 'completed',
      completedAt: dateAt(-1, 20),
      tags: ['порядок'],
    }),
  ],
  habits: [
    { id: 'habit-water', name: 'Пить воду', description: 'Поддерживать водный баланс в течение дня', icon: '💧', targetDays: [1, 2, 3, 4, 5, 6, 0], completions: [], color: '#75a8b5' },
    { id: 'habit-read', name: 'Читать 20 минут', description: 'Небольшой спокойный слот без уведомлений', icon: '📚', targetDays: [1, 2, 3, 4, 5], completions: [], color: '#9b7fbd' },
    { id: 'habit-walk', name: 'Прогулка', description: 'Выйти на воздух и немного размяться', icon: '🌿', targetDays: [1, 2, 3, 4, 5, 6, 0], completions: [], color: '#778c70' },
  ],
  savedFilters: [],
  pomodoro: {
    mode: 'focus',
    durationSeconds: 25 * 60,
    remainingSeconds: 25 * 60,
    completedFocusSessions: 0,
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
})
