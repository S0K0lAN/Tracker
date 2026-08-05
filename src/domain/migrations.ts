import type { AppState, Habit, Project, SavedFilter, Task, TaskStatus } from './models'
import { createSeedState } from './seed'
import { attachmentDataUrlMimeType, MAX_ATTACHMENT_BYTES, safeAttachmentDataUrl } from './attachments'

export const CURRENT_SCHEMA_VERSION = 3

const FONT_FAMILIES = ['system', 'humanist', 'readable'] as const
const FONT_SCALES = [90, 100, 110, 120] as const

export class UnsupportedSchemaVersionError extends Error {
  constructor(readonly schemaVersion: number) {
    super(`Snapshot schema ${schemaVersion} is newer than supported schema ${CURRENT_SCHEMA_VERSION}`)
    this.name = 'UnsupportedSchemaVersionError'
  }
}

export function parseStoredAppState(input: unknown): AppState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Snapshot must be an object')
  }
  const raw = input as Record<string, unknown>
  if (!Number.isSafeInteger(raw.schemaVersion) || (raw.schemaVersion as number) < 1) {
    throw new Error('Snapshot schema version is invalid')
  }
  if ((raw.schemaVersion as number) > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(raw.schemaVersion as number)
  }
  const schemaVersion = raw.schemaVersion as number
  assertSnapshotStateShape(raw, schemaVersion, { requireSync: true, requireLocalSettings: true })
  return normalizeAppState(input)
}

interface SnapshotShapeOptions {
  requireSync?: boolean
  requireLocalSettings?: boolean
}

export function assertSnapshotStateShape(
  raw: Record<string, unknown>,
  schemaVersion: number,
  options: SnapshotShapeOptions = {},
): void {
  const strict = schemaVersion >= 2
  const tasks = recordArray(raw, 'tasks', true)
  const projects = recordArray(raw, 'projects', true)
  const habits = recordArray(raw, 'habits', true)
  const savedFilters = recordArray(raw, 'savedFilters', strict)

  tasks.forEach((task, index) => assertTaskShape(task, strict, `tasks[${index}]`))
  projects.forEach((project, index) => assertProjectShape(project, strict, `projects[${index}]`))
  habits.forEach((habit, index) => assertHabitShape(habit, strict, `habits[${index}]`))
  savedFilters.forEach((filter, index) => assertFilterShape(filter, strict, `savedFilters[${index}]`))

  const pomodoro = recordField(raw, 'pomodoro', strict)
  if (pomodoro) assertPomodoroShape(pomodoro, strict, 'pomodoro')
  const settings = recordField(raw, 'settings', true)
  if (settings) {
    assertSettingsShape(
      settings,
      strict,
      Boolean(options.requireLocalSettings),
      schemaVersion >= 3,
      'settings',
    )
  }
  const sync = recordField(raw, 'sync', Boolean(options.requireSync) && strict)
  if (sync) assertSyncShape(sync, strict, 'sync')
}

