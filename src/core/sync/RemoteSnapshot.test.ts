import { afterEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_SCHEMA_VERSION, SNAPSHOT_LIMITS } from '../../domain/migrations'
import type { AppState, SavedFilter } from '../../domain/models'
import { createSeedState } from '../../domain/seed'
import { SyncProviderError } from './SyncAdapter'
import {
  createRemoteEnvelope,
  decodeRemoteSnapshot,
  mergeRemoteState,
  type RemoteSnapshotEnvelope,
  summarizeSnapshot,
  syncableHash,
} from './RemoteSnapshot'

const remoteFilter = (id: string): SavedFilter => ({
  id,
  name: id,
  query: '',
  tags: [],
  tagMode: 'any',
  status: 'active',
  createdAt: '2026-08-21T00:00:00.000Z',
})

function uncheckedRemoteEnvelope(state: AppState): RemoteSnapshotEnvelope {
  const {
    autoSync: _autoSync,
    syncProvider: _syncProvider,
    syncProviderConfigs: _syncProviderConfigs,
    ...settings
  } = state.settings
  const { schemaVersion, sync: _sync, settings: _settings, ...data } = state
  return {
    format: 'focus-flow',
    formatVersion: 1,
    schemaVersion,
    generatedAt: '2026-08-21T00:00:00.000Z',
    data: { ...data, settings },
  }
}

function createLegacyV1State() {
  const current = createSeedState()
  return {
    ...current,
    schemaVersion: 1 as const,
    tasks: current.tasks.map(({ urgencyThresholdOverrideHours, ...task }) => ({
      ...task,
      urgencyThresholdHours: urgencyThresholdOverrideHours ?? 72,
    })),
    projects: current.projects.map(({ urgencyThresholdHours: _threshold, ...project }) => project),
  }
}

function addDeepRemotePlugin(state: AppState) {
  let value: Record<string, unknown> = { leaf: true }
  for (let index = 0; index < 10_000; index += 1) value = { child: value }
  ;(state as AppState & Record<string, unknown>)['plugin.example/deep'] = value
}

