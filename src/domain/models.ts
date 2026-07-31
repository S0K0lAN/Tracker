export type Importance = 'low' | 'high'
export type Urgency = 'low' | 'high'
export type TaskStatus = 'active' | 'completed' | 'archived' | 'deleted'
export type InboxView = 'list' | 'board' | 'calendar'
export type InboxSort = 'created-desc' | 'deadline-asc' | 'importance-desc' | 'title-asc'
export type BackgroundPreset = 'none' | 'mist' | 'dawn' | 'forest' | 'custom'

export interface Subtask {
  id: string
  title: string
  completed: boolean
}

export interface Attachment {
  id: string
  name: string
  type: string
  size: number
  dataUrl?: string
}

export interface Reminder {
  id: string
  at: string
}

export interface Task {
  id: string
  title: string
  description: string
  projectId: string
  startAt?: string
  deadline?: string
  urgencyThresholdHours: number
  urgencyOverride?: Urgency
  importance: Importance
  tags: string[]
  subtasks: Subtask[]
  attachments: Attachment[]
  reminders: Reminder[]
  status: TaskStatus
  createdAt: string
  updatedAt: string
  completedAt?: string
  archivedAt?: string
  deletedAt?: string
  previousStatus?: Exclude<TaskStatus, 'deleted'>
  focusMinutes: number
}

export interface Project {
  id: string
  name: string
  color: string
  description?: string
  createdAt: string
}

export interface Habit {
  id: string
  name: string
  description?: string
  icon: string
  targetDays: number[]
  completions: string[]
  color: string
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  accent: 'sage' | 'violet' | 'coral'
  compactMode: boolean
  reduceMotion: boolean
  autoSync: boolean
  defaultUrgencyThresholdHours: number
  syncProvider: 'demo' | 'google-drive'
  inboxView: InboxView
  inboxSort: InboxSort
  backgroundPreset: BackgroundPreset
  customBackgroundDataUrl?: string
  backgroundDim: number
}

export interface SavedFilter {
  id: string
  name: string
  query: string
  projectId?: string
  tags: string[]
  tagMode: 'any' | 'all'
  importance?: Importance
  urgency?: Urgency
  status: 'active' | 'completed' | 'all'
  createdAt: string
}

export interface PomodoroState {
  taskId?: string
  mode: 'focus' | 'short-break' | 'long-break'
  durationSeconds: number
  remainingSeconds: number
  runningSince?: string
  completedFocusSessions: number
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'success' | 'error'
  lastSyncedAt?: string
  message?: string
}

export interface AppState {
  schemaVersion: number
  tasks: Task[]
  projects: Project[]
  habits: Habit[]
  savedFilters: SavedFilter[]
  pomodoro: PomodoroState
  settings: AppSettings
  sync: SyncState
}

export function getTaskTiming(task: Task, now = new Date()): { urgency: Urgency; overdue: boolean } {
  const deadlineAt = task.deadline ? Date.parse(task.deadline) : undefined
  const nowAt = now.getTime()
  const urgency = task.urgencyOverride
    ?? (deadlineAt !== undefined && (deadlineAt - nowAt) / 3_600_000 <= task.urgencyThresholdHours ? 'high' : 'low')
  return {
    urgency,
    overdue: Boolean(deadlineAt !== undefined && task.status === 'active' && deadlineAt < nowAt),
  }
}

export function getTaskUrgency(task: Task, now = new Date()): Urgency {
  return getTaskTiming(task, now).urgency
}

export function isOverdue(task: Task, now = new Date()): boolean {
  return getTaskTiming(task, now).overdue
}

export function isSameLocalDay(value: string | undefined, date = new Date()): boolean {
  if (!value) return false
  const candidate = new Date(value)
  return candidate.getFullYear() === date.getFullYear()
    && candidate.getMonth() === date.getMonth()
    && candidate.getDate() === date.getDate()
}
