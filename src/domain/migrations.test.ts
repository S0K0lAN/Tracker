import { afterEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_SCHEMA_VERSION, normalizeAppState, parseStoredAppState, SNAPSHOT_LIMITS } from './migrations'
import type { AppState, SavedFilter, Task } from './models'
import { createSeedState } from './seed'

const savedFilter = (id: string): SavedFilter => ({
  id,
  name: `Фильтр ${id}`,
  query: '',
  tags: [],
  tagMode: 'any',
  status: 'active',
  createdAt: '2026-08-21T00:00:00.000Z',
})

function addDeepPluginState(state: AppState, depth = 10_000) {
  let value: Record<string, unknown> = { leaf: true }
  for (let index = 0; index < depth; index += 1) value = { child: value }
  ;(state as AppState & Record<string, unknown>)['plugin.example/deep'] = value
}

const minimalTask = (index: number): Task => ({
  id: `minimal-task-${index}`,
  title: 't',
  description: '',
  projectId: 'inbox',
  importance: 'low',
  tags: [],
  subtasks: [],
  attachments: [],
  reminders: [],
  status: 'active',
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  plannedDurationMinutes: 60,
  focusMinutes: 0,
})

type PreDurationTask = Omit<Task, 'plannedDurationMinutes' | 'allDayDate'> & {
  plannedDurationMinutes?: number
}

type LegacyTask = Omit<PreDurationTask, 'urgencyThresholdOverrideHours'> & {
  urgencyThresholdHours: number
}

type LegacyProject = Omit<AppState['projects'][number], 'urgencyThresholdHours'>
type LegacyHabit = Omit<AppState['habits'][number], 'createdAt'> & { createdAt?: string }

type LegacyAppState = Omit<AppState, 'tasks' | 'projects' | 'habits'> & {
  tasks: LegacyTask[]
  projects: LegacyProject[]
  habits: LegacyHabit[]
}

function createLegacyState(schemaVersion: 1 | 2 | 3 | 4 = 4): LegacyAppState {
  const current = createSeedState()
  return {
    ...current,
    schemaVersion,
    tasks: current.tasks.map(({ urgencyThresholdOverrideHours, plannedDurationMinutes: _duration, allDayDate: _allDayDate, ...task }) => ({
      ...task,
      urgencyThresholdHours: urgencyThresholdOverrideHours ?? current.settings.defaultUrgencyThresholdHours,
    })),
    projects: current.projects.map(({ urgencyThresholdHours: _urgencyThresholdHours, ...project }) => project),
    habits: current.habits.map(({ createdAt: _createdAt, ...habit }) => habit),
  }
}

function createLegacyV5State() {
  const current = createSeedState()
  return {
    ...current,
    schemaVersion: 5 as const,
    tasks: current.tasks.map(({ plannedDurationMinutes: _duration, allDayDate: _allDayDate, ...task }) => task as PreDurationTask),
    habits: current.habits.map(({ createdAt: _createdAt, ...habit }) => habit as LegacyHabit),
  }
}

function createLegacyV6State() {
  const current = createSeedState()
  return {
    ...current,
    schemaVersion: 6 as const,
    tasks: current.tasks.map(({ plannedDurationMinutes: _duration, allDayDate: _allDayDate, ...task }) => task as PreDurationTask),
    habits: current.habits.map(({ createdAt: _createdAt, ...habit }) => habit as LegacyHabit),
  }
}

function createLegacyV7State() {
  const current = createSeedState()
  return {
    ...current,
    schemaVersion: 7 as const,
    tasks: current.tasks.map(({ allDayDate: _allDayDate, ...task }) => ({
      ...task,
      plannedDurationMinutes: task.plannedDurationMinutes ?? 60,
    })),
    habits: current.habits.map(({ createdAt: _createdAt, ...habit }) => habit as LegacyHabit),
  }
}

function createLegacyV8State() {
  const current = createSeedState()
  return {
    ...current,
    schemaVersion: 8 as const,
    tasks: current.tasks.map(({ allDayDate: _allDayDate, ...task }) => ({
      ...task,
      plannedDurationMinutes: task.plannedDurationMinutes ?? 60,
    })),
  }
}

function createLegacyV9State() {
  const current = createSeedState()
  return {
    ...current,
    schemaVersion: 9 as const,
    tasks: current.tasks.map(({ allDayDate: _allDayDate, ...task }) => task),
  }
}

afterEach(() => vi.useRealTimers())