function assertTaskShape(task: Record<string, unknown>, strict: boolean, path: string) {
  for (const key of ['id', 'title', 'description', 'projectId', 'createdAt', 'updatedAt'] as const) {
    stringField(task, key, strict, path)
  }
  for (const key of ['startAt', 'deadline', 'completedAt', 'archivedAt', 'deletedAt'] as const) {
    stringField(task, key, false, path)
  }
  numberField(task, 'urgencyThresholdHours', strict, path, (value) => value >= 0)
  numberField(task, 'focusMinutes', strict, path, (value) => value >= 0)
  enumField(task, 'importance', ['low', 'high'], strict, path)
  enumField(task, 'urgencyOverride', ['low', 'high'], false, path)
  enumField(task, 'status', ['active', 'completed', 'archived', 'deleted'], strict, path)
  enumField(task, 'previousStatus', ['active', 'completed', 'archived'], false, path)

  stringArray(task, 'tags', strict, path)
  const subtasks = recordArray(task, 'subtasks', strict, path)
  subtasks.forEach((subtask, index) => {
    const itemPath = `${path}.subtasks[${index}]`
    stringField(subtask, 'id', true, itemPath)
    stringField(subtask, 'title', true, itemPath)
    booleanField(subtask, 'completed', true, itemPath)
  })
  const attachments = recordArray(task, 'attachments', strict, path)
  if (attachments.length > 5) throw invalidField(`${path}.attachments`)
  attachments.forEach((attachment, index) => {
    const itemPath = `${path}.attachments[${index}]`
    stringField(attachment, 'id', true, itemPath)
    stringField(attachment, 'name', true, itemPath)
    stringField(attachment, 'type', true, itemPath)
    numberField(attachment, 'size', true, itemPath, (value) => value >= 0 && value <= MAX_ATTACHMENT_BYTES)
    if ('dataUrl' in attachment && attachment.dataUrl !== undefined) {
      const encodedMimeType = attachmentDataUrlMimeType(attachment.dataUrl)
      const declaredMimeType = typeof attachment.type === 'string' ? attachment.type.trim().toLowerCase() : ''
      if (!encodedMimeType || (declaredMimeType && !safeAttachmentDataUrl(attachment.dataUrl, declaredMimeType))) {
        throw invalidField(`${itemPath}.dataUrl`)
      }
    }
  })
  const reminders = recordArray(task, 'reminders', strict, path)
  if (reminders.length > 5) throw invalidField(`${path}.reminders`)
  reminders.forEach((reminder, index) => {
    const itemPath = `${path}.reminders[${index}]`
    stringField(reminder, 'id', true, itemPath)
    stringField(reminder, 'at', true, itemPath)
  })
}

function assertProjectShape(project: Record<string, unknown>, strict: boolean, path: string) {
  for (const key of ['id', 'name', 'color', 'createdAt'] as const) stringField(project, key, strict, path)
  stringField(project, 'description', false, path)
}

function assertHabitShape(habit: Record<string, unknown>, strict: boolean, path: string) {
  for (const key of ['id', 'name', 'icon', 'color'] as const) stringField(habit, key, strict, path)
  stringField(habit, 'description', false, path)
  numberArray(habit, 'targetDays', strict, path, (value) => Number.isInteger(value) && value >= 0 && value <= 6)
  stringArray(habit, 'completions', strict, path)
}

function assertFilterShape(filter: Record<string, unknown>, strict: boolean, path: string) {
  for (const key of ['id', 'name', 'query', 'createdAt'] as const) stringField(filter, key, strict, path)
  stringField(filter, 'projectId', false, path)
  stringArray(filter, 'tags', strict, path)
  enumField(filter, 'tagMode', ['any', 'all'], strict, path)
  enumField(filter, 'importance', ['low', 'high'], false, path)
  enumField(filter, 'urgency', ['low', 'high'], false, path)
  enumField(filter, 'status', ['active', 'completed', 'all'], strict, path)
}

function assertPomodoroShape(pomodoro: Record<string, unknown>, strict: boolean, path: string) {
  stringField(pomodoro, 'taskId', false, path)
  stringField(pomodoro, 'runningSince', false, path)
  enumField(pomodoro, 'mode', ['focus', 'short-break', 'long-break'], strict, path)
  for (const key of ['durationSeconds', 'remainingSeconds', 'completedFocusSessions'] as const) {
    numberField(pomodoro, key, strict, path, (value) => value >= 0)
  }
}

function assertSettingsShape(
  settings: Record<string, unknown>,
  strict: boolean,
  requireLocal: boolean,
  requireTypography: boolean,
  path: string,
) {
  enumField(settings, 'theme', ['light', 'dark', 'system'], strict, path)
  enumField(settings, 'accent', ['sage', 'violet', 'coral'], strict, path)
  enumField(settings, 'fontFamily', FONT_FAMILIES, requireTypography, path)
  numberField(settings, 'fontScale', requireTypography, path, (value) => FONT_SCALES.includes(value as typeof FONT_SCALES[number]))
  enumField(settings, 'inboxView', ['list', 'board', 'calendar'], strict, path)
  enumField(settings, 'inboxSort', ['created-desc', 'deadline-asc', 'importance-desc', 'title-asc'], strict, path)
  enumField(settings, 'backgroundPreset', ['none', 'mist', 'dawn', 'forest', 'custom'], strict, path)
  for (const key of ['compactMode', 'reduceMotion'] as const) booleanField(settings, key, strict, path)
  numberField(settings, 'defaultUrgencyThresholdHours', strict, path, (value) => value >= 0)
  numberField(settings, 'backgroundDim', strict, path, (value) => value >= 0 && value <= 100)
  stringField(settings, 'customBackgroundDataUrl', false, path)

  booleanField(settings, 'autoSync', requireLocal && strict, path)
  stringField(settings, 'syncProvider', requireLocal && strict, path)
  if ('syncProviderConfigs' in settings) {
    const configs = settings.syncProviderConfigs
    if (!isRecord(configs)) throw invalidField(`${path}.syncProviderConfigs`)
    for (const [providerId, config] of Object.entries(configs)) {
      if (!providerId || !isRecord(config) || Object.values(config).some((value) => typeof value !== 'string')) {
        throw invalidField(`${path}.syncProviderConfigs`)
      }
    }
  }
}

