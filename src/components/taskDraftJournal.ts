import {
  DEFAULT_PLANNED_DURATION_MINUTES,
  MAX_PLANNED_DURATION_MINUTES,
  type Importance,
  type Reminder,
  type Subtask,
  type Urgency,
} from '../domain/models'
import { clearTaskDraftStorage, taskDraftStorageKey } from '../core/storage/TaskDraftStorage'

export const TASK_DRAFT_DEBOUNCE_MS = 600
export const TASK_DRAFT_MAX_BYTES = 128 * 1024
export const TASK_DRAFT_MAX_REMINDERS = 5
export const TASK_DRAFT_MAX_SUBTASKS = 10_000

const MAX_ID_LENGTH = 1_000
const MAX_TITLE_LENGTH = 10_000
const MAX_DESCRIPTION_LENGTH = 100_000
const MAX_TAGS_LENGTH = 20_000

export interface TaskDraftData {
  title: string
  description: string
  projectId: string
  startAt: string
  deadline: string
  plannedDurationMinutes: number | ''
  importance: Importance
  urgencyThresholdOverrideHours: number | ''
  urgencyOverride: Urgency | ''
  tags: string
  subtasks: Subtask[]
  pendingSubtaskTitle: string
  reminders: Reminder[]
}

interface StoredTaskDraft {
  version: 1 | 2 | 3
  taskId?: string
  baseTaskUpdatedAt?: string
  updatedAt: string
  writeId: string
  revision: number
  data: TaskDraftData
}

export interface TaskDraftToken {
  key: string
  writeId: string
  revision: number
}

export interface LoadedTaskDraft {
  data: TaskDraftData
  updatedAt: string
  savedTaskChanged: boolean
  token: TaskDraftToken
}

export type TaskDraftWriteResult =
  | { status: 'saved'; token: TaskDraftToken }
  | { status: 'invalid' | 'too-large' | 'unavailable' }

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isLocalDateTime(value: unknown): value is string {
  if (value === '') return true
  if (typeof value !== 'string' || value.length > 32) return false
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return false
  const candidate = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  )
  return candidate.getFullYear() === Number(match[1])
    && candidate.getMonth() === Number(match[2]) - 1
    && candidate.getDate() === Number(match[3])
    && candidate.getHours() === Number(match[4])
    && candidate.getMinutes() === Number(match[5])
}

function isBoundedString(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit
}

function normalizeSubtask(value: unknown): Subtask | null {
  if (!isRecord(value)
    || !isBoundedString(value.id, MAX_ID_LENGTH)
    || !isBoundedString(value.title, MAX_TITLE_LENGTH)
    || typeof value.completed !== 'boolean') return null
  return { id: value.id, title: value.title, completed: value.completed }
}

function normalizeReminder(value: unknown): Reminder | null {
  if (!isRecord(value) || !isBoundedString(value.id, MAX_ID_LENGTH) || !isIsoDate(value.at)) return null
  return { id: value.id, at: value.at }
}

function normalizeTaskDraftFields(
  value: Record<string, unknown>,
  urgencyThresholdOverrideHours: number | '',
  plannedDurationMinutes: number | '',
): TaskDraftData | null {
  try {
    if (!isBoundedString(value.title, MAX_TITLE_LENGTH)
      || !isBoundedString(value.description, MAX_DESCRIPTION_LENGTH)
      || !isBoundedString(value.projectId, MAX_ID_LENGTH)
      || !isLocalDateTime(value.startAt)
      || !isLocalDateTime(value.deadline)
      || (value.importance !== 'low' && value.importance !== 'high')
      || (value.urgencyOverride !== '' && value.urgencyOverride !== 'low' && value.urgencyOverride !== 'high')
      || !isBoundedString(value.tags, MAX_TAGS_LENGTH)
      || !Array.isArray(value.subtasks)
      || value.subtasks.length > TASK_DRAFT_MAX_SUBTASKS
      || !isBoundedString(value.pendingSubtaskTitle, MAX_TITLE_LENGTH)
      || !Array.isArray(value.reminders)
      || value.reminders.length > TASK_DRAFT_MAX_REMINDERS) return null

    const subtasks = value.subtasks.map(normalizeSubtask)
    const reminders = value.reminders.map(normalizeReminder)
    if (subtasks.some((item) => item === null) || reminders.some((item) => item === null)) return null
    const hasDeadline = value.deadline !== ''
    return {
      title: value.title,
      description: value.description,
      projectId: value.projectId,
      startAt: value.startAt,
      deadline: value.deadline,
      plannedDurationMinutes,
      importance: value.importance,
      urgencyThresholdOverrideHours: hasDeadline ? urgencyThresholdOverrideHours : '',
      urgencyOverride: hasDeadline ? value.urgencyOverride : '',
      tags: value.tags,
      subtasks: subtasks as Subtask[],
      pendingSubtaskTitle: value.pendingSubtaskTitle,
      reminders: reminders as Reminder[],
    }
  } catch {
    return null
  }
}

