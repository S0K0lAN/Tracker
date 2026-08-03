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
      settings: Record<string, unknown>
      sync: Record<string, unknown>
      tasks: ReturnType<typeof createSeedState>['tasks']
    }
    historical.settings.inboxView = 'calendar'
    delete historical.settings.syncProviderConfigs
    historical.sync = { status: 'idle' }
    const historicalAttachment = historical.tasks.flatMap((task) => task.attachments)[0]
    historicalAttachment.type = ''

    const migrated = parseStoredAppState(historical)

    expect(migrated.settings.inboxView).toBe('list')
    expect(migrated.settings.syncProviderConfigs).toEqual({})
    expect(migrated.tasks.flatMap((task) => task.attachments)[0].type).toBe('image/svg+xml')
    expect(migrated.sync).toMatchObject({
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
    })
  })

  it('keeps the selected provider but requires a fresh browser OAuth session after reload', () => {
    const persisted = createSeedState()
    persisted.settings.syncProvider = 'google-drive'
    persisted.settings.syncProviderConfigs = {
      'google-drive': { clientId: 'public-client.apps.googleusercontent.com' },
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
    expect(migrated.settings.syncProviderConfigs['google-drive'].clientId).toBe('public-client.apps.googleusercontent.com')
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

  it('moves the legacy Google Client ID into the provider configuration bag', () => {
    const persisted = createSeedState() as ReturnType<typeof createSeedState> & {
      settings: ReturnType<typeof createSeedState>['settings'] & { googleDriveClientId?: string }
    }
    persisted.settings.googleDriveClientId = 'legacy.apps.googleusercontent.com'

    const migrated = normalizeAppState(persisted)

    expect(migrated.settings.syncProviderConfigs['google-drive']).toEqual({
      clientId: 'legacy.apps.googleusercontent.com',
    })
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