function invalidRemoteStates(): [string, (state: AppState) => void][] {
  return [
    ['duplicate task IDs', (state) => state.tasks.push(structuredClone(state.tasks[0]))],
    ['duplicate project IDs', (state) => state.projects.push(structuredClone(state.projects[0]))],
    ['duplicate habit IDs', (state) => state.habits.push(structuredClone(state.habits[0]))],
    ['duplicate filter IDs', (state) => state.savedFilters.push(remoteFilter('same'), remoteFilter('same'))],
    ['a missing inbox', (state) => {
      state.projects = state.projects.filter(({ id }) => id !== 'inbox')
      state.tasks.forEach((task) => { if (task.projectId === 'inbox') task.projectId = 'personal' })
    }],
    ['an orphan project reference', (state) => { state.tasks[0].projectId = 'missing-project' }],
    ['an orphan saved-filter project', (state) => {
      state.savedFilters.push({ ...remoteFilter('orphan-filter'), projectId: 'missing-project' })
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
    ['excessive nesting depth', (state) => addDeepRemotePlugin(state)],
  ]
}

afterEach(() => {
  vi.useRealTimers()
})

describe('remote snapshots', () => {
  it('creates a versioned envelope without local sync state or provider settings', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T10:20:30.000Z'))
    const state = createSeedState()
    state.settings.autoSync = true
    state.settings.syncProvider = 'google-drive'
    state.settings.syncProviderConfigs = { 'google-drive': { clientId: 'local-client-id' } }
    state.settings.fontFamily = 'readable'
    state.settings.fontScale = 110
    state.sync = {
      status: 'success',
      connectionStatus: 'connected',
      providerId: 'google-drive',
      remoteRevision: 'revision-1',
    }

    const envelope = createRemoteEnvelope(state)

    expect(envelope).toMatchObject({
      format: 'focus-flow',
      formatVersion: 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      generatedAt: '2026-08-03T10:20:30.000Z',
    })
    expect(envelope.data).not.toHaveProperty('schemaVersion')
    expect(envelope.data).not.toHaveProperty('sync')
    expect(envelope.data.settings).not.toHaveProperty('autoSync')
    expect(envelope.data.settings).not.toHaveProperty('syncProvider')
    expect(envelope.data.settings).not.toHaveProperty('syncProviderConfigs')
    expect(envelope.data.settings.theme).toBe(state.settings.theme)
    expect(envelope.data.settings.fontFamily).toBe('readable')
    expect(envelope.data.settings.fontScale).toBe(110)
    expect(envelope.data.tasks).toEqual(state.tasks)
  })

  it('decodes an envelope and applies the current migrations', () => {
    const legacy = createLegacyV1State()
    const envelope = uncheckedRemoteEnvelope(legacy as unknown as AppState)
    envelope.data.settings.inboxView = 'list'
    envelope.data.savedFilters.push({ ...remoteFilter('legacy-envelope-orphan'), projectId: 'missing-project' })
    envelope.data.pomodoro.taskId = 'missing-task'

    const decoded = decodeRemoteSnapshot(envelope)

    expect(decoded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(decoded.tasks).toEqual(legacy.tasks.map(({ urgencyThresholdHours, ...task }) => ({
      ...task,
      urgencyThresholdOverrideHours: urgencyThresholdHours,
    })))
    expect(decoded.projects).toEqual(legacy.projects.map((project) => ({
      ...project,
      urgencyThresholdHours: legacy.settings.defaultUrgencyThresholdHours,
    })))
    expect(decoded.settings.theme).toBe(legacy.settings.theme)
    expect(decoded.sync.status).toBe('idle')
    expect(decoded.savedFilters[0].projectId).toBeUndefined()
    expect(decoded.pomodoro.taskId).toBeUndefined()
  })

  it('accepts a legacy full AppState snapshot', () => {
    const legacy = createLegacyV1State()
    legacy.savedFilters.push({ ...remoteFilter('legacy-orphan'), projectId: 'missing-project' })
    legacy.pomodoro.taskId = 'missing-task'

    const decoded = decodeRemoteSnapshot(legacy)

    expect(decoded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(decoded.tasks).toEqual(legacy.tasks.map(({ urgencyThresholdHours, ...task }) => ({
      ...task,
      urgencyThresholdOverrideHours: urgencyThresholdHours,
    })))
    expect(decoded.projects).toEqual(legacy.projects.map((project) => ({
      ...project,
      urgencyThresholdHours: legacy.settings.defaultUrgencyThresholdHours,
    })))
    expect(decoded.savedFilters[0].projectId).toBeUndefined()
    expect(decoded.pomodoro.taskId).toBeUndefined()
  })

  it.each([
    null,
    {},
    { format: 'another-product', formatVersion: 1 },
    { ...createRemoteEnvelope(createSeedState()), formatVersion: 2 },
    { ...createRemoteEnvelope(createSeedState()), generatedAt: 'not-a-date' },
    { ...createRemoteEnvelope(createSeedState()), data: {} },
    { ...createRemoteEnvelope(createSeedState()), schemaVersion: CURRENT_SCHEMA_VERSION + 1 },
    { ...createSeedState(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 },
  ])('rejects malformed or unsupported payload %#', (payload) => {
    try {
      decodeRemoteSnapshot(payload)
      throw new Error('Expected decodeRemoteSnapshot to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(SyncProviderError)
      expect((error as SyncProviderError).code).toBe('invalid-remote')
    }
  })

  it('rejects malformed nested collections instead of silently dropping them', () => {
    const envelope = createRemoteEnvelope(createSeedState())
    ;(envelope.data.tasks[0] as unknown as { attachments: string }).attachments = 'broken'

    expect(() => decodeRemoteSnapshot(envelope)).toThrow(expect.objectContaining({
      code: 'invalid-remote',
    }))
  })

  it('rejects malformed nested elements and executable attachment URLs', () => {
    const malformedFilter = createRemoteEnvelope(createSeedState())
    malformedFilter.data.savedFilters.push({
      id: 'bad-filter',
      name: 'Bad filter',
      query: '',
      tags: ['safe'],
      tagMode: 'any',
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    ;(malformedFilter.data.savedFilters[0] as unknown as { tags: string }).tags = 'broken'

    const executableAttachment = createRemoteEnvelope(createSeedState())
    executableAttachment.data.tasks[0].attachments.push({
      id: 'bad-attachment',
      name: 'payload.bin',
      type: 'application/octet-stream',
      size: 20,
      dataUrl: 'javascript:document.body.dataset.pwned=1',
    })

    expect(() => decodeRemoteSnapshot(malformedFilter)).toThrow(expect.objectContaining({ code: 'invalid-remote' }))
    expect(() => decodeRemoteSnapshot(executableAttachment)).toThrow(expect.objectContaining({ code: 'invalid-remote' }))
  })

  it('keeps device-local settings and sync metadata while adopting remote data', () => {
    const local = createSeedState()
    local.settings.syncProvider = 'google-drive'
    local.settings.autoSync = true
    local.settings.syncProviderConfigs = { 'google-drive': { clientId: 'client-id' } }
    local.sync = {
      status: 'success',
      connectionStatus: 'connected',
      providerId: 'google-drive',
      remoteId: 'remote-id',
      remoteRevision: 'revision-7',
    }
    const remote = createSeedState()
    remote.tasks[0] = { ...remote.tasks[0], title: 'Название с другого устройства' }
    remote.settings.theme = 'dark'
    remote.settings.fontFamily = 'humanist'
    remote.settings.fontScale = 120
    remote.settings.syncProvider = 'demo'
    remote.settings.autoSync = false
    remote.settings.syncProviderConfigs = {}

    const merged = mergeRemoteState(local, remote)

    expect(merged.tasks[0].title).toBe('Название с другого устройства')
    expect(merged.settings.theme).toBe('dark')
    expect(merged.settings.fontFamily).toBe('humanist')
    expect(merged.settings.fontScale).toBe(120)
    expect(merged.settings).toMatchObject({
      syncProvider: 'google-drive',
      autoSync: true,
      syncProviderConfigs: { 'google-drive': { clientId: 'client-id' } },
    })
    expect(merged.sync).toBe(local.sync)
  })

  it('keeps provider configuration local to the current device', () => {
    const local = createSeedState()
    const remote = createSeedState()
    remote.settings.syncProviderConfigs = { future: { endpoint: 'remote-only' } }

    expect(mergeRemoteState(local, remote).settings.syncProviderConfigs).toEqual({})
  })

  it('hashes only syncable content with stable object-key ordering', () => {
    const state = createSeedState()
    const localOnlyChanges = structuredClone(state)
    localOnlyChanges.settings.syncProvider = 'google-drive'
    localOnlyChanges.settings.autoSync = true
    localOnlyChanges.settings.syncProviderConfigs = { 'google-drive': { clientId: 'client-id' } }
    localOnlyChanges.sync = {
      status: 'error',
      connectionStatus: 'authorization-required',
      message: 'local-only',
    }
    localOnlyChanges.settings = Object.fromEntries(
      Object.entries(localOnlyChanges.settings).reverse(),
    ) as unknown as AppState['settings']

    expect(syncableHash(localOnlyChanges)).toBe(syncableHash(state))

    const changed = structuredClone(state)
    changed.tasks[0].title = 'Изменённая задача'
    expect(syncableHash(changed)).not.toBe(syncableHash(state))

    const typographyChanged = structuredClone(state)
    typographyChanged.settings.fontScale = 110
    expect(syncableHash(typographyChanged)).not.toBe(syncableHash(state))
  })

  it('summarizes all synchronized collections', () => {
    const state = createSeedState()
    state.savedFilters.push({
      id: 'filter-1',
      name: 'Фокус',
      query: '',
      tags: ['фокус'],
      tagMode: 'all',
      status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z',
    })

    expect(summarizeSnapshot(state)).toEqual({
      tasks: state.tasks.length,
      projects: state.projects.length,
      habits: state.habits.length,
      savedFilters: 1,
      recentTaskTitles: expect.arrayContaining([expect.any(String)]),
    })
  })

  it.each(invalidRemoteStates())('rejects outgoing schema v5 data with %s', (_label, mutate) => {
    const state = createSeedState()
    mutate(state)

    expect(() => createRemoteEnvelope(state)).toThrow(expect.objectContaining({
      name: 'SyncProviderError',
      code: 'invalid-remote',
    }))
  })

  it.each(invalidRemoteStates())('rejects incoming remote schema v5 data with %s', (_label, mutate) => {
    const state = createSeedState()
    mutate(state)

    expect(() => decodeRemoteSnapshot(uncheckedRemoteEnvelope(state))).toThrow(expect.objectContaining({
      name: 'SyncProviderError',
      code: 'invalid-remote',
    }))
  })

  it('rejects excessive plugin depth before recursive hashing can overflow', () => {
    const state = createSeedState()
    addDeepRemotePlugin(state)

    expect(() => syncableHash(state)).toThrow(expect.objectContaining({
      name: 'SyncProviderError',
      code: 'invalid-remote',
    }))
  })

  it('rejects an invalid outgoing generated timestamp', () => {
    expect(() => createRemoteEnvelope(createSeedState(), 'not-a-date')).toThrow(expect.objectContaining({
      name: 'SyncProviderError',
      code: 'invalid-remote',
    }))
  })
})