function currentIntegrityCases(): [string, (state: AppState) => void, RegExp][] {
  return [
    ['duplicate task ID', (state) => state.tasks.push(structuredClone(state.tasks[0])), /tasks\[\d+\]\.id/],
    ['duplicate project ID', (state) => state.projects.push(structuredClone(state.projects[0])), /projects\[\d+\]\.id/],
    ['duplicate habit ID', (state) => state.habits.push(structuredClone(state.habits[0])), /habits\[\d+\]\.id/],
    ['duplicate filter ID', (state) => state.savedFilters.push(savedFilter('same'), savedFilter('same')), /savedFilters\[1\]\.id/],
    ['missing canonical inbox', (state) => {
      state.projects = state.projects.filter((project) => project.id !== 'inbox')
      state.tasks.forEach((task) => {
        if (task.projectId === 'inbox') task.projectId = 'personal'
      })
    }, /projects\.inbox/],
    ['orphan task project', (state) => { state.tasks[0].projectId = 'missing-project' }, /tasks\[0\]\.projectId/],
    ['orphan saved-filter project', (state) => {
      state.savedFilters.push({ ...savedFilter('orphan-filter'), projectId: 'missing-project' })
    }, /savedFilters\[0\]\.projectId/],
    ['orphan Pomodoro task', (state) => { state.pomodoro.taskId = 'missing-task' }, /pomodoro\.taskId/],
    ['too many projects', (state) => {
      state.projects = Array(SNAPSHOT_LIMITS.projects + 1).fill(state.projects[0])
    }, /Snapshot\.projects/],
    ['too many tasks', (state) => {
      state.tasks = Array(SNAPSHOT_LIMITS.tasks + 1).fill(state.tasks[0])
    }, /Snapshot\.tasks/],
    ['too many habits', (state) => {
      state.habits = Array(SNAPSHOT_LIMITS.habits + 1).fill(state.habits[0])
    }, /Snapshot\.habits/],
    ['too many saved filters', (state) => {
      const filter = savedFilter('filter')
      state.savedFilters = Array(SNAPSHOT_LIMITS.savedFilters + 1).fill(filter)
    }, /Snapshot\.savedFilters/],
    ['oversized user field', (state) => {
      state.tasks[0].title = 'x'.repeat(SNAPSHOT_LIMITS.shortTextBytes + 1)
    }, /Snapshot\.stringData/],
    ['cumulative user text', (state) => {
      const description = 'x'.repeat(Math.floor(SNAPSHOT_LIMITS.userTextBytes / 20) + 1)
      state.tasks = []
      state.habits = []
      state.savedFilters = []
      state.projects = [{
        id: 'inbox',
        name: 'Без проекта',
        color: '#778c70',
        urgencyThresholdHours: 72,
        createdAt: '2026-08-21T00:00:00.000Z',
      }, ...Array.from({ length: 20 }, (_, index) => ({
        id: `large-project-${index}`,
        name: `Проект ${index}`,
        description,
        color: '#778c70',
        urgencyThresholdHours: 72,
        createdAt: '2026-08-21T00:00:00.000Z',
      }))]
    }, /Snapshot\.stringData/],
    ['excessive structural complexity', (state) => {
      ;(state as AppState & Record<string, unknown>)['plugin.example/nodes'] = Array(
        SNAPSHOT_LIMITS.totalNodes + 1,
      ).fill(0)
    }, /Snapshot\.complexity/],
    ['excessive nesting depth', (state) => addDeepPluginState(state), /Snapshot\.depth/],
  ]
}

