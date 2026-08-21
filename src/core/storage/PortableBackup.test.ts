import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, SNAPSHOT_LIMITS } from '../../domain/migrations'
import type { AppState, SavedFilter, Task } from '../../domain/models'
import { createSeedState } from '../../domain/seed'
import { MAX_ATTACHMENT_BYTES } from '../../domain/attachments'
import { MAX_CUSTOM_BACKGROUND_BYTES } from '../../domain/backgrounds'
import { createRemoteEnvelope } from '../sync/RemoteSnapshot'
import {
  assertPortableBackupFile,
  createPortableBackup,
  MAX_PORTABLE_BACKUP_BYTES,
  parsePortableBackup,
  PortableBackupError,
} from './PortableBackup'

const portableFilter = (id: string): SavedFilter => ({
  id,
  name: id,
  query: '',
  tags: [],
  tagMode: 'any',
  status: 'active',
  createdAt: '2026-08-21T00:00:00.000Z',
})

const portableMinimalTask = (index: number): Task => ({
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
  focusMinutes: 0,
})

function addDeepPortablePlugin(state: AppState) {
  let value: Record<string, unknown> = { leaf: true }
  for (let index = 0; index <= SNAPSHOT_LIMITS.maxDepth; index += 1) value = { child: value }
  ;(state as AppState & Record<string, unknown>)['plugin.example/deep'] = value
}

function invalidPortableStates(): [string, (state: AppState) => void][] {
  return [
    ['duplicate task IDs', (state) => state.tasks.push(structuredClone(state.tasks[0]))],
    ['duplicate project IDs', (state) => state.projects.push(structuredClone(state.projects[0]))],
    ['duplicate habit IDs', (state) => state.habits.push(structuredClone(state.habits[0]))],
    ['duplicate filter IDs', (state) => state.savedFilters.push(portableFilter('same'), portableFilter('same'))],
    ['a missing inbox', (state) => {
      state.projects = state.projects.filter(({ id }) => id !== 'inbox')
      state.tasks.forEach((task) => { if (task.projectId === 'inbox') task.projectId = 'personal' })
    }],
    ['an orphan project reference', (state) => { state.tasks[0].projectId = 'missing-project' }],
    ['an orphan saved-filter project', (state) => {
      state.savedFilters.push({ ...portableFilter('orphan-filter'), projectId: 'missing-project' })
    }],
    ['an orphan Pomodoro task', (state) => { state.pomodoro.taskId = 'missing-task' }],
    ['too many entities', (state) => {
      state.projects = Array(SNAPSHOT_LIMITS.projects + 1).fill(state.projects[0])
    }],
    ['an oversized user string', (state) => {
      state.tasks[0].title = 'x'.repeat(SNAPSHOT_LIMITS.shortTextBytes + 1)
    }],
    ['too much cumulative user text', (state) => {
      const description = 'x'.repeat(Math.floor(SNAPSHOT_LIMITS.userTextBytes / 20) + 1)
      state.tasks = []
      state.habits = []
      state.savedFilters = []
      state.projects = [{
        id: 'inbox', name: 'Без проекта', color: '#778c70', urgencyThresholdHours: 72, createdAt: '2026-08-21T00:00:00.000Z',
      }, ...Array.from({ length: 20 }, (_, index) => ({
        id: `large-project-${index}`,
        name: `Проект ${index}`,
        description,
        color: '#778c70',
        urgencyThresholdHours: 72,
        createdAt: '2026-08-21T00:00:00.000Z',
      }))]
    }],
    ['excessive structural complexity', (state) => {
      ;(state as AppState & Record<string, unknown>)['plugin.example/nodes'] = Array(
        SNAPSHOT_LIMITS.totalNodes + 1,
      ).fill(0)
    }],
    ['excessive nesting depth', (state) => addDeepPortablePlugin(state)],
  ]
}

