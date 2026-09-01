export type Importance = 'low' | 'high'
export type Urgency = 'low' | 'high'
export type TaskStatus = 'active' | 'completed' | 'archived' | 'deleted'
export type InboxView = 'list' | 'board'
export type InboxSort = 'created-desc' | 'deadline-asc' | 'importance-desc' | 'title-asc'
export type BackgroundPreset = 'none' | 'mist' | 'dawn' | 'forest' | 'custom'
export type AppFontFamily = 'system' | 'humanist' | 'readable'
export type AppFontScale = 90 | 100 | 110 | 120

export const DEFAULT_URGENCY_THRESHOLD_HOURS = 72
export const DEFAULT_PLANNED_DURATION_MINUTES = 60
export const MAX_PLANNED_DURATION_MINUTES = 24 * 60

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
  allDayDate?: string
  startAt?: string
  plannedDurationMinutes?: number
  deadline?: string
  urgencyThresholdOverrideHours?: number
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
  urgencyThresholdHours: number
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
  createdAt: string
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  accent: 'sage' | 'violet' | 'coral'
  fontFamily: AppFontFamily
  fontScale: AppFontScale
  compactMode: boolean
  reduceMotion: boolean
  autoSync: boolean
  defaultUrgencyThresholdHours: number
  syncProvider: string
  syncProviderConfigs: Record<string, Record<string, string>>
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
  status: 'idle' | 'connecting' | 'syncing' | 'success' | 'error' | 'conflict'
  connectionStatus: 'disconnected' | 'connected' | 'authorization-required'
  connectionMode?: 'implicit' | 'interactive'
  providerId?: string
  lastSyncedAt?: string
  remoteId?: string
  remoteRevision?: string
  lastSyncedHash?: string
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

export function getEffectiveUrgencyThreshold(task: Task, projectThreshold?: number): number {
  const taskOverride = task.urgencyThresholdOverrideHours
  if (typeof taskOverride === 'number' && Number.isFinite(taskOverride) && taskOverride > 0) {
    return taskOverride
  }
  if (typeof projectThreshold === 'number' && Number.isFinite(projectThreshold) && projectThreshold > 0) {
    return projectThreshold
  }
  return DEFAULT_URGENCY_THRESHOLD_HOURS
}

export function getTaskTiming(
  task: Task,
  now = new Date(),
  projectThreshold?: number,
): { urgency: Urgency } {
  const parsedDeadline = task.deadline ? Date.parse(task.deadline) : Number.NaN
  const deadlineAt = Number.isFinite(parsedDeadline) ? parsedDeadline : undefined
  const nowAt = now.getTime()
  const urgencyThresholdHours = getEffectiveUrgencyThreshold(task, projectThreshold)
  const urgency = deadlineAt === undefined
    ? 'low'
    : task.urgencyOverride
      ?? ((deadlineAt - nowAt) / 3_600_000 <= urgencyThresholdHours ? 'high' : 'low')
  return { urgency }
}

export function getTaskUrgency(task: Task, now = new Date(), projectThreshold?: number): Urgency {
  return getTaskTiming(task, now, projectThreshold).urgency
}

/**
 * User-visible urgency is a deadline-only signal. The effective low urgency is
 * still used by filters and the Eisenhower matrix, but it is not a task badge.
 */
export function getTaskUrgencySignal(
  task: Task,
  now = new Date(),
  projectThreshold?: number,
): 'high' | undefined {
  if (task.status !== 'active') return undefined
  const parsedDeadline = task.deadline ? Date.parse(task.deadline) : Number.NaN
  if (!Number.isFinite(parsedDeadline)) return undefined
  return getTaskUrgency(task, now, projectThreshold) === 'high' ? 'high' : undefined
}

export function isSameLocalDay(value: string | undefined, date = new Date()): boolean {
  if (!value) return false
  const candidate = new Date(value)
  return candidate.getFullYear() === date.getFullYear()
    && candidate.getMonth() === date.getMonth()
    && candidate.getDate() === date.getDate()
}
