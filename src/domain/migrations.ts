import { DEFAULT_URGENCY_THRESHOLD_HOURS } from './models'
import type { AppState, Habit, Project, SavedFilter, Task, TaskStatus } from './models'
import { createSeedState } from './seed'
import { attachmentDataUrlMimeType, MAX_ATTACHMENT_BYTES, safeAttachmentDataUrl } from './attachments'
import { safeCustomBackgroundDataUrl } from './backgrounds'

export const CURRENT_SCHEMA_VERSION = 5

const MAX_PAYLOAD_STRING_BYTES = 10 * 1024 * 1024
// Per-field and known-user-text budgets must not pre-empt a historical v4
// snapshot that fits the existing 10 MiB transport envelope. The stricter
// aggregate below also counts every JSON string value and object key.
const MAX_KNOWN_USER_TEXT_BYTES = MAX_PAYLOAD_STRING_BYTES
const MAX_SNAPSHOT_NODES = 300_000

export const SNAPSHOT_LIMITS = {
  tasks: MAX_SNAPSHOT_NODES,
  projects: MAX_SNAPSHOT_NODES,
  habits: MAX_SNAPSHOT_NODES,
  savedFilters: MAX_SNAPSHOT_NODES,
  subtasksPerTask: MAX_SNAPSHOT_NODES,
  tagsPerEntity: MAX_SNAPSHOT_NODES,
  habitCompletions: MAX_SNAPSHOT_NODES,
  syncProviders: MAX_SNAPSHOT_NODES,
  syncProviderFields: MAX_SNAPSHOT_NODES,
  identifierBytes: 64 * 1024,
  shortTextBytes: MAX_KNOWN_USER_TEXT_BYTES,
  longTextBytes: MAX_KNOWN_USER_TEXT_BYTES,
  queryBytes: MAX_KNOWN_USER_TEXT_BYTES,
  tagBytes: MAX_KNOWN_USER_TEXT_BYTES,
  configValueBytes: MAX_KNOWN_USER_TEXT_BYTES,
  userTextBytes: MAX_KNOWN_USER_TEXT_BYTES,
  totalStringBytes: MAX_PAYLOAD_STRING_BYTES,
  totalNodes: MAX_SNAPSHOT_NODES,
  maxDepth: 64,
} as const

const FONT_FAMILIES = ['system', 'humanist', 'readable'] as const
const FONT_SCALES = [90, 100, 110, 120] as const
const DEFAULT_ENTITY_COLOR = '#778c70'
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const UTF8_ENCODER = new TextEncoder()

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