/** Returns an exact, fixed-depth copy and intentionally drops unknown fields. */
export function normalizeTaskDraftData(value: unknown): TaskDraftData | null {
  if (!isRecord(value)) return null
  const threshold = value.urgencyThresholdOverrideHours
  if (threshold !== '' && (
    typeof threshold !== 'number'
    || !Number.isFinite(threshold)
    || threshold <= 0
  )) return null
  const plannedDurationMinutes = value.plannedDurationMinutes
  if (plannedDurationMinutes !== '' && (
    typeof plannedDurationMinutes !== 'number'
    || !Number.isInteger(plannedDurationMinutes)
    || plannedDurationMinutes < 1
    || plannedDurationMinutes > 1_440
  )) return null
  return normalizeTaskDraftFields(value, threshold, plannedDurationMinutes)
}

function inferLegacyDraftDuration(startAt: unknown, deadline: unknown) {
  if (!isLocalDateTime(startAt) || startAt === '') return DEFAULT_PLANNED_DURATION_MINUTES

  const start = new Date(startAt)
  const nextLocalMidnight = new Date(start)
  nextLocalMidnight.setHours(24, 0, 0, 0)
  const minutesUntilMidnight = Math.floor((nextLocalMidnight.getTime() - start.getTime()) / 60_000)
  const fallback = Math.max(
    1,
    Math.min(DEFAULT_PLANNED_DURATION_MINUTES, minutesUntilMidnight),
  )
  if (!isLocalDateTime(deadline) || deadline === '') return fallback

  const end = new Date(deadline)
  const duration = (end.getTime() - start.getTime()) / 60_000
  return Number.isInteger(duration)
    && duration >= 1
    && duration <= MAX_PLANNED_DURATION_MINUTES
    && end.getTime() <= nextLocalMidnight.getTime()
    ? duration
    : fallback
}

function normalizeLegacyTaskDraftData(value: unknown): TaskDraftData | null {
  if (!isRecord(value)
    || typeof value.urgencyThresholdHours !== 'number'
    || !Number.isFinite(value.urgencyThresholdHours)
    || value.urgencyThresholdHours <= 0) return null
  // Version 1 stored the effective threshold on every task, so preserving it
  // as an individual override is the only lossless mapping.
  return normalizeTaskDraftFields(
    value,
    value.urgencyThresholdHours,
    inferLegacyDraftDuration(value.startAt, value.deadline),
  )
}

function normalizeVersion2TaskDraftData(value: unknown): TaskDraftData | null {
  if (!isRecord(value)) return null
  const threshold = value.urgencyThresholdOverrideHours
  if (threshold !== '' && (
    typeof threshold !== 'number'
    || !Number.isFinite(threshold)
    || threshold <= 0
  )) return null
  return normalizeTaskDraftFields(
    value,
    threshold,
    inferLegacyDraftDuration(value.startAt, value.deadline),
  )
}

function normalizeStoredTaskDraft(value: unknown, taskId: string | undefined): StoredTaskDraft | null {
  if (!isRecord(value)
    || (value.version !== 1 && value.version !== 2 && value.version !== 3)
    || value.taskId !== taskId
    || (taskId ? !isIsoDate(value.baseTaskUpdatedAt) : value.baseTaskUpdatedAt !== undefined)
    || !isIsoDate(value.updatedAt)
    || !isBoundedString(value.writeId, 200)
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1) return null
  const version = value.version
  const data = version === 1
    ? normalizeLegacyTaskDraftData(value.data)
    : version === 2
      ? normalizeVersion2TaskDraftData(value.data)
      : normalizeTaskDraftData(value.data)
  if (!data) return null
  return {
    version,
    taskId,
    baseTaskUpdatedAt: value.baseTaskUpdatedAt as string | undefined,
    updatedAt: value.updatedAt,
    writeId: value.writeId,
    revision: value.revision as number,
    data,
  }
}

function safelyRemove(storage: Storage, key: string) {
  try {
    storage.removeItem(key)
  } catch {
    // A blocked or full storage must not make the task editor unusable.
  }
}

