import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteEnvelope, syncableHash } from '../core/sync/RemoteSnapshot'
import { SyncProviderError, type RemoteHead, type RemoteSnapshot, type SyncAdapter, type SyncProviderDefinition } from '../core/sync/SyncAdapter'
import { SyncProviderRegistry } from '../core/sync/SyncProviderRegistry'
import { createSeedState } from '../domain/seed'
import { AppProvider, useApp } from './AppContext'

const STORAGE_KEY = 'focus-flow.state.v1'
const IMPORT_BACKUP_KEY = 'focus-flow.state.v1.import-backup'
const CREATE_DRAFT_KEY = 'focus-flow.task-draft.v1:create'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function SyncHarness() {
  const [resetError, setResetError] = useState('')
  const {
    state,
    addTask,
    connectSyncProvider,
    pullFromSyncProvider,
    pushToSyncProvider,
    syncNow,
    syncConflict,
    resolveSyncConflict,
    resetDemo,
    restoreImportBackup,
    updateSyncProviderConfig,
  } = useApp()
  return (
    <div>
      <button type="button" onClick={() => void connectSyncProvider()}>connect</button>
      <button type="button" onClick={() => void pullFromSyncProvider()}>pull</button>
      <button type="button" onClick={() => void pushToSyncProvider()}>push</button>
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
      <button type="button" onClick={() => { void resetDemo().then(() => setResetError(''), (error: unknown) => setResetError(error instanceof Error ? error.message : 'reset failed')) }}>reset</button>
      <button type="button" onClick={() => void restoreImportBackup()}>restore</button>
      <button type="button" onClick={() => updateSyncProviderConfig('endpoint', 'https://new.example.test')}>config</button>
      <button type="button" onClick={() => void resolveSyncConflict('remote')}>choose remote</button>
      <button type="button" onClick={() => void resolveSyncConflict('local')}>choose local</button>
      <output>{state.sync.status}</output>
      <output aria-label="sync message">{state.sync.message}</output>
      <output aria-label="sync metadata">{JSON.stringify({
        remoteId: state.sync.remoteId,
        remoteRevision: state.sync.remoteRevision,
        lastSyncedHash: state.sync.lastSyncedHash,
        lastSyncedAt: state.sync.lastSyncedAt,
      })}</output>
      <output aria-label="reset error">{resetError}</output>
      {syncConflict && <div role="alert">conflict</div>}
      <ul>{state.tasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul>
    </div>
  )
}

describe('AppProvider synchronization races', () => {
  it('authorizes an interactive provider without reading or writing remote data', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'interactive-storage',
      name: 'Interactive storage',
      description: 'Test provider',
      connection: 'interactive',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const adapter: SyncAdapter = {
      descriptor,
      head: vi.fn(),
      download: vi.fn(),
      upload: vi.fn(),
    }
    const acquireAdapter = vi.fn().mockResolvedValue(adapter)
    const local = createSeedState()
    local.settings.syncProvider = descriptor.id
    local.settings.autoSync = false
    local.sync = {
      status: 'idle',
      connectionStatus: 'disconnected',
      connectionMode: 'interactive',
      providerId: descriptor.id,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{
        descriptor,
        createRuntime: () => ({ acquireAdapter, disconnect: async () => undefined }),
      }])}>
        <SyncHarness />
      </AppProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'connect' }))

    await waitFor(() => expect(screen.getByLabelText('sync message')).toHaveTextContent('Выберите действие с данными'))
    expect(acquireAdapter).toHaveBeenCalledWith({ interactive: true, resume: false })
    expect(adapter.head).not.toHaveBeenCalled()
    expect(adapter.download).not.toHaveBeenCalled()
    expect(adapter.upload).not.toHaveBeenCalled()
  })

  it('pull leaves local data and metadata untouched when no remote copy exists', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'empty-storage',
      name: 'Empty storage',
      description: 'Test provider',
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const adapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValue(null),
      download: vi.fn(),
      upload: vi.fn(),
    }
    const local = createSeedState()
    local.settings.syncProvider = descriptor.id
    local.settings.autoSync = false
    local.tasks[0].title = 'Локальная задача остаётся'
    local.sync = {
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
      providerId: descriptor.id,
      remoteId: 'previous-file',
      remoteRevision: 'previous-revision',
      lastSyncedHash: 'previous-hash',
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{
        descriptor,
        createRuntime: () => ({ acquireAdapter: async () => adapter, disconnect: async () => undefined }),
      }])}>
        <SyncHarness />
      </AppProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'pull' }))

    await waitFor(() => expect(screen.getByLabelText('sync message')).toHaveTextContent('пока нет удалённой копии'))
    expect(screen.getByText('Локальная задача остаётся')).toBeInTheDocument()
    expect(screen.getByLabelText('sync metadata')).toHaveTextContent('previous-revision')
    expect(adapter.download).not.toHaveBeenCalled()
    expect(adapter.upload).not.toHaveBeenCalled()
  })

  it('pull previews a different remote copy and applies it only after confirmation with backup', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'pull-storage',
      name: 'Pull storage',
      description: 'Test provider',
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const local = createSeedState()
    local.settings.syncProvider = descriptor.id
    local.settings.autoSync = false
    local.tasks[0].title = 'Локальная версия до получения'
    local.sync = {
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
      providerId: descriptor.id,
    }
    const remote = createSeedState()
    remote.tasks[0].title = 'Удалённая версия после получения'
    const head = { id: 'pull-file', revision: '5' }
    const adapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValue(head),
      download: vi.fn().mockResolvedValue({ head, payload: createRemoteEnvelope(remote) }),
      upload: vi.fn(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{
        descriptor,
        createRuntime: () => ({ acquireAdapter: async () => adapter, disconnect: async () => undefined }),
      }])}>
        <SyncHarness />
      </AppProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'pull' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('conflict')
    expect(screen.getByText('Локальная версия до получения')).toBeInTheDocument()
    expect(screen.queryByText('Удалённая версия после получения')).not.toBeInTheDocument()
    expect(localStorage.getItem(IMPORT_BACKUP_KEY)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'choose local' }))
    await waitFor(() => expect(screen.getByLabelText('sync message')).toHaveTextContent('Во время получения'))
    expect(screen.getByRole('alert')).toHaveTextContent('conflict')
    expect(adapter.upload).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'choose remote' }))

    expect(await screen.findByText('Удалённая версия после получения')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(IMPORT_BACKUP_KEY)!).tasks[0].title).toBe('Локальная версия до получения')
    expect(adapter.upload).not.toHaveBeenCalled()
  })

  it('pull rejects a damaged remote copy without changing local data or creating a backup', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'damaged-pull-storage',
      name: 'Damaged storage',
      description: 'Test provider',
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const local = createSeedState()
    local.settings.syncProvider = descriptor.id
    local.settings.autoSync = false
    local.tasks[0].title = 'Неповреждённая локальная задача'
    local.sync = { status: 'idle', connectionStatus: 'connected', connectionMode: 'implicit', providerId: descriptor.id }
    const head = { id: 'damaged-file', revision: '2' }
    const adapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValue(head),
      download: vi.fn().mockResolvedValue({ head, payload: { broken: true } }),
      upload: vi.fn(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{
        descriptor,
        createRuntime: () => ({ acquireAdapter: async () => adapter, disconnect: async () => undefined }),
      }])}>
        <SyncHarness />
      </AppProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'pull' }))

    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument())
    expect(screen.getByText('Неповреждённая локальная задача')).toBeInTheDocument()
    expect(localStorage.getItem(IMPORT_BACKUP_KEY)).toBeNull()
    expect(adapter.upload).not.toHaveBeenCalled()
  })

  it('pull asks for confirmation again when the remote revision changes after preview', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'changing-pull-storage',
      name: 'Changing storage',
      description: 'Test provider',
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const local = createSeedState()
    local.settings.syncProvider = descriptor.id
    local.settings.autoSync = false
    local.tasks[0].title = 'Локальная версия'
    local.sync = { status: 'idle', connectionStatus: 'connected', connectionMode: 'implicit', providerId: descriptor.id }
    const firstRemote = createSeedState()
    firstRemote.tasks[0].title = 'Первая удалённая версия'
    const latestRemote = createSeedState()
    latestRemote.tasks[0].title = 'Новая удалённая версия'
    const firstHead = { id: 'changing-file', revision: '1' }
    const latestHead = { id: 'changing-file', revision: '2' }
    const adapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValueOnce(firstHead).mockResolvedValue(latestHead),
      download: vi.fn()
        .mockResolvedValueOnce({ head: firstHead, payload: createRemoteEnvelope(firstRemote) })
        .mockResolvedValueOnce({ head: latestHead, payload: createRemoteEnvelope(latestRemote) }),
      upload: vi.fn(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{
        descriptor,
        createRuntime: () => ({ acquireAdapter: async () => adapter, disconnect: async () => undefined }),
      }])}>
        <SyncHarness />
      </AppProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'pull' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'choose remote' }))

    await waitFor(() => expect(screen.getByLabelText('sync message')).toHaveTextContent('проверьте её ещё раз'))
    expect(screen.getByText('Локальная версия')).toBeInTheDocument()
    expect(screen.queryByText('Первая удалённая версия')).not.toBeInTheDocument()
    expect(screen.queryByText('Новая удалённая версия')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'choose remote' }))
    expect(await screen.findByText('Новая удалённая версия')).toBeInTheDocument()
    expect(adapter.upload).not.toHaveBeenCalled()
  })

  it('pull does not overwrite a local edit made while confirmed remote data is revalidated', async () => {
    const confirmationHead = deferred<RemoteHead | null>()
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'confirming-pull-storage',
      name: 'Confirming storage',
      description: 'Test provider',
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const local = createSeedState()
    local.settings.syncProvider = descriptor.id
    local.settings.autoSync = false
    local.sync = { status: 'idle', connectionStatus: 'connected', connectionMode: 'implicit', providerId: descriptor.id }
    const remote = createSeedState()
    remote.tasks[0].title = 'Удалённая версия для подтверждения'
    const head = { id: 'confirming-file', revision: '1' }
    const adapter: SyncAdapter = {
      descriptor,
      head: vi.fn()
        .mockResolvedValueOnce(head)
        .mockImplementationOnce(() => confirmationHead.promise)
        .mockResolvedValue(head),
      download: vi.fn().mockResolvedValue({ head, payload: createRemoteEnvelope(remote) }),
      upload: vi.fn(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{
        descriptor,
        createRuntime: () => ({ acquireAdapter: async () => adapter, disconnect: async () => undefined }),
      }])}>
        <SyncHarness />
      </AppProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'pull' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'choose remote' }))
    await waitFor(() => expect(adapter.head).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'mutate' }))
    confirmationHead.resolve(head)

    await waitFor(() => expect(screen.getByLabelText('sync message')).toHaveTextContent('проверьте выбор ещё раз'))
    expect(screen.getByText('Создано во время загрузки')).toBeInTheDocument()
    expect(screen.queryByText('Удалённая версия для подтверждения')).not.toBeInTheDocument()
    expect(localStorage.getItem(IMPORT_BACKUP_KEY)).toBeNull()
  })

  it('push creates an absent remote copy with an absence precondition and never downloads', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'push-empty-storage',
      name: 'Push storage',
      description: 'Test provider',
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const upload = vi.fn().mockResolvedValue({ id: 'created-file', revision: '1' })
    const adapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValue(null),
      download: vi.fn(),
      upload,
    }
    const local = createSeedState()
    local.settings.syncProvider = descriptor.id
    local.settings.autoSync = false
    local.sync = { status: 'idle', connectionStatus: 'connected', connectionMode: 'implicit', providerId: descriptor.id }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{
        descriptor,
        createRuntime: () => ({ acquireAdapter: async () => adapter, disconnect: async () => undefined }),
      }])}>
        <SyncHarness />
      </AppProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'push' }))

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect(upload.mock.calls[0][1]).toEqual({ expectedRevision: null })
    expect(adapter.download).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('success')).toBeInTheDocument())
  })

  it('push previews an unknown remote copy and overwrites it only after confirmation', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'push-existing-storage',
      name: 'Push existing storage',
      description: 'Test provider',
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const local = createSeedState()
    local.settings.syncProvider = descriptor.id
    local.settings.autoSync = false
    local.tasks[0].title = 'Локальная копия для отправки'
    local.sync = { status: 'idle', connectionStatus: 'connected', connectionMode: 'implicit', providerId: descriptor.id }
    const remote = createSeedState()
    remote.tasks[0].title = 'Неизвестная удалённая копия'
    const head = { id: 'existing-file', revision: '9' }
    const upload = vi.fn().mockResolvedValue({ id: 'existing-file', revision: '10' })
    const adapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValue(head),
      download: vi.fn().mockResolvedValue({ head, payload: createRemoteEnvelope(remote) }),
      upload,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{
        descriptor,
        createRuntime: () => ({ acquireAdapter: async () => adapter, disconnect: async () => undefined }),
      }])}>
        <SyncHarness />
      </AppProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'push' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('conflict')
    expect(upload).not.toHaveBeenCalled()
    expect(screen.getByText('Локальная копия для отправки')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'choose remote' }))
    await waitFor(() => expect(screen.getByLabelText('sync message')).toHaveTextContent('Во время отправки'))
    expect(screen.getByRole('alert')).toHaveTextContent('conflict')
    expect(screen.getByText('Локальная копия для отправки')).toBeInTheDocument()
    expect(localStorage.getItem(IMPORT_BACKUP_KEY)).toBeNull()
    expect(upload).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'choose local' }))

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect(upload.mock.calls[0][1]).toEqual({ expectedRevision: '9' })
    expect(JSON.stringify(upload.mock.calls[0][0])).toContain('Локальная копия для отправки')
    await waitFor(() => expect(screen.getByText('success')).toBeInTheDocument())
  })

  it('push updates a known unchanged remote revision without downloading it', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'known-push-storage',
      name: 'Known push storage',
      description: 'Test provider',
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const local = createSeedState()
    const baseHash = syncableHash(local)
    local.settings.syncProvider = descriptor.id
    local.settings.autoSync = false
    local.tasks[0].title = 'Новая локальная правка'
    local.sync = {
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
      providerId: descriptor.id,
      remoteId: 'known-file',
      remoteRevision: '3',
      lastSyncedHash: baseHash,
    }
    const upload = vi.fn().mockResolvedValue({ id: 'known-file', revision: '4' })
    const adapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValue({ id: 'known-file', revision: '3' }),
      download: vi.fn(),
      upload,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([{
        descriptor,
        createRuntime: () => ({ acquireAdapter: async () => adapter, disconnect: async () => undefined }),
      }])}>
        <SyncHarness />
      </AppProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'push' }))

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect(upload.mock.calls[0][1]).toEqual({ expectedRevision: '3' })
    expect(adapter.download).not.toHaveBeenCalled()
  })

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

  it('does not queue a different explicit direction while another operation is in flight', async () => {
    const download = deferred<RemoteSnapshot | null>()
    const local = createSeedState()
    local.settings.syncProvider = 'one-direction-at-a-time'
    local.settings.autoSync = false
    local.sync = {
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
      providerId: 'one-direction-at-a-time',
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
    const head = { id: 'remote-file', revision: '1' }
    const adapter: SyncAdapter = {
      descriptor: {
        id: 'one-direction-at-a-time',
        name: 'One direction at a time',
        description: 'Test provider',
        connection: 'implicit',
        consistency: 'atomic',
        capabilities: { download: true, upload: true },
      },
      head: vi.fn().mockResolvedValue(head),
      download: vi.fn(() => download.promise),
      upload: vi.fn(),
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

    fireEvent.click(await screen.findByRole('button', { name: 'pull' }))
    await waitFor(() => expect(adapter.download).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'push' }))
    download.resolve({ head, payload: createRemoteEnvelope(local) })

    await waitFor(() => expect(screen.getByText('success')).toBeInTheDocument())
    expect(adapter.head).toHaveBeenCalledTimes(1)
    expect(adapter.upload).not.toHaveBeenCalled()
  })

  it('does not restore an import backup while synchronization is in flight', async () => {
    const download = deferred<RemoteSnapshot | null>()
    const local = createSeedState()
    local.tasks[0].title = 'Текущая версия во время sync'
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
    const rollback = createSeedState()
    rollback.tasks[0].title = 'Rollback не должен примениться'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
    localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify(rollback))
    const disconnect = vi.fn().mockResolvedValue(undefined)
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

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([definition])}>
        <SyncHarness />
      </AppProvider>,
    )

    await screen.findByRole('button', { name: 'sync' })
    fireEvent.click(screen.getByRole('button', { name: 'sync' }))
    await waitFor(() => expect(adapter.download).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'restore' }))

    expect(screen.getByText('Текущая версия во время sync')).toBeInTheDocument()
    expect(screen.queryByText('Rollback не должен примениться')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('Текущая версия во время sync')
    expect(disconnect).not.toHaveBeenCalled()

    download.resolve({
      head: { id: 'remote-file', revision: '2' },
      payload: createRemoteEnvelope(local),
    })
    await waitFor(() => expect(screen.getByText('success')).toBeInTheDocument())
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

  it('rejects reset while a slow synchronization is in flight without cancelling or mutating it', async () => {
    const download = deferred<RemoteSnapshot | null>()
    const local = createSeedState()
    local.settings.syncProvider = 'slow-storage'
    local.settings.autoSync = false
    local.tasks[0].title = 'Локальные данные во время синхронизации'
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
    const disconnect = vi.fn()
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
    remote.tasks[0].title = 'Удалённые данные после синхронизации'

    render(
      <AppProvider syncRegistry={new SyncProviderRegistry([definition])}>
        <SyncHarness />
      </AppProvider>,
    )

    await screen.findByRole('button', { name: 'sync' })
    fireEvent.click(screen.getByRole('button', { name: 'sync' }))
    await waitFor(() => expect(adapter.download).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))

    await waitFor(() => expect(screen.getByLabelText('reset error')).toHaveTextContent('Дождитесь завершения синхронизации перед сбросом'))
    expect(disconnect).not.toHaveBeenCalled()
    expect(screen.getByText('Локальные данные во время синхронизации')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('Локальные данные во время синхронизации')
    expect(localStorage.getItem(IMPORT_BACKUP_KEY)).toBeNull()

    download.resolve({
      head: { id: 'remote-file', revision: '2' },
      payload: createRemoteEnvelope(remote),
    })

    await screen.findByText('Удалённые данные после синхронизации')
  })

  it('resets through a transactional replacement and can restore the pre-reset copy', async () => {
    const current = createSeedState()
    current.tasks[0].title = 'Пользовательские данные до сброса'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))

    render(<AppProvider><SyncHarness /></AppProvider>)
    await screen.findByText('Пользовательские данные до сброса')
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))

    await screen.findByText('Подготовить план недели')
    expect(JSON.parse(localStorage.getItem(IMPORT_BACKUP_KEY)!).tasks[0].title).toBe('Пользовательские данные до сброса')

    fireEvent.click(screen.getByRole('button', { name: 'restore' }))
    await screen.findByText('Пользовательские данные до сброса')
  })

  it('keeps current data and the previous import backup when reset persistence fails', async () => {
    const current = createSeedState()
    const previousBackup = createSeedState()
    current.tasks[0].title = 'Данные, которые нельзя потерять'
    previousBackup.tasks[0].title = 'Существующая копия отмены'
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
    localStorage.setItem(IMPORT_BACKUP_KEY, JSON.stringify(previousBackup))
    localStorage.setItem(CREATE_DRAFT_KEY, '{"draft":true}')

    render(<AppProvider><SyncHarness /></AppProvider>)
    await screen.findByText('Данные, которые нельзя потерять')
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === STORAGE_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    })

    fireEvent.click(screen.getByRole('button', { name: 'reset' }))

    await waitFor(() => expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String)))
    expect(screen.getByText('Данные, которые нельзя потерять')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tasks[0].title).toBe('Данные, которые нельзя потерять')
    expect(JSON.parse(localStorage.getItem(IMPORT_BACKUP_KEY)!).tasks[0].title).toBe('Существующая копия отмены')
    expect(localStorage.getItem(CREATE_DRAFT_KEY)).toBe('{"draft":true}')
    setItem.mockRestore()
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
