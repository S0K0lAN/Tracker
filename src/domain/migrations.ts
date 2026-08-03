import type { AppState, Habit, Project, SavedFilter, Task, TaskStatus } from './models'
import { createSeedState } from './seed'

export const CURRENT_SCHEMA_VERSION = 2

export function normalizeAppState(input: unknown): AppState {
  const seed = createSeedState()
  if (!input || typeof input !== 'object') return seed
  const raw = input as Partial<AppState>
  const rawSettings = raw.settings as (Partial<AppState['settings']> & { inboxView?: string }) | undefined
  const now = new Date().toISOString()

  return {
    ...seed,
    ...raw,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tasks: Array.isArray(raw.tasks) ? raw.tasks.map((task) => normalizeTask(task, now)) : seed.tasks,
    projects: Array.isArray(raw.projects) ? raw.projects.map((project) => normalizeProject(project, now)) : seed.projects,
    habits: Array.isArray(raw.habits) ? raw.habits.map(normalizeHabit) : seed.habits,
    savedFilters: Array.isArray(raw.savedFilters) ? raw.savedFilters.map((filter) => normalizeFilter(filter, now)) : [],
    pomodoro: {
      ...seed.pomodoro,
      ...(raw.pomodoro ?? {}),
    },
    settings: {
      ...seed.settings,
      ...(rawSettings ?? {}),
      inboxView: rawSettings?.inboxView === 'board' ? 'board' : 'list',
    },
    sync: {
      ...seed.sync,
      ...(raw.sync ?? {}),
    },
  }
}

function normalizeTask(value: Partial<Task>, now: string): Task {
  const allowedStatuses: TaskStatus[] = ['active', 'completed', 'archived', 'deleted']
  const status = value.status && allowedStatuses.includes(value.status) ? value.status : 'active'
  return {
    ...value,
    id: value.id ?? crypto.randomUUID(),
    title: value.title?.trim() || 'Без названия',
    description: value.description ?? '',
    projectId: value.projectId ?? 'inbox',
    urgencyThresholdHours: Number(value.urgencyThresholdHours) || 72,
    importance: value.importance === 'high' ? 'high' : 'low',
    tags: Array.isArray(value.tags) ? value.tags : [],
    subtasks: Array.isArray(value.subtasks) ? value.subtasks : [],
    attachments: Array.isArray(value.attachments) ? value.attachments : [],
    reminders: Array.isArray(value.reminders) ? value.reminders : [],
    status,
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? now,
    focusMinutes: Number(value.focusMinutes) || 0,
  }
}

function normalizeProject(value: Partial<Project>, now: string): Project {
  return {
    ...value,
    id: value.id ?? crypto.randomUUID(),
    name: value.name?.trim() || 'Новый проект',
    color: value.color ?? '#778c70',
    createdAt: value.createdAt ?? now,
  }
}

function normalizeHabit(value: Partial<Habit>): Habit {
  const legacyIcons: Record<string, string> = {
    '✨': 'sparkles',
    '💧': 'water',
    '📚': 'book',
    '🌿': 'nature',
    '🏃': 'activity',
    '🧘': 'mindfulness',
    '🥗': 'nutrition',
    '😴': 'sleep',
    '🎯': 'target',
    '☀️': 'sun',
  }
  return {
    ...value,
    id: value.id ?? crypto.randomUUID(),
    name: value.name?.trim() || 'Новая привычка',
    icon: legacyIcons[value.icon ?? ''] ?? value.icon ?? 'sparkles',
    targetDays: Array.isArray(value.targetDays) ? value.targetDays : [1, 2, 3, 4, 5],
    completions: Array.isArray(value.completions) ? value.completions : [],
    color: value.color ?? '#778c70',
  }
}

function normalizeFilter(value: Partial<SavedFilter>, now: string): SavedFilter {
  return {
    id: value.id ?? crypto.randomUUID(),
    name: value.name?.trim() || 'Сохранённый фильтр',
    query: value.query ?? '',
    projectId: value.projectId,
    tags: Array.isArray(value.tags) ? value.tags : [],
    tagMode: value.tagMode === 'all' ? 'all' : 'any',
    importance: value.importance,
    urgency: value.urgency,
    status: value.status === 'completed' || value.status === 'all' ? value.status : 'active',
    createdAt: value.createdAt ?? now,
  }
}