describe('state migrations for simplified navigation and habit icons', () => {
  it('moves the retired inbox calendar view to the list and converts legacy emoji icons', () => {
    const legacy = createSeedState()
    ;(legacy.settings as { inboxView: string }).inboxView = 'calendar'
    legacy.habits[0].icon = '💧'

    const migrated = normalizeAppState(legacy)

    expect(migrated.settings.inboxView).toBe('list')
    expect(migrated.habits[0].icon).toBe('water')
  })

  it('accepts historical schema v2 snapshots that predate provider config and connection metadata', () => {
    const historical = structuredClone(createLegacyState(2)) as unknown as {
      schemaVersion: 2
      settings: Record<string, unknown>
      sync: Record<string, unknown>
      tasks: LegacyTask[]
    }
    historical.settings.inboxView = 'calendar'
    delete historical.settings.syncProviderConfigs
    delete historical.settings.fontFamily
    delete historical.settings.fontScale
    historical.sync = { status: 'idle' }
    const historicalAttachment = historical.tasks.flatMap((task) => task.attachments)[0]
    historicalAttachment.type = ''

    const migrated = parseStoredAppState(historical)

    expect(migrated.settings.inboxView).toBe('list')
    expect(migrated.settings.syncProviderConfigs).toEqual({})
    expect(migrated.settings.fontFamily).toBe('system')
    expect(migrated.settings.fontScale).toBe(100)
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(migrated.tasks.flatMap((task) => task.attachments)[0].type).toBe('image/svg+xml')
    expect(migrated.sync).toMatchObject({
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
    })
  })

  it.each([1, 2, 3, 4, 5, 6, 7] as const)(
    'migrates schema v%s habits with a deterministic conservative creation time',
    (schemaVersion) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2040-05-06T07:08:09.000Z'))
      const legacy = schemaVersion === 7
        ? createLegacyV7State()
        : schemaVersion === 6
          ? createLegacyV6State()
          : schemaVersion === 5
            ? createLegacyV5State()
            : createLegacyState(schemaVersion)
      const completions = [...legacy.habits[0].completions]
      legacy.habits[1].createdAt = '2025-03-30T22:15:00.000Z'

      const migrated = parseStoredAppState(legacy)

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(migrated.habits[0].createdAt).toBe('1970-01-01T00:00:00.000Z')
      expect(migrated.habits[0].completions).toEqual(completions)
      expect(migrated.habits[1].createdAt).toBe('2025-03-30T22:15:00.000Z')
    },
  )

  it('accepts a schema v7 snapshot and removes duration only from deadline tasks', () => {
    const legacy = createLegacyV7State()

    const migrated = parseStoredAppState(legacy)

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(migrated.habits.every((habit) => habit.createdAt === '1970-01-01T00:00:00.000Z')).toBe(true)
    expect(migrated.tasks.every((task) => !task.deadline || task.plannedDurationMinutes === undefined)).toBe(true)
    expect(migrated.tasks.filter((task) => !task.deadline).map((task) => task.plannedDurationMinutes)).toEqual(
      legacy.tasks.filter((task) => !task.deadline).map((task) => task.plannedDurationMinutes),
    )
  })

  it('migrates schema v8 by preserving deadlines and dropping their mandatory durations', () => {
    const legacy = createLegacyV8State()
    const legacyDeadlineTask = legacy.tasks.find((task) => task.deadline)!
    const legacyDurationTask = legacy.tasks.find((task) => !task.deadline && task.plannedDurationMinutes === 90)!

    const migrated = parseStoredAppState(legacy)
    const deadlineTask = migrated.tasks.find((task) => task.id === legacyDeadlineTask.id)!
    const durationTask = migrated.tasks.find((task) => task.id === legacyDurationTask.id)!

    expect(deadlineTask.deadline).toBe(legacyDeadlineTask.deadline)
    expect(deadlineTask).not.toHaveProperty('plannedDurationMinutes')
    expect(durationTask.plannedDurationMinutes).toBe(90)
  })

  it('migrates schema v9 without inventing an all-day date', () => {
    const legacy = createLegacyV9State()

    const migrated = parseStoredAppState(legacy)

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(migrated.tasks.every((task) => task.allDayDate === undefined)).toBe(true)
  })

  it('preserves a legacy deadline-only task without inventing a duration', () => {
    const legacy = createLegacyV6State()
    const deadline = '2026-09-03T12:00:00.000Z'
    legacy.tasks[0].startAt = undefined
    legacy.tasks[0].deadline = deadline

    const migrated = parseStoredAppState(legacy)

    expect(migrated.tasks[0].deadline).toBe(deadline)
    expect(migrated.tasks[0]).not.toHaveProperty('plannedDurationMinutes')
  })

  it('requires a parseable habit creation timestamp in the current schema', () => {
    const missing = createSeedState()
    delete (missing.habits[0] as Partial<AppState['habits'][number]>).createdAt
    const invalid = createSeedState()
    invalid.habits[0].createdAt = 'not-a-date'

    expect(() => parseStoredAppState(missing)).toThrow(/habits\[0\]\.createdAt/)
    expect(() => parseStoredAppState(invalid)).toThrow(/habits\[0\]\.createdAt/)
  })

  it('rejects unsafe typography values in current snapshots', () => {
    const invalidFamily = createSeedState()
    ;(invalidFamily.settings as unknown as Record<string, unknown>).fontFamily = 'url(https://example.com/font.woff2)'
    const invalidScale = createSeedState()
    ;(invalidScale.settings as unknown as Record<string, unknown>).fontScale = 500

    expect(() => parseStoredAppState(invalidFamily)).toThrow(/settings\.fontFamily/)
    expect(() => parseStoredAppState(invalidScale)).toThrow(/settings\.fontScale/)
  })

  it('rejects project and habit colors outside the safe #RRGGBB format', () => {
    const invalidProject = createSeedState()
    invalidProject.projects[0].color = 'color-mix(in srgb, red 50%, url(https://attacker.invalid))'
    const invalidHabit = createSeedState()
    invalidHabit.habits[0].color = '#fff'

    expect(() => parseStoredAppState(invalidProject)).toThrow(/projects\[0\]\.color/)
    expect(() => parseStoredAppState(invalidHabit)).toThrow(/habits\[0\]\.color/)
  })

  it.each([
    'startAt',
    'deadline',
    'createdAt',
    'updatedAt',
    'completedAt',
    'archivedAt',
    'deletedAt',
  ])('rejects an unparseable task %s timestamp', (field) => {
    const invalid = createSeedState()
    ;(invalid.tasks[0] as unknown as Record<string, unknown>)[field] = 'not-a-date'

    expect(() => parseStoredAppState(invalid)).toThrow(new RegExp(`tasks\\[0\\]\\.${field}`))
  })

  it('rejects reminders with invalid timestamps', () => {
    const invalidReminder = createSeedState()
    invalidReminder.tasks[0].reminders[0].at = 'not-a-date'

    expect(() => parseStoredAppState(invalidReminder)).toThrow(/tasks\[0\]\.reminders\[0\]\.at/)
  })

  it('keeps the v7 deadline independent from the scheduled start', () => {
    const current = createSeedState()
    current.tasks[0].startAt = '2026-08-21T12:00:00.000Z'
    current.tasks[0].deadline = '2026-08-21T11:59:59.999Z'

    const parsed = parseStoredAppState(current)

    expect(parsed.tasks[0]).toMatchObject({
      startAt: '2026-08-21T12:00:00.000Z',
      deadline: '2026-08-21T11:59:59.999Z',
    })
  })

  it('keeps the historical start/deadline order validation through schema v6', () => {
    const legacy = createLegacyV6State()
    legacy.tasks[0].startAt = '2026-08-21T12:00:00.000Z'
    legacy.tasks[0].deadline = '2026-08-21T11:59:59.999Z'

    expect(() => parseStoredAppState(legacy)).toThrow(/tasks\[0\]\.deadline/)
  })

  it.each([0, 1.5, 1441])('rejects an invalid current planned duration of %s minutes', (duration) => {
    const invalid = createSeedState()
    invalid.tasks[1].plannedDurationMinutes = duration

    expect(() => parseStoredAppState(invalid)).toThrow(/tasks\[1\]\.plannedDurationMinutes/)
  })

  it('allows an omitted current duration and accepts both inclusive bounds', () => {
    const missing = createSeedState()
    delete (missing.tasks[1] as Partial<Task>).plannedDurationMinutes
    const minimum = createSeedState()
    minimum.tasks[1].plannedDurationMinutes = 1
    const maximum = createSeedState()
    maximum.tasks[1].plannedDurationMinutes = 1440

    expect(parseStoredAppState(missing).tasks[1]).not.toHaveProperty('plannedDurationMinutes')
    expect(parseStoredAppState(minimum).tasks[1].plannedDurationMinutes).toBe(1)
    expect(parseStoredAppState(maximum).tasks[1].plannedDurationMinutes).toBe(1440)
  })

  it('rejects duration and deadline together in the current schema', () => {
    const invalid = createSeedState()
    invalid.tasks[0].plannedDurationMinutes = 60

    expect(() => parseStoredAppState(invalid)).toThrow(/tasks\[0\]\.plannedDurationMinutes/)
  })

  it('accepts a canonical date-only all-day task in the current schema', () => {
    const current = createSeedState()
    current.schemaVersion = CURRENT_SCHEMA_VERSION
    const candidate = current.tasks[0]
    candidate.allDayDate = '2026-09-01'
    candidate.startAt = undefined
    candidate.plannedDurationMinutes = undefined
    candidate.deadline = undefined
    candidate.urgencyThresholdOverrideHours = undefined
    candidate.urgencyOverride = undefined

    const parsed = parseStoredAppState(current)

    expect(parsed.tasks[0].allDayDate).toBe('2026-09-01')
    expect(parsed.tasks[0].startAt).toBeUndefined()
    expect(parsed.tasks[0]).not.toHaveProperty('plannedDurationMinutes')
    expect(parsed.tasks[0].deadline).toBeUndefined()
  })

  it.each([
    ['invalid date', (task: Task) => { task.allDayDate = '2026-02-29' }],
    ['start', (task: Task) => {
      task.allDayDate = '2026-09-01'
      task.startAt = '2026-09-01T09:00:00.000Z'
      task.deadline = undefined
    }],
    ['duration', (task: Task) => {
      task.allDayDate = '2026-09-01'
      task.startAt = undefined
      task.deadline = undefined
      task.plannedDurationMinutes = 60
    }],
    ['deadline', (task: Task) => {
      task.allDayDate = '2026-09-01'
      task.startAt = undefined
      task.plannedDurationMinutes = undefined
      task.deadline = '2026-09-01T18:00:00.000Z'
    }],
    ['urgency override', (task: Task) => {
      task.allDayDate = '2026-09-01'
      task.startAt = undefined
      task.plannedDurationMinutes = undefined
      task.deadline = undefined
      task.urgencyOverride = 'high'
    }],
    ['urgency threshold', (task: Task) => {
      task.allDayDate = '2026-09-01'
      task.startAt = undefined
      task.plannedDurationMinutes = undefined
      task.deadline = undefined
      task.urgencyThresholdOverrideHours = 24
    }],
  ] as const)('rejects an all-day task with %s', (_case, mutate) => {
    const invalid = createSeedState()
    invalid.schemaVersion = CURRENT_SCHEMA_VERSION
    mutate(invalid.tasks[0])

    expect(() => parseStoredAppState(invalid)).toThrow(/tasks\[0\]\.allDayDate/)
  })

  it('repairs conflicting direct input with deadline, then all-day, then timed precedence', () => {
    const deadlineWins = createSeedState()
    deadlineWins.schemaVersion = CURRENT_SCHEMA_VERSION
    deadlineWins.tasks[0].allDayDate = '2026-09-01'
    deadlineWins.tasks[0].plannedDurationMinutes = 90

    const allDayWins = createSeedState()
    allDayWins.schemaVersion = CURRENT_SCHEMA_VERSION
    allDayWins.tasks[1].allDayDate = '2026-09-02'
    allDayWins.tasks[1].startAt = '2026-09-02T09:00:00.000Z'
    allDayWins.tasks[1].plannedDurationMinutes = 60
    allDayWins.tasks[1].deadline = undefined

    const normalizedDeadline = normalizeAppState(deadlineWins).tasks[0]
    const normalizedAllDay = normalizeAppState(allDayWins).tasks[1]

    expect(normalizedDeadline.deadline).toBe(deadlineWins.tasks[0].deadline)
    expect(normalizedDeadline).not.toHaveProperty('allDayDate')
    expect(normalizedDeadline).not.toHaveProperty('plannedDurationMinutes')
    expect(normalizedAllDay).toMatchObject({ allDayDate: '2026-09-02' })
    expect(normalizedAllDay.startAt).toBeUndefined()
    expect(normalizedAllDay).not.toHaveProperty('plannedDurationMinutes')
  })

  it('preserves a same-day v6 deadline without deriving a conflicting duration', () => {
    const legacy = createLegacyV6State()
    const start = new Date(2026, 7, 21, 9, 15)
    const deadline = new Date(2026, 7, 21, 11)
    legacy.tasks[0].startAt = start.toISOString()
    legacy.tasks[0].deadline = deadline.toISOString()

    const migrated = parseStoredAppState(legacy)

    expect(migrated.tasks[0].deadline).toBe(deadline.toISOString())
    expect(migrated.tasks[0]).not.toHaveProperty('plannedDurationMinutes')
  })

  it('uses a same-day duration fallback for legacy tasks without deadlines', () => {
    const legacy = createLegacyV6State()
    const lateStart = new Date(2026, 7, 21, 23, 30)
    legacy.tasks[0].deadline = undefined
    legacy.tasks[0].startAt = new Date(2026, 7, 21, 9).toISOString()
    legacy.tasks[1].deadline = undefined
    legacy.tasks[1].startAt = lateStart.toISOString()
    legacy.tasks[2].deadline = undefined
    legacy.tasks[2].startAt = undefined

    const migrated = parseStoredAppState(legacy)

    expect(migrated.tasks[0].plannedDurationMinutes).toBe(60)
    expect(migrated.tasks[1].plannedDurationMinutes).toBe(30)
    expect(migrated.tasks[2].plannedDurationMinutes).toBe(60)
  })

  it('requires positive project, task override, and default urgency thresholds in schema v5', () => {
    const invalidProjectThreshold = createSeedState()
    invalidProjectThreshold.projects[0].urgencyThresholdHours = 0
    const missingProjectThreshold = createSeedState()
    delete (missingProjectThreshold.projects[0] as Partial<AppState['projects'][number]>).urgencyThresholdHours
    const invalidTaskThresholdOverride = createSeedState()
    invalidTaskThresholdOverride.tasks[0].urgencyThresholdOverrideHours = 0
    const invalidDefaultThreshold = createSeedState()
    invalidDefaultThreshold.settings.defaultUrgencyThresholdHours = -1
    const invalidLegacyTaskThreshold = createLegacyState(4)
    invalidLegacyTaskThreshold.tasks[0].urgencyThresholdHours = 0

    expect(() => parseStoredAppState(invalidProjectThreshold)).toThrow(/projects\[0\]\.urgencyThresholdHours/)
    expect(() => parseStoredAppState(missingProjectThreshold)).toThrow(/projects\[0\]\.urgencyThresholdHours/)
    expect(() => parseStoredAppState(invalidTaskThresholdOverride)).toThrow(
      /tasks\[0\]\.urgencyThresholdOverrideHours/,
    )
    expect(() => parseStoredAppState(invalidDefaultThreshold)).toThrow(/settings\.defaultUrgencyThresholdHours/)
    expect(() => parseStoredAppState(invalidLegacyTaskThreshold)).toThrow(/tasks\[0\]\.urgencyThresholdHours/)
  })

  it('validates the current seed with project thresholds and habit creation timestamps', () => {
    const current = parseStoredAppState(createSeedState())

    expect(current.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(current.projects.every((project) => project.urgencyThresholdHours === 72)).toBe(true)
    expect(current.tasks.every((task) => !('urgencyThresholdHours' in task))).toBe(true)
    expect(current.tasks.every((task) => task.urgencyThresholdOverrideHours === undefined)).toBe(true)
    expect(current.tasks.every((task) => task.plannedDurationMinutes === undefined
      || (Number.isInteger(task.plannedDurationMinutes)
        && task.plannedDurationMinutes >= 1
        && task.plannedDurationMinutes <= 1440))).toBe(true)
    expect(current.tasks.every((task) => !task.deadline || task.plannedDurationMinutes === undefined)).toBe(true)
    expect(current.habits.every((habit) => Number.isFinite(Date.parse(habit.createdAt)))).toBe(true)
  })

  it('removes stale urgency settings from a task without a deadline', () => {
    const current = createSeedState()
    current.tasks[0].deadline = undefined
    current.tasks[0].urgencyThresholdOverrideHours = 24
    current.tasks[0].urgencyOverride = 'high'

    const normalized = parseStoredAppState(current)

    expect(normalized.tasks[0]).not.toHaveProperty('urgencyThresholdOverrideHours')
    expect(normalized.tasks[0]).not.toHaveProperty('urgencyOverride')
  })

  it.each([1, 2, 3, 4] as const)(
    'migrates schema v%s project defaults and task thresholds without changing effective values',
    (schemaVersion) => {
      const legacy = createLegacyState(schemaVersion)
      legacy.settings.defaultUrgencyThresholdHours = 96
      legacy.tasks[0].urgencyThresholdHours = 24
      legacy.tasks[3].urgencyThresholdHours = 120

      const migrated = parseStoredAppState(legacy)

      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(migrated.projects.every((project) => project.urgencyThresholdHours === 96)).toBe(true)
      expect(migrated.tasks[0].urgencyThresholdOverrideHours).toBe(24)
      expect(migrated.tasks[3].urgencyThresholdOverrideHours).toBe(120)
      expect(migrated.tasks[0]).not.toHaveProperty('urgencyThresholdHours')
      expect(migrated.tasks[3]).not.toHaveProperty('urgencyThresholdHours')
    },
  )

  it('preserves the historical 72-hour fallback for missing or invalid v1-v3 task thresholds', () => {
    const legacyV1 = createLegacyState(1)
    const legacyV3 = createLegacyState(3)
    legacyV1.settings.defaultUrgencyThresholdHours = 96
    legacyV3.settings.defaultUrgencyThresholdHours = 96
    delete (legacyV1.tasks[0] as Partial<LegacyTask>).urgencyThresholdHours
    legacyV3.tasks[0].urgencyThresholdHours = 0

    const migratedV1 = parseStoredAppState(legacyV1)
    const migratedV3 = parseStoredAppState(legacyV3)

    expect(migratedV1.projects[0].urgencyThresholdHours).toBe(96)
    expect(migratedV3.projects[0].urgencyThresholdHours).toBe(96)
    expect(migratedV1.tasks[0].urgencyThresholdOverrideHours).toBe(72)
    expect(migratedV3.tasks[0].urgencyThresholdOverrideHours).toBe(72)
  })

  it('sanitizes schema v3 values that became strict in v4 without dropping unrelated data', () => {
    const legacy = createLegacyState(3)
    legacy.tasks[0].title = 'Сохранить эту задачу'
    legacy.tasks[0].description = 'Описание не должно потеряться'
    legacy.tasks[0].tags = ['важные-данные']
    legacy.tasks[0].urgencyThresholdHours = 0
    legacy.tasks[0].createdAt = 'invalid-created-at'
    legacy.tasks[0].updatedAt = 'invalid-updated-at'
    legacy.tasks[0].completedAt = 'invalid-completed-at'
    legacy.tasks[0].reminders = [{ id: 'invalid-reminder', at: 'invalid-reminder-at' }]
    legacy.tasks[1].startAt = '2026-08-21T12:00:00.000Z'
    legacy.tasks[1].deadline = '2026-08-21T11:00:00.000Z'
    legacy.projects[0].color = 'color-mix(in srgb, red 50%, url(https://attacker.invalid))'
    legacy.habits[0].color = '#fff'
    legacy.settings.defaultUrgencyThresholdHours = 0
    legacy.pomodoro.taskId = legacy.tasks[0].id
    legacy.pomodoro.runningSince = 'invalid-running-since'

    const migrated = parseStoredAppState(legacy)

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(migrated.tasks).toHaveLength(legacy.tasks.length)
    expect(migrated.tasks[0]).toMatchObject({
      title: 'Сохранить эту задачу',
      description: 'Описание не должно потеряться',
      tags: ['важные-данные'],
      completedAt: undefined,
      reminders: [],
    })
    expect(migrated.tasks[0]).not.toHaveProperty('urgencyThresholdHours')
    expect(migrated.tasks[0].urgencyThresholdOverrideHours).toBe(72)
    expect(Number.isFinite(Date.parse(migrated.tasks[0].createdAt))).toBe(true)
    expect(Number.isFinite(Date.parse(migrated.tasks[0].updatedAt))).toBe(true)
    expect(migrated.tasks[1]).toMatchObject({
      startAt: '2026-08-21T12:00:00.000Z',
      deadline: '2026-08-21T11:00:00.000Z',
    })
    expect(migrated.tasks[1]).not.toHaveProperty('plannedDurationMinutes')
    expect(migrated.projects[0].color).toBe('#778c70')
    expect(migrated.projects[0].urgencyThresholdHours).toBe(72)
    expect(migrated.habits[0].color).toBe('#778c70')
    expect(migrated.settings.defaultUrgencyThresholdHours).toBe(72)
    expect(migrated.pomodoro).toMatchObject({
      taskId: legacy.tasks[0].id,
      runningSince: undefined,
    })
  })

  it('rejects an unparseable Pomodoro start in current snapshots', () => {
    const invalid = createSeedState()
    invalid.pomodoro.runningSince = 'invalid-running-since'

    expect(() => parseStoredAppState(invalid)).toThrow(/pomodoro\.runningSince/)
  })

  it('uses safe fallbacks when normalizing untrusted values outside strict snapshot parsing', () => {
    const damaged = createSeedState()
    damaged.projects[0].color = 'red; background: url(https://attacker.invalid)'
    damaged.projects[0].urgencyThresholdHours = Number.NaN
    damaged.habits[0].color = '#123'
    damaged.settings.defaultUrgencyThresholdHours = 0
    damaged.tasks[0].urgencyThresholdOverrideHours = Number.NaN
    damaged.tasks[0].createdAt = 'invalid-created-at'
    damaged.tasks[0].updatedAt = 'invalid-updated-at'
    damaged.tasks[0].completedAt = 'invalid-completed-at'
    damaged.tasks[0].startAt = '2026-08-21T12:00:00.000Z'
    damaged.tasks[0].deadline = '2026-08-21T11:00:00.000Z'
    damaged.tasks[0].plannedDurationMinutes = 90
    damaged.tasks[0].reminders = [{ id: 'invalid-reminder', at: 'not-a-date' }]

    const normalized = normalizeAppState(damaged)

    expect(normalized.projects[0].color).toBe('#778c70')
    expect(normalized.projects[0].urgencyThresholdHours).toBe(72)
    expect(normalized.habits[0].color).toBe('#778c70')
    expect(normalized.settings.defaultUrgencyThresholdHours).toBe(72)
    expect(normalized.tasks[0]).not.toHaveProperty('urgencyThresholdHours')
    expect(normalized.tasks[0]).not.toHaveProperty('urgencyThresholdOverrideHours')
    expect(Number.isFinite(Date.parse(normalized.tasks[0].createdAt))).toBe(true)
    expect(Number.isFinite(Date.parse(normalized.tasks[0].updatedAt))).toBe(true)
    expect(normalized.tasks[0]).toMatchObject({
      startAt: '2026-08-21T12:00:00.000Z',
      deadline: '2026-08-21T11:00:00.000Z',
      completedAt: undefined,
      reminders: [],
    })
    expect(normalized.tasks[0]).not.toHaveProperty('plannedDurationMinutes')
  })

  it('keeps the selected provider but requires a fresh browser OAuth session after reload', () => {
    const persisted = createSeedState()
    persisted.settings.syncProvider = 'google-drive'
    persisted.settings.syncProviderConfigs = {
      'google-drive': {
        clientId: 'public-client.apps.googleusercontent.com',
        futureOption: 'preserve-me',
      },
    }
    persisted.settings.autoSync = true
    persisted.sync = {
      status: 'success',
      connectionStatus: 'connected',
      connectionMode: 'interactive',
      providerId: 'google-drive',
      remoteId: 'drive-file',
      remoteRevision: '17',
      lastSyncedHash: 'fnv1a64:1234',
    }

    const migrated = normalizeAppState(persisted)

    expect(migrated.settings.syncProvider).toBe('google-drive')
    expect(migrated.settings.syncProviderConfigs['google-drive']).toEqual({ futureOption: 'preserve-me' })
    expect(migrated.settings.autoSync).toBe(true)
    expect(migrated.sync).toMatchObject({
      status: 'success',
      connectionStatus: 'authorization-required',
      providerId: 'google-drive',
      remoteId: 'drive-file',
      remoteRevision: '17',
    })
  })

  it('does not silently replace a future provider and clears an interrupted runtime status', () => {
    const persisted = createSeedState()
    persisted.settings.syncProvider = 'future-storage'
    persisted.sync = {
      status: 'syncing',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
      providerId: 'future-storage',
    }

    const migrated = normalizeAppState(persisted)

    expect(migrated.settings.syncProvider).toBe('future-storage')
    expect(migrated.sync).toMatchObject({
      status: 'idle',
      connectionStatus: 'connected',
      providerId: 'future-storage',
    })
  })

  it('removes legacy Google Client IDs because OAuth is configured by the build', () => {
    const persisted = createSeedState() as ReturnType<typeof createSeedState> & {
      settings: ReturnType<typeof createSeedState>['settings'] & { googleDriveClientId?: string }
    }
    persisted.settings.googleDriveClientId = 'legacy.apps.googleusercontent.com'

    const migrated = normalizeAppState(persisted)

    expect(migrated.settings.syncProviderConfigs['google-drive']).toBeUndefined()
    expect(migrated.settings).not.toHaveProperty('googleDriveClientId')
  })

  it('does not restore an unusable conflict status without its in-memory candidate', () => {
    const persisted = createSeedState()
    persisted.sync = {
      ...persisted.sync,
      status: 'conflict',
      message: 'Выберите копию',
    }

    const migrated = normalizeAppState(persisted)

    expect(migrated.sync.status).toBe('idle')
    expect(migrated.sync.message).toBeUndefined()
  })

  it('scrubs credential-like legacy fields instead of persisting them again', () => {
    const persisted = createSeedState() as ReturnType<typeof createSeedState> & {
      sync: ReturnType<typeof createSeedState>['sync'] & { accessToken?: string }
    }
    persisted.sync.accessToken = 'legacy-secret-token'
    persisted.settings.syncProviderConfigs = {
      future: {
        endpoint: 'https://safe.example',
        clientSecret: 'must-be-removed',
        authToken: 'must-also-be-removed',
        privateKey: 'must-also-be-removed',
      },
    }

    const migrated = normalizeAppState(persisted)

    expect(migrated.sync).not.toHaveProperty('accessToken')
    expect(migrated.settings.syncProviderConfigs.future).toEqual({ endpoint: 'https://safe.example' })
  })

  it('preserves future namespaced fields on saved filters', () => {
    const persisted = createSeedState()
    persisted.savedFilters.push({
      id: 'future-filter',
      name: 'Расширенный фильтр',
      query: '',
      tags: [],
      tagMode: 'any',
      status: 'active',
      createdAt: new Date().toISOString(),
      ['plugin.example/rule' as keyof never]: { version: 1 },
    })

    const migrated = normalizeAppState(persisted)

    expect(migrated.savedFilters[0]).toHaveProperty('plugin.example/rule', { version: 1 })
  })

  it.each(currentIntegrityCases())('rejects current schema snapshots with %s', (_label, mutate, error) => {
    const invalid = createSeedState()
    mutate(invalid)

    expect(() => parseStoredAppState(invalid)).toThrow(error)
  })

  it('bounds unknown plugin payloads instead of silently removing them', () => {
    const valid = createSeedState() as AppState & Record<string, unknown>
    valid['plugin.example/state'] = {
      version: 1,
      note: 'Сохранить неизвестные данные',
    }

    expect(parseStoredAppState(valid)).toHaveProperty('plugin.example/state', {
      version: 1,
      note: 'Сохранить неизвестные данные',
    })

    const oversized = createSeedState() as AppState & Record<string, unknown>
    oversized['plugin.example/state'] = 'x'.repeat(SNAPSHOT_LIMITS.totalStringBytes + 1)
    expect(() => parseStoredAppState(oversized)).toThrow(/Snapshot\.stringData/)
  })

  it('loads the largest task shape currently accepted by the draft workflow', () => {
    const state = createSeedState()
    state.tasks[0].title = 'я'.repeat(10_000)
    state.tasks[0].description = 'д'.repeat(100_000)
    state.tasks[0].tags = Array.from({ length: 10_000 }, (_, index) => `tag-${index}`)
    state.tasks[0].subtasks = Array.from({ length: 1_000 }, (_, index) => ({
      id: `subtask-${index}`,
      title: `Подзадача ${index}`,
      completed: false,
    }))

    const loaded = parseStoredAppState(state)

    expect(loaded.tasks[0]).toMatchObject({
      title: state.tasks[0].title,
      description: state.tasks[0].description,
    })
    expect(loaded.tasks[0].tags).toHaveLength(10_000)
    expect(loaded.tasks[0].subtasks).toHaveLength(1_000)
  })

  it('keeps a current snapshot with one user field near the 10 MiB transport boundary', () => {
    const state = createSeedState()
    const emptyDescriptionBytes = new TextEncoder().encode(JSON.stringify(state)).byteLength
    state.tasks[0].description = 'x'.repeat(
      SNAPSHOT_LIMITS.totalStringBytes - emptyDescriptionBytes,
    )
    const serialized = JSON.stringify(state)

    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      SNAPSHOT_LIMITS.totalStringBytes,
    )
    expect(new TextEncoder().encode(state.tasks[0].description).byteLength).toBeGreaterThan(
      SNAPSHOT_LIMITS.totalStringBytes - 64 * 1024,
    )
    expect(parseStoredAppState(JSON.parse(serialized)).tasks[0].description).toBe(
      state.tasks[0].description,
    )
  })

  it('keeps a transportable current snapshot with 20,001 minimal tasks', () => {
    const state = createSeedState()
    state.tasks = Array.from({ length: 20_001 }, (_, index) => minimalTask(index))
    const serialized = JSON.stringify(state)

    const loaded = parseStoredAppState(JSON.parse(serialized))

    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(10 * 1024 * 1024)
    expect(loaded.tasks).toHaveLength(20_001)
    expect(loaded.tasks.at(-1)?.id).toBe('minimal-task-20000')
  })

  it('keeps formerly transportable 20,001-item nested collections and provider maps', () => {
    const state = createSeedState()
    state.tasks[0].tags = Array.from({ length: 20_001 }, (_, index) => `tag-${index}`)
    state.tasks[0].subtasks = Array.from({ length: 20_001 }, (_, index) => ({
      id: `subtask-${index}`,
      title: `s${index}`,
      completed: false,
    }))
    state.habits[0].targetDays = Array(20_001).fill(1)
    state.habits[0].completions = Array(20_001).fill('2026-08-21')
    state.settings.syncProviderConfigs = Object.fromEntries([
      ['provider-0', Object.fromEntries(Array.from(
        { length: 20_001 },
        (_, index) => [`field-${index}`, 'value'],
      ))],
      ...Array.from({ length: 20_000 }, (_, index) => [`provider-${index + 1}`, {}]),
    ])

    const loaded = parseStoredAppState(state)

    expect(loaded.tasks[0].tags).toHaveLength(20_001)
    expect(loaded.tasks[0].subtasks).toHaveLength(20_001)
    expect(loaded.habits[0].targetDays).toHaveLength(20_001)
    expect(loaded.habits[0].completions).toHaveLength(20_001)
    expect(Object.keys(loaded.settings.syncProviderConfigs)).toHaveLength(20_001)
    expect(Object.keys(loaded.settings.syncProviderConfigs['provider-0'])).toHaveLength(20_001)
  })

  it('keeps formerly accepted v4 nested IDs without widening top-level identity rules', () => {
    const state = createLegacyState(4)
    state.tasks[0].subtasks[0].id = ''
    state.tasks[0].reminders[0].id = ''
    state.tasks.find((task) => task.attachments.length)!.attachments[0].id = ''

    const loaded = parseStoredAppState(state)

    expect(loaded.tasks[0].subtasks[0].id).toBe('')
    expect(loaded.tasks[0].reminders[0].id).toBe('')
    expect(loaded.tasks.find((task) => task.attachments.length)!.attachments[0].id).toBe('')
  })

  it('deterministically repairs legacy identity and project references without dropping entities or plugin data', () => {
    const legacy = createLegacyState(3) as LegacyAppState & Record<string, unknown>
    legacy['plugin.example/root'] = { keep: true }
    legacy.projects[0].id = 'legacy-project'
    legacy.projects.push({
      ...structuredClone(legacy.projects[1]),
      ['plugin.example/project' as keyof never]: { keep: 'project' },
    })
    legacy.tasks[0].projectId = 'orphan-project'
    legacy.tasks.push({
      ...structuredClone(legacy.tasks[1]),
      ['plugin.example/task' as keyof never]: { keep: 'task' },
    })
    legacy.habits.push({
      ...structuredClone(legacy.habits[0]),
      ['plugin.example/habit' as keyof never]: { keep: 'habit' },
    })
    legacy.savedFilters.push(
      { ...savedFilter('duplicate-filter'), projectId: 'orphan-project' },
      { ...savedFilter('duplicate-filter'), ['plugin.example/filter' as keyof never]: { keep: 'filter' } },
    )
    legacy.pomodoro.taskId = 'orphan-task'

    const first = parseStoredAppState(legacy)
    const second = parseStoredAppState(legacy)

    expect(first.projects).toHaveLength(legacy.projects.length + 1)
    expect(first.tasks).toHaveLength(legacy.tasks.length)
    expect(first.habits).toHaveLength(legacy.habits.length)
    expect(first.savedFilters).toHaveLength(legacy.savedFilters.length)
    expect(new Set(first.projects.map(({ id }) => id)).size).toBe(first.projects.length)
    expect(new Set(first.tasks.map(({ id }) => id)).size).toBe(first.tasks.length)
    expect(new Set(first.habits.map(({ id }) => id)).size).toBe(first.habits.length)
    expect(new Set(first.savedFilters.map(({ id }) => id)).size).toBe(first.savedFilters.length)
    expect(first.projects.filter(({ id }) => id === 'inbox')).toHaveLength(1)
    expect(first.tasks[0].projectId).toBe('inbox')
    expect(first.savedFilters[0].projectId).toBeUndefined()
    expect(first.pomodoro.taskId).toBeUndefined()
    expect(first.projects.map(({ id }) => id)).toEqual(second.projects.map(({ id }) => id))
    expect(first.tasks.map(({ id }) => id)).toEqual(second.tasks.map(({ id }) => id))
    expect(first).toHaveProperty('plugin.example/root', { keep: true })
    expect(first.projects.at(-1)).toHaveProperty('plugin.example/project', { keep: 'project' })
    expect(first.tasks.at(-1)).toHaveProperty('plugin.example/task', { keep: 'task' })
    expect(first.habits.at(-1)).toHaveProperty('plugin.example/habit', { keep: 'habit' })
    expect(first.savedFilters.at(-1)).toHaveProperty('plugin.example/filter', { keep: 'filter' })
  })

  it('creates stable migration IDs for schema v1 entities that predate required IDs', () => {
    const legacy = createLegacyState(1)
    delete (legacy.tasks[0] as Partial<LegacyTask>).id
    delete (legacy.projects[0] as Partial<LegacyProject>).id
    delete (legacy.habits[0] as Partial<LegacyHabit>).id

    const first = parseStoredAppState(legacy)
    const second = parseStoredAppState(legacy)

    expect(first.tasks[0].id).toBe('migrated-task-1')
    expect(first.habits[0].id).toBe('migrated-habit-1')
    expect(first.projects.some(({ id }) => id === 'migrated-project-1')).toBe(true)
    expect(first.projects.map(({ id }) => id)).toEqual(second.projects.map(({ id }) => id))
    expect(first.projects.filter(({ id }) => id === 'inbox')).toHaveLength(1)
  })
})