export function assertCurrentAppState(state: AppState): void {
  if (state.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Snapshot schema must be ${CURRENT_SCHEMA_VERSION} before export`)
  }
  assertSnapshotStateShape(state as unknown as Record<string, unknown>, CURRENT_SCHEMA_VERSION, {
    requireSync: true,
    requireLocalSettings: true,
  })
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
  const strictSanitizableValues = schemaVersion >= 4
  const budget: SnapshotValidationBudget = { userTextBytes: 0 }
  const tasks = recordArray(raw, 'tasks', true, 'Snapshot', SNAPSHOT_LIMITS.tasks)
  const projects = recordArray(raw, 'projects', true, 'Snapshot', SNAPSHOT_LIMITS.projects)
  const habits = recordArray(raw, 'habits', true, 'Snapshot', SNAPSHOT_LIMITS.habits)
  const savedFilters = recordArray(raw, 'savedFilters', strict, 'Snapshot', SNAPSHOT_LIMITS.savedFilters)
  if (!strictSanitizableValues
    && projects.length === SNAPSHOT_LIMITS.projects
    && !projects.some((project) => project.id === 'inbox')
  ) {
    throw invalidField('Snapshot.projects')
  }
  assertSnapshotComplexity(raw)

  tasks.forEach((task, index) => assertTaskShape(
    task,
    strict,
    strictSanitizableValues,
    schemaVersion >= 5,
    budget,
    `tasks[${index}]`,
  ))
  projects.forEach((project, index) => assertProjectShape(
    project,
    strict,
    strictSanitizableValues,
    schemaVersion >= 5,
    budget,
    `projects[${index}]`,
  ))
  habits.forEach((habit, index) => assertHabitShape(habit, strict, strictSanitizableValues, budget, `habits[${index}]`))
  savedFilters.forEach((filter, index) => assertFilterShape(filter, strict, strictSanitizableValues, budget, `savedFilters[${index}]`))

  const pomodoro = recordField(raw, 'pomodoro', strict)
  if (pomodoro) assertPomodoroShape(pomodoro, strict, strictSanitizableValues, 'pomodoro')
  // v4 declared these relationships canonical, so corruption is rejected and
  // can be quarantined. Older schemas are repaired below without dropping an
  // otherwise valid entity.
  if (strictSanitizableValues) assertEntityIntegrity(tasks, projects, habits, savedFilters, pomodoro)
  const settings = recordField(raw, 'settings', true)
  if (settings) {
    assertSettingsShape(
      settings,
      strict,
      Boolean(options.requireLocalSettings),
      schemaVersion >= 3,
      strictSanitizableValues,
      budget,
      'settings',
    )
  }
  const sync = recordField(raw, 'sync', Boolean(options.requireSync) && strict)
  if (sync) assertSyncShape(sync, strict, budget, 'sync')
}

interface SnapshotValidationBudget {
  userTextBytes: number
}

function assertTaskShape(
  task: Record<string, unknown>,
  strict: boolean,
  strictSanitizableValues: boolean,
  useProjectUrgencyThresholds: boolean,
  budget: SnapshotValidationBudget,
  path: string,
) {
  identifierField(task, 'id', strict, path, strictSanitizableValues)
  userTextField(task, 'title', strict, path, budget, SNAPSHOT_LIMITS.shortTextBytes)
  userTextField(task, 'description', strict, path, budget, SNAPSHOT_LIMITS.longTextBytes)
  identifierField(task, 'projectId', strict, path, strictSanitizableValues)
  for (const key of ['createdAt', 'updatedAt'] as const) {
    dateStringField(task, key, strict, path, strictSanitizableValues)
  }
  for (const key of ['startAt', 'deadline', 'completedAt', 'archivedAt', 'deletedAt'] as const) {
    dateStringField(task, key, false, path, strictSanitizableValues)
  }
  if (strictSanitizableValues
    && typeof task.startAt === 'string'
    && typeof task.deadline === 'string'
    && Date.parse(task.deadline) < Date.parse(task.startAt)
  ) {
    throw invalidField(`${path}.deadline`)
  }
  if (useProjectUrgencyThresholds) {
    numberField(task, 'urgencyThresholdOverrideHours', false, path, (value) => value > 0)
  } else {
    numberField(task, 'urgencyThresholdHours', strict, path, (value) => !strictSanitizableValues || value > 0)
  }
  numberField(task, 'focusMinutes', strict, path, (value) => value >= 0)
  enumField(task, 'importance', ['low', 'high'], strict, path)
  enumField(task, 'urgencyOverride', ['low', 'high'], false, path)
  enumField(task, 'status', ['active', 'completed', 'archived', 'deleted'], strict, path)
  enumField(task, 'previousStatus', ['active', 'completed', 'archived'], false, path)

  userTextArray(task, 'tags', strict, path, budget, SNAPSHOT_LIMITS.tagsPerEntity, SNAPSHOT_LIMITS.tagBytes)
  const subtasks = recordArray(task, 'subtasks', strict, path, SNAPSHOT_LIMITS.subtasksPerTask)
  subtasks.forEach((subtask, index) => {
    const itemPath = `${path}.subtasks[${index}]`
    identifierField(subtask, 'id', true, itemPath, false)
    userTextField(subtask, 'title', true, itemPath, budget, SNAPSHOT_LIMITS.shortTextBytes)
    booleanField(subtask, 'completed', true, itemPath)
  })
  const attachments = recordArray(task, 'attachments', strict, path)
  if (attachments.length > 5) throw invalidField(`${path}.attachments`)
  attachments.forEach((attachment, index) => {
    const itemPath = `${path}.attachments[${index}]`
    identifierField(attachment, 'id', true, itemPath, false)
    userTextField(attachment, 'name', true, itemPath, budget, SNAPSHOT_LIMITS.shortTextBytes)
    boundedStringField(attachment, 'type', true, itemPath, SNAPSHOT_LIMITS.identifierBytes)
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
    identifierField(reminder, 'id', true, itemPath, false)
    dateStringField(reminder, 'at', true, itemPath, strictSanitizableValues)
  })
}

function assertProjectShape(
  project: Record<string, unknown>,
  strict: boolean,
  strictSanitizableValues: boolean,
  requireUrgencyThreshold: boolean,
  budget: SnapshotValidationBudget,
  path: string,
) {
  identifierField(project, 'id', strict, path, strictSanitizableValues)
  userTextField(project, 'name', strict, path, budget, SNAPSHOT_LIMITS.shortTextBytes)
  boundedStringField(project, 'createdAt', strict, path, SNAPSHOT_LIMITS.identifierBytes)
  colorField(project, 'color', strict, path, strictSanitizableValues)
  numberField(project, 'urgencyThresholdHours', requireUrgencyThreshold, path, (value) => value > 0)
  userTextField(project, 'description', false, path, budget, SNAPSHOT_LIMITS.longTextBytes)
}

function assertHabitShape(
  habit: Record<string, unknown>,
  strict: boolean,
  strictSanitizableValues: boolean,
  budget: SnapshotValidationBudget,
  path: string,
) {
  identifierField(habit, 'id', strict, path, strictSanitizableValues)
  userTextField(habit, 'name', strict, path, budget, SNAPSHOT_LIMITS.shortTextBytes)
  boundedStringField(habit, 'icon', strict, path, SNAPSHOT_LIMITS.identifierBytes)
  colorField(habit, 'color', strict, path, strictSanitizableValues)
  userTextField(habit, 'description', false, path, budget, SNAPSHOT_LIMITS.longTextBytes)
  numberArray(
    habit,
    'targetDays',
    strict,
    path,
    (value) => Number.isInteger(value) && value >= 0 && value <= 6,
  )
  boundedStringArray(
    habit,
    'completions',
    strict,
    path,
    SNAPSHOT_LIMITS.habitCompletions,
    SNAPSHOT_LIMITS.identifierBytes,
  )
}

function assertFilterShape(
  filter: Record<string, unknown>,
  strict: boolean,
  strictSanitizableValues: boolean,
  budget: SnapshotValidationBudget,
  path: string,
) {
  identifierField(filter, 'id', strict, path, strictSanitizableValues)
  userTextField(filter, 'name', strict, path, budget, SNAPSHOT_LIMITS.shortTextBytes)
  userTextField(filter, 'query', strict, path, budget, SNAPSHOT_LIMITS.queryBytes)
  boundedStringField(filter, 'createdAt', strict, path, SNAPSHOT_LIMITS.identifierBytes)
  identifierField(filter, 'projectId', false, path, false)
  userTextArray(filter, 'tags', strict, path, budget, SNAPSHOT_LIMITS.tagsPerEntity, SNAPSHOT_LIMITS.tagBytes)
  enumField(filter, 'tagMode', ['any', 'all'], strict, path)
  enumField(filter, 'importance', ['low', 'high'], false, path)
  enumField(filter, 'urgency', ['low', 'high'], false, path)
  enumField(filter, 'status', ['active', 'completed', 'all'], strict, path)
}

function assertPomodoroShape(
  pomodoro: Record<string, unknown>,
  strict: boolean,
  strictSanitizableValues: boolean,
  path: string,
) {
  identifierField(pomodoro, 'taskId', false, path, false)
  dateStringField(pomodoro, 'runningSince', false, path, strictSanitizableValues)
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
  strictSanitizableValues: boolean,
  budget: SnapshotValidationBudget,
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
  numberField(
    settings,
    'defaultUrgencyThresholdHours',
    strict,
    path,
    (value) => !strictSanitizableValues || value > 0,
  )
  numberField(settings, 'backgroundDim', strict, path, (value) => value >= 0 && value <= 100)
  boundedStringField(
    settings,
    'customBackgroundDataUrl',
    false,
    path,
    SNAPSHOT_LIMITS.totalStringBytes,
  )
  if ('customBackgroundDataUrl' in settings
    && settings.customBackgroundDataUrl !== undefined
    && !safeCustomBackgroundDataUrl(settings.customBackgroundDataUrl)) {
    throw invalidField(`${path}.customBackgroundDataUrl`)
  }

  booleanField(settings, 'autoSync', requireLocal && strict, path)
  boundedStringField(
    settings,
    'syncProvider',
    requireLocal && strict,
    path,
    SNAPSHOT_LIMITS.identifierBytes,
    false,
  )
  if ('syncProviderConfigs' in settings) {
    const configs = settings.syncProviderConfigs
    if (!isRecord(configs)) throw invalidField(`${path}.syncProviderConfigs`)
    if (Object.keys(configs).length > SNAPSHOT_LIMITS.syncProviders) throw invalidField(`${path}.syncProviderConfigs`)
    for (const [providerId, config] of Object.entries(configs)) {
      if (!providerId
        || utf8ByteLength(providerId) > SNAPSHOT_LIMITS.identifierBytes
        || !isRecord(config)
        || Object.keys(config).length > SNAPSHOT_LIMITS.syncProviderFields
      ) {
        throw invalidField(`${path}.syncProviderConfigs`)
      }
      for (const [configKey, value] of Object.entries(config)) {
        if (!configKey
          || utf8ByteLength(configKey) > SNAPSHOT_LIMITS.identifierBytes
          || typeof value !== 'string'
          || utf8ByteLength(value) > SNAPSHOT_LIMITS.configValueBytes
        ) {
          throw invalidField(`${path}.syncProviderConfigs`)
        }
        addUserText(budget, value, `${path}.syncProviderConfigs`)
      }
    }
  }
}

function assertSyncShape(
  sync: Record<string, unknown>,
  strict: boolean,
  budget: SnapshotValidationBudget,
  path: string,
) {
  enumField(sync, 'status', ['idle', 'connecting', 'syncing', 'success', 'error', 'conflict'], strict, path)
  enumField(sync, 'connectionStatus', ['disconnected', 'connected', 'authorization-required'], false, path)
  enumField(sync, 'connectionMode', ['implicit', 'interactive'], false, path)
  for (const key of ['providerId', 'lastSyncedAt', 'remoteId', 'remoteRevision', 'lastSyncedHash'] as const) {
    boundedStringField(sync, key, false, path, SNAPSHOT_LIMITS.identifierBytes)
  }
  userTextField(sync, 'message', false, path, budget, SNAPSHOT_LIMITS.shortTextBytes)
}

function recordArray(
  record: Record<string, unknown>,
  key: string,
  required: boolean,
  parent = 'Snapshot',
  maxItems?: number,
): Record<string, unknown>[] {
  const value = record[key]
  if (value === undefined && !required) return []
  if (!Array.isArray(value)) throw invalidField(`${parent}.${key}`)
  if (maxItems !== undefined && value.length > maxItems) throw invalidField(`${parent}.${key}`)
  if (value.some((item) => !isRecord(item))) throw invalidField(`${parent}.${key}`)
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

function boundedStringField(
  record: Record<string, unknown>,
  key: string,
  required: boolean,
  path: string,
  maxBytes: number,
  requireNonBlank = false,
) {
  stringField(record, key, required, path)
  const value = record[key]
  if (value === undefined && !required) return
  if (typeof value !== 'string'
    || utf8ByteLength(value) > maxBytes
    || (requireNonBlank && !value.trim())
  ) {
    throw invalidField(`${path}.${key}`)
  }
}

function identifierField(
  record: Record<string, unknown>,
  key: string,
  required: boolean,
  path: string,
  requireNonBlank: boolean,
) {
  boundedStringField(record, key, required, path, SNAPSHOT_LIMITS.identifierBytes, requireNonBlank)
}

function userTextField(
  record: Record<string, unknown>,
  key: string,
  required: boolean,
  path: string,
  budget: SnapshotValidationBudget,
  maxBytes: number,
) {
  boundedStringField(record, key, required, path, maxBytes)
  const value = record[key]
  if (typeof value === 'string') addUserText(budget, value, `${path}.${key}`)
}

function dateStringField(
  record: Record<string, unknown>,
  key: string,
  required: boolean,
  path: string,
  requireParseable = true,
) {
  const value = record[key]
  if (value === undefined && !required) return
  if (typeof value !== 'string' || (requireParseable && !isParseableDate(value))) throw invalidField(`${path}.${key}`)
}

function colorField(
  record: Record<string, unknown>,
  key: string,
  required: boolean,
  path: string,
  requireSafeColor = true,
) {
  const value = record[key]
  if (value === undefined && !required) return
  if (typeof value !== 'string' || (requireSafeColor && !isSafeHexColor(value))) throw invalidField(`${path}.${key}`)
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

function boundedStringArray(
  record: Record<string, unknown>,
  key: string,
  required: boolean,
  path: string,
  maxItems: number,
  maxItemBytes: number,
) {
  const value = record[key]
  if (value === undefined && !required) return
  if (!Array.isArray(value)
    || value.length > maxItems
    || value.some((item) => typeof item !== 'string' || utf8ByteLength(item) > maxItemBytes)
  ) {
    throw invalidField(`${path}.${key}`)
  }
}

function userTextArray(
  record: Record<string, unknown>,
  key: string,
  required: boolean,
  path: string,
  budget: SnapshotValidationBudget,
  maxItems: number,
  maxItemBytes: number,
) {
  boundedStringArray(record, key, required, path, maxItems, maxItemBytes)
  const value = record[key]
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === 'string') addUserText(budget, item, `${path}.${key}`)
    })
  }
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

function addUserText(budget: SnapshotValidationBudget, value: string, path: string) {
  budget.userTextBytes += utf8ByteLength(value)
  if (budget.userTextBytes > SNAPSHOT_LIMITS.userTextBytes) throw invalidField(path)
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength
}

function assertSnapshotComplexity(raw: Record<string, unknown>) {
  interface TraversalFrame {
    value: object
    children: readonly unknown[]
    index: number
    depth: number
  }

  const ancestors = new WeakSet<object>()
  const stack: TraversalFrame[] = []
  let nodeCount = 0
  let stringBytes = 0

  const addString = (value: string) => {
    stringBytes += utf8ByteLength(value)
    if (stringBytes > SNAPSHOT_LIMITS.totalStringBytes) throw invalidField('Snapshot.stringData')
  }

  const enter = (value: object, depth: number) => {
    if (depth > SNAPSHOT_LIMITS.maxDepth) throw invalidField('Snapshot.depth')
    if (ancestors.has(value)) throw invalidField('Snapshot.circularReference')
    ancestors.add(value)
    nodeCount += 1
    if (nodeCount > SNAPSHOT_LIMITS.totalNodes) throw invalidField('Snapshot.complexity')

    if (Array.isArray(value)) {
      if (value.length > SNAPSHOT_LIMITS.totalNodes) throw invalidField('Snapshot.complexity')
      stack.push({ value, children: value, index: 0, depth })
      return
    }

    const entries = Object.entries(value)
    entries.forEach(([key]) => addString(key))
    stack.push({ value, children: entries.map(([, item]) => item), index: 0, depth })
  }

  enter(raw, 0)
  while (stack.length) {
    const frame = stack.at(-1)!
    if (frame.index >= frame.children.length) {
      ancestors.delete(frame.value)
      stack.pop()
      continue
    }

    const value = frame.children[frame.index]
    frame.index += 1
    if (typeof value === 'string') {
      addString(value)
      continue
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw invalidField('Snapshot.jsonValue')
    }
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
      throw invalidField('Snapshot.jsonValue')
    }
    if (!value || typeof value !== 'object') {
      continue
    }
    enter(value, frame.depth + 1)
  }
}

function assertEntityIntegrity(
  tasks: Record<string, unknown>[],
  projects: Record<string, unknown>[],
  habits: Record<string, unknown>[],
  savedFilters: Record<string, unknown>[],
  pomodoro?: Record<string, unknown>,
) {
  assertUniqueIds(tasks, 'tasks')
  assertUniqueIds(projects, 'projects')
  assertUniqueIds(habits, 'habits')
  assertUniqueIds(savedFilters, 'savedFilters')

  const projectIds = new Set(projects.map((project) => project.id as string))
  if (!projectIds.has('inbox')) throw invalidField('projects.inbox')
  tasks.forEach((task, index) => {
    if (!projectIds.has(task.projectId as string)) throw invalidField(`tasks[${index}].projectId`)
  })
  savedFilters.forEach((filter, index) => {
    if (filter.projectId !== undefined && !projectIds.has(filter.projectId as string)) {
      throw invalidField(`savedFilters[${index}].projectId`)
    }
  })

  const taskIds = new Set(tasks.map((task) => task.id as string))
  if (pomodoro?.taskId !== undefined && !taskIds.has(pomodoro.taskId as string)) {
    throw invalidField('pomodoro.taskId')
  }
}

function assertUniqueIds(entities: Record<string, unknown>[], path: string) {
  const ids = new Set<string>()
  entities.forEach((entity, index) => {
    const id = entity.id as string
    if (ids.has(id)) throw invalidField(`${path}[${index}].id`)
    ids.add(id)
  })
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
  const sourceSchemaVersion = raw.schemaVersion ?? CURRENT_SCHEMA_VERSION
  const legacyProjectUrgencyThreshold = positiveNumber(
    rawSettings?.defaultUrgencyThresholdHours,
    DEFAULT_URGENCY_THRESHOLD_HOURS,
  )
  const providerId = typeof rawSettings?.syncProvider === 'string' ? rawSettings.syncProvider : seed.settings.syncProvider
  const syncProviderConfigs = normalizeProviderConfigs(rawSettings?.syncProviderConfigs)
  const googleDriveConfig = syncProviderConfigs['google-drive']
  if (googleDriveConfig?.clientId !== undefined) {
    const remainingConfig = { ...googleDriveConfig }
    delete remainingConfig.clientId
    if (Object.keys(remainingConfig).length) syncProviderConfigs['google-drive'] = remainingConfig
    else delete syncProviderConfigs['google-drive']
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
  const normalizedProjects = ensureUniqueEntityIds(
    Array.isArray(raw.projects)
      ? raw.projects.map((project) => normalizeProject(
        project,
        now,
        sourceSchemaVersion,
        legacyProjectUrgencyThreshold,
      ))
      : seed.projects,
    'project',
  )
  if (!normalizedProjects.some((project) => project.id === 'inbox')) {
    normalizedProjects.unshift({
      id: 'inbox',
      name: 'Без проекта',
      color: '#9ca89c',
      urgencyThresholdHours: legacyProjectUrgencyThreshold,
      createdAt: '1970-01-01T00:00:00.000Z',
    })
  }
  const projectIds = new Set(normalizedProjects.map((project) => project.id))
  const normalizedTasks = ensureUniqueEntityIds(
    Array.isArray(raw.tasks)
      ? raw.tasks.map((task) => normalizeTask(task, now, sourceSchemaVersion))
      : seed.tasks,
    'task',
  ).map((task) => projectIds.has(task.projectId) ? task : { ...task, projectId: 'inbox' })
  const normalizedHabits = ensureUniqueEntityIds(
    Array.isArray(raw.habits) ? raw.habits.map(normalizeHabit) : seed.habits,
    'habit',
  )
  const normalizedFilters = ensureUniqueEntityIds(
    Array.isArray(raw.savedFilters) ? raw.savedFilters.map((filter) => normalizeFilter(filter, now)) : [],
    'filter',
  ).map((filter) => filter.projectId === undefined || projectIds.has(filter.projectId)
    ? filter
    : { ...filter, projectId: undefined })
  const taskIds = new Set(normalizedTasks.map((task) => task.id))
  const candidatePomodoro = normalizePomodoro(raw.pomodoro, seed.pomodoro)
  const normalizedPomodoro = candidatePomodoro.taskId === undefined || taskIds.has(candidatePomodoro.taskId)
    ? candidatePomodoro
    : { ...candidatePomodoro, taskId: undefined }

  return {
    ...seed,
    ...raw,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tasks: normalizedTasks,
    projects: normalizedProjects,
    habits: normalizedHabits,
    savedFilters: normalizedFilters,
    pomodoro: normalizedPomodoro,
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
        defaultUrgencyThresholdHours: positiveNumber(
          rawSettings?.defaultUrgencyThresholdHours,
          seed.settings.defaultUrgencyThresholdHours,
        ),
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

function normalizePomodoro(value: unknown, fallback: AppState['pomodoro']): AppState['pomodoro'] {
  const raw = isRecord(value) ? value : {}
  const mode = raw.mode === 'short-break' || raw.mode === 'long-break' ? raw.mode : 'focus'
  return {
    ...fallback,
    ...raw,
    taskId: typeof raw.taskId === 'string' ? raw.taskId : undefined,
    mode,
    durationSeconds: nonNegativeNumber(raw.durationSeconds, fallback.durationSeconds),
    remainingSeconds: nonNegativeNumber(raw.remainingSeconds, fallback.remainingSeconds),
    runningSince: normalizedDate(raw.runningSince),
    completedFocusSessions: nonNegativeNumber(raw.completedFocusSessions, fallback.completedFocusSessions),
  }
}

function isSensitiveConfigKey(key: string) {
  return /(access.?token|refresh.?token|auth.?token|id.?token|(^|[-_])token|secret|password|api.?key|credential|bearer|authorization|private.?key)/i.test(key)
}

type LegacyTaskInput = Partial<Task> & { urgencyThresholdHours?: unknown }

function normalizeTask(value: LegacyTaskInput, now: string, sourceSchemaVersion: number): Task {
  const allowedStatuses: TaskStatus[] = ['active', 'completed', 'archived', 'deleted']
  const status = value.status && allowedStatuses.includes(value.status) ? value.status : 'active'
  const startAt = normalizedDate(value.startAt)
  const candidateDeadline = normalizedDate(value.deadline)
  const deadline = candidateDeadline && (!startAt || Date.parse(candidateDeadline) >= Date.parse(startAt))
    ? candidateDeadline
    : undefined
  const {
    urgencyThresholdHours: legacyUrgencyThresholdHours,
    urgencyThresholdOverrideHours,
    ...preservedValue
  } = value
  const normalizedThresholdOverride = sourceSchemaVersion < 5
    ? positiveNumber(legacyUrgencyThresholdHours, DEFAULT_URGENCY_THRESHOLD_HOURS)
    : optionalPositiveNumber(urgencyThresholdOverrideHours)
  return {
    ...preservedValue,
    id: typeof value.id === 'string' ? value.id : '',
    title: value.title?.trim() || 'Без названия',
    description: value.description ?? '',
    projectId: value.projectId ?? 'inbox',
    startAt,
    deadline,
    ...(normalizedThresholdOverride === undefined
      ? {}
      : { urgencyThresholdOverrideHours: normalizedThresholdOverride }),
    importance: value.importance === 'high' ? 'high' : 'low',
    tags: Array.isArray(value.tags) ? value.tags : [],
    subtasks: Array.isArray(value.subtasks) ? value.subtasks : [],
    attachments: Array.isArray(value.attachments) ? value.attachments.map(normalizeAttachment) : [],
    reminders: Array.isArray(value.reminders)
      ? value.reminders.flatMap((reminder) => {
        const normalized = normalizeReminder(reminder)
        return normalized ? [normalized] : []
      })
      : [],
    status,
    createdAt: normalizedDate(value.createdAt) ?? now,
    updatedAt: normalizedDate(value.updatedAt) ?? now,
    completedAt: normalizedDate(value.completedAt),
    archivedAt: normalizedDate(value.archivedAt),
    deletedAt: normalizedDate(value.deletedAt),
    focusMinutes: Number(value.focusMinutes) || 0,
  }
}

function normalizeReminder(value: unknown): Task['reminders'][number] | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined
  const at = normalizedDate(value.at)
  return at ? { ...value, id: value.id, at } : undefined
}

function normalizeAttachment(value: Task['attachments'][number]): Task['attachments'][number] {
  return {
    ...value,
    type: value.type?.trim() || attachmentDataUrlMimeType(value.dataUrl) || 'application/octet-stream',
  }
}

function normalizeProject(
  value: Partial<Project>,
  now: string,
  sourceSchemaVersion: number,
  legacyUrgencyThreshold: number,
): Project {
  return {
    ...value,
    id: typeof value.id === 'string' ? value.id : '',
    name: value.name?.trim() || 'Новый проект',
    color: safeColor(value.color, DEFAULT_ENTITY_COLOR),
    urgencyThresholdHours: sourceSchemaVersion < 5
      ? legacyUrgencyThreshold
      : positiveNumber(value.urgencyThresholdHours, DEFAULT_URGENCY_THRESHOLD_HOURS),
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
    id: typeof value.id === 'string' ? value.id : '',
    name: value.name?.trim() || 'Новая привычка',
    icon: legacyIcons[value.icon ?? ''] ?? value.icon ?? 'sparkles',
    targetDays: Array.isArray(value.targetDays) ? value.targetDays : [1, 2, 3, 4, 5],
    completions: Array.isArray(value.completions) ? value.completions : [],
    color: safeColor(value.color, DEFAULT_ENTITY_COLOR),
  }
}

function normalizeFilter(value: Partial<SavedFilter>, now: string): SavedFilter {
  return {
    ...value,
    id: typeof value.id === 'string' ? value.id : '',
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

function ensureUniqueEntityIds<T extends { id: string }>(entities: T[], prefix: string): T[] {
  // Preserve the first occurrence of every historical ID. Generated IDs avoid
  // both already-used and later original IDs, making repeated migrations stable.
  const reserved = new Set(entities.flatMap((entity) => entity.id.trim() ? [entity.id] : []))
  const used = new Set<string>()
  return entities.map((entity, index) => {
    const originalId = entity.id.trim() ? entity.id : undefined
    if (originalId && !used.has(originalId)) {
      used.add(originalId)
      return entity
    }

    const base = `migrated-${prefix}-${index + 1}`
    let candidate = base
    let suffix = 2
    while (used.has(candidate) || reserved.has(candidate)) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    used.add(candidate)
    return { ...entity, id: candidate }
  })
}

function isParseableDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function normalizedDate(value: unknown): string | undefined {
  return isParseableDate(value) ? value : undefined
}

function isSafeHexColor(value: unknown): value is string {
  return typeof value === 'string' && value.length === 7 && HEX_COLOR_PATTERN.test(value)
}

function safeColor(value: unknown, fallback: string): string {
  return isSafeHexColor(value) ? value : fallback
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}
