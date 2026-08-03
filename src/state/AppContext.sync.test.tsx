import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteEnvelope, syncableHash } from '../core/sync/RemoteSnapshot'
import { SyncProviderError, type RemoteHead, type RemoteSnapshot, type SyncAdapter, type SyncProviderDefinition } from '../core/sync/SyncAdapter'
import { SyncProviderRegistry } from '../core/sync/SyncProviderRegistry'
import { createSeedState } from '../domain/seed'
import { AppProvider, useApp } from './AppContext'

const STORAGE_KEY = 'focus-flow.state.v1'
const IMPORT_BACKUP_KEY = 'focus-flow.state.v1.import-backup'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function SyncHarness() {
  const { state, addTask, syncNow, syncConflict, resetDemo, restoreImportBackup, updateSyncProviderConfig } = useApp()
  return (
    <div>
      <button type="button" onClick={() => void syncNow()}>sync</button>
      <button
        type="button"
        onClick={() => addTask({
          ...state.tasks[0],
          id: 'created-during-download',
          title: 'Создано во время загрузки',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })}
      >mutate</button>
      <button type="button" onClick={() => void resetDemo()}>reset</button>
      <button type="button" onClick={() => void restoreImportBackup()}>restore</button>
      <button type="button" onClick={() => updateSyncProviderConfig('endpoint', 'https://new.example.test')}>config</button>
      <output>{state.sync.status}</output>
      <output aria-label="sync message">{state.sync.message}</output>
      <output aria-label="sync metadata">{JSON.stringify({
        remoteId: state.sync.remoteId,
        remoteRevision: state.sync.remoteRevision,
        lastSyncedHash: state.sync.lastSyncedHash,
        lastSyncedAt: state.sync.lastSyncedAt,
      })}</output>
      {syncConflict && <div role="alert">conflict</div>}
      <ul>{state.tasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul>
    </div>
  )
}

describe('AppProvider synchronization races', () => {
  it('does not overwrite a local edit completed while a remote snapshot is downloading', async () => {
    const download = deferred<RemoteSnapshot | null>()
    const local = createSeedState()
    local.settings.syncProvider = 'slow-storage'
    local.settings.autoSync = false
    local.sync = {
      status: 'idle',
      connectionStatus: 'connected',
      providerId: 'slow-storage',
      remoteId: 'remote-file',
      remoteRevision: '1',
      lastSyncedHash: syncableHash(local),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    const remote = createSeedState()
    remote.tasks[0].title = 'Удалённая правка'
    const adapter: SyncAdapter = {
      descriptor: {
        id: 'slow-storage',
        name: 'Slow storage',
        description: 'Test provider',
        connection: 'implicit',
        consistency: 'atomic',
        capabilities: { download: true, upload: true },
      },
      head: vi.fn().mockResolvedValue({ id: 'remote-file', revision: '2' }),
      download: vi.fn(() => download.promise),
      upload: vi.fn(),
    }
    const definition: SyncProviderDefinition = {
      descriptor: adapter.descriptor,
      createRuntime: () => ({
        acquireAdapter: async () => adapter,
        disconnect: async () => undefined,
      }),
    }

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([definition])}>
        <SyncHarness />
      </AppProvider>,
    )

    await screen.findByRole('button', { name: 'sync' })
    fireEvent.click(screen.getByRole('button', { name: 'sync' }))
    await waitFor(() => expect(adapter.download).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'mutate' }))
    download.resolve({
      head: { id: 'remote-file', revision: '2' },
      payload: createRemoteEnvelope(remote),
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('conflict')
    expect(screen.getByText('Создано во время загрузки')).toBeInTheDocument()
    expect(screen.queryByText('Удалённая правка')).not.toBeInTheDocument()
  })

  it('queues another upload when local data changes while an upload is in flight', async () => {
    const firstUpload = deferred<RemoteHead>()
    const local = createSeedState()
    local.settings.syncProvider = 'slow-storage'
    local.settings.autoSync = false
    const baseHash = syncableHash(local)
    local.tasks[0].title = 'Изменено до отправки'
    local.sync = {
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
      providerId: 'slow-storage',
      remoteId: 'remote-file',
      remoteRevision: '1',
      lastSyncedHash: baseHash,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    const upload = vi.fn()
      .mockImplementationOnce(() => firstUpload.promise)
      .mockResolvedValueOnce({ id: 'remote-file', revision: '3' })
    const adapter: SyncAdapter = {
      descriptor: {
        id: 'slow-storage',
        name: 'Slow storage',
        description: 'Test provider',
        connection: 'implicit',
        consistency: 'atomic',
        capabilities: { download: true, upload: true },
      },
      head: vi.fn()
        .mockResolvedValueOnce({ id: 'remote-file', revision: '1' })
        .mockResolvedValueOnce({ id: 'remote-file', revision: '2' }),
      download: vi.fn(),
      upload,
    }
    const definition: SyncProviderDefinition = {
      descriptor: adapter.descriptor,
      createRuntime: () => ({ acquireAdapter: async () => adapter, disconnect: async () => undefined }),
    }

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([definition])}>
        <SyncHarness />
      </AppProvider>,
    )

    await screen.findByRole('button', { name: 'sync' })
    fireEvent.click(screen.getByRole('button', { name: 'sync' }))
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'mutate' }))
    firstUpload.resolve({ id: 'remote-file', revision: '2' })

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    expect(JSON.stringify(upload.mock.calls[1][0])).toContain('Создано во время загрузки')
    await waitFor(() => expect(screen.getByText('success')).toBeInTheDocument())
  })

  it('ignores a late remote response after reset even when provider cleanup fails', async () => {
    const download = deferred<RemoteSnapshot | null>()
    const local = createSeedState()
    local.settings.syncProvider = 'slow-storage'
    local.settings.autoSync = false
    local.sync = {
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
      providerId: 'slow-storage',
      remoteId: 'remote-file',
      remoteRevision: '1',
      lastSyncedHash: syncableHash(local),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
    const disconnect = vi.fn().mockRejectedValue(new Error('Provider cleanup failed'))
    const adapter: SyncAdapter = {
      descriptor: {
        id: 'slow-storage',
        name: 'Slow storage',
        description: 'Test provider',
        connection: 'implicit',
        consistency: 'atomic',
        capabilities: { download: true, upload: true },
      },
      head: vi.fn().mockResolvedValue({ id: 'remote-file', revision: '2' }),
      download: vi.fn(() => download.promise),
      upload: vi.fn(),
    }
    const definition: SyncProviderDefinition = {
      descriptor: adapter.descriptor,
      createRuntime: () => ({ acquireAdapter: async () => adapter, disconnect }),
    }
    const remote = createSeedState()
    remote.tasks[0].title = 'Не должно вернуться после сброса'

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([definition])}>
        <SyncHarness />
      </AppProvider>,
    )

    await screen.findByRole('button', { name: 'sync' })
    fireEvent.click(screen.getByRole('button', { name: 'sync' }))
    await waitFor(() => expect(adapter.download).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    await waitFor(() => expect(disconnect).toHaveBeenCalled())
    download.resolve({
      head: { id: 'remote-file', revision: '2' },
      payload: createRemoteEnvelope(remote),
    })

    await waitFor(() => expect(screen.queryByText('Не должно вернуться после сброса')).not.toBeInTheDocument())
    expect(screen.getByText('Подготовить план недели')).toBeInTheDocument()
  })

  it('drops a rejected session after 401 and acquires a fresh adapter on retry', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'interactive-storage',
      name: 'Interactive storage',
      description: 'Test provider',
      connection: 'interactive',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const rejectedAdapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockRejectedValue(new SyncProviderError('auth-required', 'Токен истёк')),
      download: vi.fn(),
      upload: vi.fn(),
    }
    const freshAdapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValue(null),
      download: vi.fn(),
      upload: vi.fn().mockResolvedValue({ id: 'fresh-file', revision: '1' }),
    }
    const acquireAdapter = vi.fn()
      .mockResolvedValueOnce(rejectedAdapter)
      .mockResolvedValueOnce(freshAdapter)
    const disconnect = vi.fn().mockRejectedValue(new Error('Provider cleanup failed'))
    const definition: SyncProviderDefinition = {
      descriptor,
      createRuntime: () => ({ acquireAdapter, disconnect }),
    }
    const local = createSeedState()
    local.settings.syncProvider = descriptor.id
    local.sync = {
      status: 'idle',
      connectionStatus: 'disconnected',
      connectionMode: 'interactive',
      providerId: descriptor.id,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([definition])}>
        <SyncHarness />
      </AppProvider>,
    )

    await screen.findByRole('button', { name: 'sync' })
    fireEvent.click(screen.getByRole('button', { name: 'sync' }))
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'sync' }))

    await waitFor(() => expect(acquireAdapter).toHaveBeenCalledTimes(2))
    expect(acquireAdapter).toHaveBeenNthCalledWith(2, { interactive: true, resume: true })
    await waitFor(() => expect(screen.getByText('success')).toBeInTheDocument())
  })

  it('rejects missing required provider configuration before creating a runtime', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'required-storage',
      name: 'Required storage',
      description: 'Test provider',
      connection: 'interactive',
      consistency: 'atomic',
      configFields: [{ key: 'endpoint', label: 'Endpoint', persistence: 'public', required: true }],
      capabilities: { download: true, upload: true },
    }
    const createRuntime = vi.fn()
    const local = createSeedState()
    local.settings.syncProvider = descriptor.id
    local.settings.syncProviderConfigs = {}
    local.sync = {
      status: 'idle',
      connectionStatus: 'disconnected',
      connectionMode: 'interactive',
      providerId: descriptor.id,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{ descriptor, createRuntime }])}>
        <SyncHarness />
      </AppProvider>,
    )

    await screen.findByRole('button', { name: 'sync' })
    fireEvent.click(screen.getByRole('button', { name: 'sync' }))

    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument())
    expect(createRuntime).not.toHaveBeenCalled()
  })

  it('forgets remote metadata when public provider configuration changes', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'configurable-storage',
      name: 'Configurable storage',
      description: 'Test provider',
      connection: 'interactive',
      consistency: 'atomic',
      configFields: [{ key: 'endpoint', label: 'Endpoint', persistence: 'public', required: true }],
      capabilities: { download: true, upload: true },
    }
    const disconnect = vi.fn().mockResolvedValue(undefined)
    const definition: SyncProviderDefinition = {
      descriptor,
      createRuntime: () => ({
        acquireAdapter: async () => ({
          descriptor,
          head: async () => null,
          download: async () => null,
          upload: async () => ({ id: 'unused', revision: 'unused' }),
        }),
        disconnect,
      }),
    }
    const local = createSeedState()
    local.settings.syncProvider = descriptor.id
    local.settings.syncProviderConfigs = { [descriptor.id]: { endpoint: 'https://old.example.test' } }
    local.sync = {
      status: 'success',
      connectionStatus: 'connected',
      connectionMode: 'interactive',
      providerId: descriptor.id,
      remoteId: 'old-remote',
      remoteRevision: 'old-revision',
      lastSyncedHash: 'old-hash',
      lastSyncedAt: '2026-08-03T12:00:00.000Z',
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([definition])}>
        <SyncHarness />
      </AppProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('sync metadata')).toHaveTextContent('old-revision'))
    fireEvent.click(screen.getByRole('button', { name: 'config' }))

    await waitFor(() => expect(screen.getByLabelText('sync metadata')).toHaveTextContent('{}'))
    expect(screen.getByText('idle')).toBeInTheDocument()
  })

  it('reports a transactional restore failure without an unhandled rejection', async () => {
    const current = createSeedState()
    const backup = createSeedState()
    current.tasks[0].title = 'После импорта'
    backup.tasks[0].title = 'До импорта'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
    localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify(backup))

    render(<AppProvider><SyncHarness /></AppProvider>)
    await screen.findByRole('button', { name: 'restore' })
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === STORAGE_KEY && value.includes('До импорта')) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    })

    fireEvent.click(screen.getByRole('button', { name: 'restore' }))

    await waitFor(() => expect(screen.getByLabelText('sync message')).toHaveTextContent('Не удалось восстановить локальную копию'))
    expect(screen.getByText('После импорта')).toBeInTheDocument()
    setItem.mockRestore()
  })
})