function assertSyncShape(sync: Record<string, unknown>, strict: boolean, path: string) {
  enumField(sync, 'status', ['idle', 'connecting', 'syncing', 'success', 'error', 'conflict'], strict, path)
  enumField(sync, 'connectionStatus', ['disconnected', 'connected', 'authorization-required'], false, path)
  enumField(sync, 'connectionMode', ['implicit', 'interactive'], false, path)
  for (const key of ['providerId', 'lastSyncedAt', 'remoteId', 'remoteRevision', 'lastSyncedHash', 'message'] as const) {
    stringField(sync, key, false, path)
  }
}

function recordArray(record: Record<string, unknown>, key: string, required: boolean, parent = 'Snapshot'): Record<string, unknown>[] {
  const value = record[key]
  if (value === undefined && !required) return []
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) throw invalidField(`${parent}.${key}`)
  return value as Record<string, unknown>[]
}

function recordField(record: Record<string, unknown>, key: string, required: boolean): Record<string, unknown> | undefined {
  const value = record[key]
  if (value === undefined && !required) return undefined
  if (!isRecord(value)) throw invalidField(key)
  return value
}

function stringField(record: Record<string, unknown>, key: string, required: boolean, path: string) {
  const value = record[key]
  if (value === undefined && !required) return
  if (typeof value !== 'string') throw invalidField(`${path}.${key}`)
}

function booleanField(record: Record<string, unknown>, key: string, required: boolean, path: string) {
  const value = record[key]
  if (value === undefined && !required) return
  if (typeof value !== 'boolean') throw invalidField(`${path}.${key}`)
}

function numberField(
  record: Record<string, unknown>,
  key: string,
  required: boolean,
  path: string,
  predicate: (value: number) => boolean,
) {
  const value = record[key]
  if (value === undefined && !required) return
  if (typeof value !== 'number' || !Number.isFinite(value) || !predicate(value)) throw invalidField(`${path}.${key}`)
}

function enumField(record: Record<string, unknown>, key: string, values: readonly string[], required: boolean, path: string) {
  const value = record[key]
  if (value === undefined && !required) return
  if (typeof value !== 'string' || !values.includes(value)) throw invalidField(`${path}.${key}`)
}

function stringArray(record: Record<string, unknown>, key: string, required: boolean, path: string) {
  const value = record[key]
  if (value === undefined && !required) return
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw invalidField(`${path}.${key}`)
}

