import { afterEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from '../../domain/migrations'
import type { AppState } from '../../domain/models'
import { createSeedState } from '../../domain/seed'
import { SyncProviderError } from './SyncAdapter'
import {
  createRemoteEnvelope,
  decodeRemoteSnapshot,
  mergeRemoteState,
  summarizeSnapshot,
  syncableHash,
} from './RemoteSnapshot'

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
    expect(envelope.data.tasks).toEqual(state.tasks)
  })

  it('decodes an envelope and applies the current migrations', () => {
    const state = createSeedState()
    const envelope = createRemoteEnvelope(state)
    envelope.schemaVersion = 1
    envelope.data.settings.inboxView = 'list'

    const decoded = decodeRemoteSnapshot(envelope)

    expect(decoded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(decoded.tasks).toEqual(state.tasks)
    expect(decoded.settings.theme).toBe(state.settings.theme)
    expect(decoded.sync.status).toBe('idle')
  })

  it('accepts a legacy full AppState snapshot', () => {
    const legacy = createSeedState()
    legacy.schemaVersion = 1

    const decoded = decodeRemoteSnapshot(legacy)

    expect(decoded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(decoded.tasks).toEqual(legacy.tasks)
    expect(decoded.projects).toEqual(legacy.projects)
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
    remote.settings.syncProvider = 'demo'
    remote.settings.autoSync = false
    remote.settings.syncProviderConfigs = {}

    const merged = mergeRemoteState(local, remote)

    expect(merged.tasks[0].title).toBe('Название с другого устройства')
    expect(merged.settings.theme).toBe('dark')
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
})