describe('portable Focus Flow backup', () => {
  it('creates a deterministic versioned JSON file without device-local sync settings', () => {
    const state = createSeedState()
    state.tasks[0].title = 'Уникальная задача из backup'
    state.settings.autoSync = true
    state.settings.syncProvider = 'google-drive'
    state.settings.syncProviderConfigs = { 'google-drive': { endpoint: 'local-only' } }
    state.sync.remoteRevision = 'device-only-revision'

    const backup = createPortableBackup(state, new Date('2026-08-07T09:10:11.000Z'))
    const payload = JSON.parse(backup.contents)

    expect(backup.fileName).toBe('focus-flow-backup-2026-08-07T09-10-11.json')
    expect(payload).toMatchObject({
      format: 'focus-flow',
      formatVersion: 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      generatedAt: '2026-08-07T09:10:11.000Z',
    })
    expect(payload.data.tasks[0].title).toBe('Уникальная задача из backup')
    expect(payload.data.tasks.some((task: { attachments: unknown[] }) => task.attachments.length > 0)).toBe(true)
    expect(payload.data).not.toHaveProperty('sync')
    expect(payload.data.settings).not.toHaveProperty('autoSync')
    expect(payload.data.settings).not.toHaveProperty('syncProvider')
    expect(payload.data.settings).not.toHaveProperty('syncProviderConfigs')
  })

  it('reads its envelope and keeps portable application data', () => {
    const state = createSeedState()
    state.settings.theme = 'dark'
    const backup = createPortableBackup(state, new Date('2026-08-07T09:10:11.000Z'))

    const parsed = parsePortableBackup(backup.contents)

    expect(parsed.generatedAt).toBe('2026-08-07T09:10:11.000Z')
    expect(parsed.state.tasks).toEqual(state.tasks)
    expect(parsed.state.projects).toEqual(state.projects)
    expect(parsed.state.habits).toEqual(state.habits)
    expect(parsed.state.settings.theme).toBe('dark')
  })

  it('accepts and migrates a legacy full-state JSON backup', () => {
    const current = createSeedState()
    const legacy = {
      ...current,
      schemaVersion: 2,
      tasks: current.tasks.map(({ urgencyThresholdOverrideHours, ...task }) => ({
        ...task,
        urgencyThresholdHours: urgencyThresholdOverrideHours ?? current.settings.defaultUrgencyThresholdHours,
      })),
      projects: current.projects.map(({ urgencyThresholdHours: _threshold, ...project }) => project),
    }
    const legacySettings = legacy.settings as unknown as Record<string, unknown>
    delete legacySettings.fontFamily
    delete legacySettings.fontScale
    legacy.savedFilters.push({ ...portableFilter('legacy-orphan'), projectId: 'missing-project' })
    legacy.pomodoro.taskId = 'missing-task'

    const parsed = parsePortableBackup(JSON.stringify(legacy))

    expect(parsed.state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(parsed.state.settings.fontFamily).toBe('system')
    expect(parsed.state.settings.fontScale).toBe(100)
    expect(parsed.state.savedFilters[0].projectId).toBeUndefined()
    expect(parsed.state.pomodoro.taskId).toBeUndefined()
  })

  it.each([
    ['empty', '   ', 'empty'],
    ['broken JSON', '{broken', 'invalid-json'],
    ['wrong shape', JSON.stringify({ hello: 'world' }), 'invalid-backup'],
    ['future schema', JSON.stringify({ ...createSeedState(), schemaVersion: 99 }), 'newer-version'],
  ])('rejects %s before it can be applied', (_label, contents, code) => {
    expect(() => parsePortableBackup(contents)).toThrow(expect.objectContaining({
      name: 'PortableBackupError',
      code,
    }))
  })

  it('rejects a remote background URL instead of loading it from an imported file', () => {
    const backup = createPortableBackup(createSeedState())
    const payload = JSON.parse(backup.contents)
    payload.data.settings.backgroundPreset = 'custom'
    payload.data.settings.customBackgroundDataUrl = 'https://tracking.example/background.png'

    expect(() => parsePortableBackup(JSON.stringify(payload))).toThrow(expect.objectContaining({
      code: 'invalid-backup',
    }))
  })

  it('checks extension and byte limit before reading a selected file', () => {
    expect(() => assertPortableBackupFile({ name: 'backup.txt', size: 10 })).toThrow(expect.objectContaining({
      code: 'wrong-file-type',
    }))
    expect(() => assertPortableBackupFile({ name: 'backup.json', size: MAX_PORTABLE_BACKUP_BYTES + 1 })).toThrow(
      expect.objectContaining({ code: 'too-large' }),
    )
    expect(() => assertPortableBackupFile({ name: 'BACKUP.JSON', size: MAX_PORTABLE_BACKUP_BYTES })).not.toThrow()
  })

  it('does not download a file that would exceed its own import limit', () => {
    const state = createSeedState() as AppState & Record<string, unknown>
    state.tasks[0].description = 'x'.repeat(9_700_000)
    state['plugin.example/padding'] = Array(SNAPSHOT_LIMITS.totalNodes).fill('')

    expect(() => createPortableBackup(state)).toThrow(expect.objectContaining({ code: 'too-large' }))
  })

  it('round-trips 20,001 minimal tasks while the compact envelope remains below 10 MiB', () => {
    const state = createSeedState()
    state.tasks = Array.from({ length: 20_001 }, (_, index) => portableMinimalTask(index))

    const backup = createPortableBackup(state)
    const parsed = parsePortableBackup(backup.contents)

    expect(new TextEncoder().encode(backup.contents).byteLength).toBeLessThan(MAX_PORTABLE_BACKUP_BYTES)
    expect(parsed.state.tasks).toHaveLength(20_001)
    expect(parsed.state.tasks.at(-1)?.id).toBe('minimal-task-20000')
  })

  it('round-trips a valid attachment-heavy state near the 10 MiB envelope limit', () => {
    const state = createSeedState()
    const attachmentDataUrl = `data:text/plain;base64,${'A'.repeat(Math.floor(MAX_ATTACHMENT_BYTES / 3) * 4)}`
    const backgroundDataUrl = `data:image/png;base64,${'A'.repeat(Math.floor(MAX_CUSTOM_BACKGROUND_BYTES / 3) * 4)}`
    state.tasks[0].attachments = Array.from({ length: 5 }, (_, index) => ({
      id: `large-attachment-${index}`,
      name: `large-${index}.txt`,
      type: 'text/plain',
      size: MAX_ATTACHMENT_BYTES,
      dataUrl: attachmentDataUrl,
    }))
    state.settings.backgroundPreset = 'custom'
    state.settings.customBackgroundDataUrl = backgroundDataUrl

    const backup = createPortableBackup(state)
    const byteLength = new TextEncoder().encode(backup.contents).byteLength
    const parsed = parsePortableBackup(backup.contents)

    expect(byteLength).toBeGreaterThan(8 * 1024 * 1024)
    expect(byteLength).toBeLessThanOrEqual(MAX_PORTABLE_BACKUP_BYTES)
    expect(parsed.state.tasks[0].attachments).toHaveLength(5)
    expect(parsed.state.settings.customBackgroundDataUrl).toBe(backgroundDataUrl)
  })

  it('exposes typed, user-safe validation errors', () => {
    try {
      parsePortableBackup('{')
      throw new Error('Expected parsing to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(PortableBackupError)
      expect((error as PortableBackupError).message).not.toContain('SyntaxError')
    }
  })

  it.each(invalidPortableStates())('rejects exporting schema v5 data with %s', (_label, mutate) => {
    const state = createSeedState()
    mutate(state)

    expect(() => createPortableBackup(state)).toThrow(expect.objectContaining({
      name: 'PortableBackupError',
      code: 'invalid-state',
      message: 'Локальные данные повреждены, поэтому резервную копию нельзя создать',
    }))
  })

  it.each(invalidPortableStates().filter(([label]) => ![
    'too many entities',
    'an oversized user string',
    'too much cumulative user text',
  ].includes(label)))(
    'rejects imported schema v5 data with %s',
    (_label, mutate) => {
      const envelope = createRemoteEnvelope(createSeedState())
      mutate(envelope.data as unknown as AppState)
      const contents = JSON.stringify(envelope)

      expect(new TextEncoder().encode(contents).byteLength).toBeLessThanOrEqual(MAX_PORTABLE_BACKUP_BYTES)
      expect(() => parsePortableBackup(contents)).toThrow(expect.objectContaining({
        name: 'PortableBackupError',
        code: 'invalid-backup',
      }))
    },
  )

  it.each(invalidPortableStates().filter(([label]) => [
    'an oversized user string',
    'too much cumulative user text',
  ].includes(label)))(
    'rejects imported schema v5 data with %s at the transport boundary',
    (_label, mutate) => {
      const envelope = createRemoteEnvelope(createSeedState())
      mutate(envelope.data as unknown as AppState)
      const contents = JSON.stringify(envelope)

      expect(new TextEncoder().encode(contents).byteLength).toBeGreaterThan(MAX_PORTABLE_BACKUP_BYTES)
      expect(() => parsePortableBackup(contents)).toThrow(expect.objectContaining({
        name: 'PortableBackupError',
        code: 'too-large',
      }))
    },
  )

  it('rejects an oversized imported collection before traversing its elements', () => {
    const valid = createRemoteEnvelope(createSeedState())
    const projects = `{}` + ',{}'.repeat(SNAPSHOT_LIMITS.projects)
    const contents = JSON.stringify({
      format: valid.format,
      formatVersion: valid.formatVersion,
      schemaVersion: valid.schemaVersion,
      generatedAt: valid.generatedAt,
    }).replace(/}$/, '')
      + `,"data":{"tasks":[],"projects":[${projects}],"habits":[],"savedFilters":[],`
      + `"pomodoro":${JSON.stringify(valid.data.pomodoro)},"settings":${JSON.stringify(valid.data.settings)}}}`

    expect(new TextEncoder().encode(contents).byteLength).toBeLessThan(MAX_PORTABLE_BACKUP_BYTES)
    expect(() => parsePortableBackup(contents)).toThrow(expect.objectContaining({
      name: 'PortableBackupError',
      code: 'invalid-backup',
    }))
  })
})