function numberArray(
  record: Record<string, unknown>,
  key: string,
  required: boolean,
  path: string,
  predicate: (value: number) => boolean,
) {
  const value = record[key]
  if (value === undefined && !required) return
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !predicate(item))) {
    throw invalidField(`${path}.${key}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidField(path: string) {
  return new Error(`Snapshot field ${path} is invalid`)
}

export function normalizeAppState(input: unknown): AppState {
  const seed = createSeedState()
  if (!input || typeof input !== 'object') return seed
  const raw = input as Partial<AppState>
  if (raw.schemaVersion !== undefined) {
    if (!Number.isSafeInteger(raw.schemaVersion) || raw.schemaVersion < 1) {
      throw new Error('Snapshot schema version is invalid')
    }
    if (raw.schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new UnsupportedSchemaVersionError(raw.schemaVersion)
    }
  }
  const rawSettings = raw.settings as (Partial<AppState['settings']> & { inboxView?: string; googleDriveClientId?: string }) | undefined
  const providerId = typeof rawSettings?.syncProvider === 'string' ? rawSettings.syncProvider : seed.settings.syncProvider
  const syncProviderConfigs = normalizeProviderConfigs(rawSettings?.syncProviderConfigs)
  if (rawSettings?.googleDriveClientId?.trim() && !syncProviderConfigs['google-drive']?.clientId) {
    syncProviderConfigs['google-drive'] = { clientId: rawSettings.googleDriveClientId.trim() }
  }
  const rawSync = raw.sync as Partial<AppState['sync']> | undefined
  const allowedSyncStatuses: AppState['sync']['status'][] = ['idle', 'connecting', 'syncing', 'success', 'error', 'conflict']
  const persistedStatus = rawSync?.status && allowedSyncStatuses.includes(rawSync.status) ? rawSync.status : 'idle'
  const normalizedStatus = persistedStatus === 'connecting' || persistedStatus === 'syncing' || persistedStatus === 'conflict'
    ? 'idle'
    : persistedStatus
  const allowedConnectionStatuses: AppState['sync']['connectionStatus'][] = ['disconnected', 'connected', 'authorization-required']
  const persistedConnectionStatus = rawSync?.connectionStatus && allowedConnectionStatuses.includes(rawSync.connectionStatus)
    ? rawSync.connectionStatus
    : 'disconnected'
  const connectionMode = rawSync?.connectionMode === 'implicit' || rawSync?.connectionMode === 'interactive'
    ? rawSync.connectionMode
    : providerId === 'demo'
      ? 'implicit'
      : providerId === 'google-drive'
        ? 'interactive'
        : undefined
  const connectionStatus = connectionMode === 'implicit'
    ? 'connected'
    : connectionMode === 'interactive' && persistedConnectionStatus !== 'disconnected'
      ? 'authorization-required'
      : persistedConnectionStatus
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
    settings: (() => {
      const settings: AppState['settings'] & { googleDriveClientId?: string } = {
        ...seed.settings,
        ...(rawSettings ?? {}),
        fontFamily: FONT_FAMILIES.includes(rawSettings?.fontFamily as typeof FONT_FAMILIES[number])
          ? rawSettings?.fontFamily as AppState['settings']['fontFamily']
          : seed.settings.fontFamily,
        fontScale: FONT_SCALES.includes(rawSettings?.fontScale as typeof FONT_SCALES[number])
          ? rawSettings?.fontScale as AppState['settings']['fontScale']
          : seed.settings.fontScale,
        syncProvider: providerId,
        syncProviderConfigs,
        inboxView: rawSettings?.inboxView === 'board' ? 'board' : 'list',
      }
      delete settings.googleDriveClientId
      return settings
    })(),
    sync: (() => {
      const normalized = {
        ...seed.sync,
        ...(rawSync ?? {}),
        status: normalizedStatus,
        connectionStatus,
        connectionMode,
        providerId,
        message: normalizedStatus === persistedStatus ? rawSync?.message : undefined,
      } as AppState['sync'] & Record<string, unknown>
      for (const key of ['accessToken', 'refreshToken', 'token', 'clientSecret']) delete normalized[key]
      return normalized
    })(),
  }
}

function normalizeProviderConfigs(value: unknown): Record<string, Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([providerId, rawConfig]) => {
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return []
    const config = Object.fromEntries(Object.entries(rawConfig).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !isSensitiveConfigKey(entry[0]),
    ))
    return [[providerId, config]]
  }))
}

function isSensitiveConfigKey(key: string) {
  return /(access.?token|refresh.?token|auth.?token|id.?token|(^|[-_])token|secret|password|api.?key|credential|bearer|authorization|private.?key)/i.test(key)
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
    attachments: Array.isArray(value.attachments) ? value.attachments.map(normalizeAttachment) : [],
    reminders: Array.isArray(value.reminders) ? value.reminders : [],
    status,
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? now,
    focusMinutes: Number(value.focusMinutes) || 0,
  }
}

function normalizeAttachment(value: Task['attachments'][number]): Task['attachments'][number] {
  return {
    ...value,
    type: value.type?.trim() || attachmentDataUrlMimeType(value.dataUrl) || 'application/octet-stream',
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
    ...value,
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
