import { describe, expect, it } from 'vitest'
import { normalizeAppState, parseStoredAppState } from './migrations'
import { createSeedState } from './seed'

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
    const historical = structuredClone(createSeedState()) as unknown as {
      schemaVersion: number
      settings: Record<string, unknown>
      sync: Record<string, unknown>
      tasks: ReturnType<typeof createSeedState>['tasks']
    }
    historical.schemaVersion = 2
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
    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.tasks.flatMap((task) => task.attachments)[0].type).toBe('image/svg+xml')
    expect(migrated.sync).toMatchObject({
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
    })
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

  it('rejects reminders with invalid timestamps and deadlines before their start', () => {
    const invalidReminder = createSeedState()
    invalidReminder.tasks[0].reminders[0].at = 'not-a-date'
    const reversedRange = createSeedState()
    reversedRange.tasks[0].startAt = '2026-08-21T12:00:00.000Z'
    reversedRange.tasks[0].deadline = '2026-08-21T11:59:59.999Z'

    expect(() => parseStoredAppState(invalidReminder)).toThrow(/tasks\[0\]\.reminders\[0\]\.at/)
    expect(() => parseStoredAppState(reversedRange)).toThrow(/tasks\[0\]\.deadline/)
  })

  it('requires positive task and default urgency thresholds', () => {
    const invalidTaskThreshold = createSeedState()
    invalidTaskThreshold.tasks[0].urgencyThresholdHours = 0
    const invalidDefaultThreshold = createSeedState()
    invalidDefaultThreshold.settings.defaultUrgencyThresholdHours = -1

    expect(() => parseStoredAppState(invalidTaskThreshold)).toThrow(/tasks\[0\]\.urgencyThresholdHours/)
    expect(() => parseStoredAppState(invalidDefaultThreshold)).toThrow(/settings\.defaultUrgencyThresholdHours/)
  })

  it('sanitizes schema v3 values that became strict in v4 without dropping unrelated data', () => {
    const legacy = createSeedState()
    legacy.schemaVersion = 3
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

    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.tasks).toHaveLength(legacy.tasks.length)
    expect(migrated.tasks[0]).toMatchObject({
      title: 'Сохранить эту задачу',
      description: 'Описание не должно потеряться',
      tags: ['важные-данные'],
      urgencyThresholdHours: 72,
      completedAt: undefined,
      reminders: [],
    })
    expect(Number.isFinite(Date.parse(migrated.tasks[0].createdAt))).toBe(true)
    expect(Number.isFinite(Date.parse(migrated.tasks[0].updatedAt))).toBe(true)
    expect(migrated.tasks[1]).toMatchObject({
      startAt: '2026-08-21T12:00:00.000Z',
      deadline: undefined,
    })
    expect(migrated.projects[0].color).toBe('#778c70')
    expect(migrated.habits[0].color).toBe('#778c70')
    expect(migrated.settings.defaultUrgencyThresholdHours).toBe(72)
    expect(migrated.pomodoro).toMatchObject({
      taskId: legacy.tasks[0].id,
      runningSince: undefined,
    })
  })

  it('rejects an unparseable Pomodoro start in current schema v4 snapshots', () => {
    const invalid = createSeedState()
    invalid.pomodoro.runningSince = 'invalid-running-since'

    expect(() => parseStoredAppState(invalid)).toThrow(/pomodoro\.runningSince/)
  })

  it('uses safe fallbacks when normalizing untrusted values outside strict snapshot parsing', () => {
    const damaged = createSeedState()
    damaged.projects[0].color = 'red; background: url(https://attacker.invalid)'
    damaged.habits[0].color = '#123'
    damaged.settings.defaultUrgencyThresholdHours = 0
    damaged.tasks[0].urgencyThresholdHours = Number.NaN
    damaged.tasks[0].createdAt = 'invalid-created-at'
    damaged.tasks[0].updatedAt = 'invalid-updated-at'
    damaged.tasks[0].completedAt = 'invalid-completed-at'
    damaged.tasks[0].startAt = '2026-08-21T12:00:00.000Z'
    damaged.tasks[0].deadline = '2026-08-21T11:00:00.000Z'
    damaged.tasks[0].reminders = [{ id: 'invalid-reminder', at: 'not-a-date' }]

    const normalized = normalizeAppState(damaged)

    expect(normalized.projects[0].color).toBe('#778c70')
    expect(normalized.habits[0].color).toBe('#778c70')
    expect(normalized.settings.defaultUrgencyThresholdHours).toBe(72)
    expect(normalized.tasks[0].urgencyThresholdHours).toBe(72)
    expect(Number.isFinite(Date.parse(normalized.tasks[0].createdAt))).toBe(true)
    expect(Number.isFinite(Date.parse(normalized.tasks[0].updatedAt))).toBe(true)
    expect(normalized.tasks[0]).toMatchObject({
      startAt: '2026-08-21T12:00:00.000Z',
      deadline: undefined,
      completedAt: undefined,
      reminders: [],
    })
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
})