function readRaw(storage: Storage, key: string) {
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    if (byteLength(raw) > TASK_DRAFT_MAX_BYTES) return undefined
    return raw
  } catch {
    return undefined
  }
}

function nextRevision(storage: Storage, key: string) {
  const raw = readRaw(storage, key)
  if (!raw) return 1
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || !Number.isSafeInteger(parsed.revision)) return 1
    const revision = parsed.revision as number
    return revision >= 1 && revision < Number.MAX_SAFE_INTEGER ? revision + 1 : 1
  } catch {
    return 1
  }
}

export function getTaskDraftStorageKey(taskId?: string) {
  return taskDraftStorageKey(taskId)
}

export function taskDraftsEqual(left: TaskDraftData, right: TaskDraftData) {
  const normalizedLeft = normalizeTaskDraftData(left)
  const normalizedRight = normalizeTaskDraftData(right)
  if (!normalizedLeft || !normalizedRight) return false
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
}

export function readTaskDraft(taskId?: string, currentTaskUpdatedAt?: string): LoadedTaskDraft | null {
  const storage = storageOrNull()
  if (!storage) return null
  const key = getTaskDraftStorageKey(taskId)
  const raw = readRaw(storage, key)
  if (raw === null) return null
  if (raw === undefined) {
    safelyRemove(storage, key)
    return null
  }

  try {
    const parsed = normalizeStoredTaskDraft(JSON.parse(raw), taskId)
    if (!parsed) {
      safelyRemove(storage, key)
      return null
    }
    const currentUpdatedAt = currentTaskUpdatedAt ? Date.parse(currentTaskUpdatedAt) : Number.NaN
    const draftUpdatedAt = Date.parse(parsed.updatedAt)
    if (Number.isFinite(currentUpdatedAt) && draftUpdatedAt <= currentUpdatedAt) {
      safelyRemove(storage, key)
      return null
    }
    return {
      data: parsed.data,
      updatedAt: parsed.updatedAt,
      savedTaskChanged: Boolean(
        currentTaskUpdatedAt
        && parsed.baseTaskUpdatedAt
        && parsed.baseTaskUpdatedAt !== currentTaskUpdatedAt,
      ),
      token: { key, writeId: parsed.writeId, revision: parsed.revision },
    }
  } catch {
    safelyRemove(storage, key)
    return null
  }
}

export function writeTaskDraft(
  data: TaskDraftData,
  taskId?: string,
  baseTaskUpdatedAt?: string,
  now = Date.now(),
): TaskDraftWriteResult {
  const storage = storageOrNull()
  if (!storage) return { status: 'unavailable' }
  const normalized = normalizeTaskDraftData(data)
  if (!normalized
    || (taskId !== undefined && (!isBoundedString(taskId, MAX_ID_LENGTH) || !isIsoDate(baseTaskUpdatedAt)))
    || (taskId === undefined && baseTaskUpdatedAt !== undefined)) return { status: 'invalid' }

  const key = getTaskDraftStorageKey(taskId)
  const baseTimestamp = baseTaskUpdatedAt ? Date.parse(baseTaskUpdatedAt) : Number.NaN
  const safeNow = Number.isFinite(now) ? now : Date.now()
  const token: TaskDraftToken = {
    key,
    writeId: crypto.randomUUID(),
    revision: nextRevision(storage, key),
  }
  const draft: StoredTaskDraft = {
    version: 3,
    taskId,
    baseTaskUpdatedAt,
    updatedAt: new Date(Math.max(safeNow, Number.isFinite(baseTimestamp) ? baseTimestamp + 1 : safeNow)).toISOString(),
    writeId: token.writeId,
    revision: token.revision,
    data: normalized,
  }
  const serialized = JSON.stringify(draft)
  if (byteLength(serialized) > TASK_DRAFT_MAX_BYTES) return { status: 'too-large' }
  try {
    storage.setItem(key, serialized)
    return { status: 'saved', token }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Removes only the exact journal revision observed by the caller. */
export function clearTaskDraftIfMatches(token: TaskDraftToken) {
  const storage = storageOrNull()
  if (!storage) return false
  const raw = readRaw(storage, token.key)
  if (!raw) return false
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.writeId !== token.writeId || parsed.revision !== token.revision) return false
    storage.removeItem(token.key)
    return true
  } catch {
    return false
  }
}

export function clearTaskDraft(taskId?: string) {
  clearTaskDraftStorage(taskId)
}
