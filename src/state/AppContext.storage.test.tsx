import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '../core/storage/StorageAdapter'
import { createRemoteEnvelope } from '../core/sync/RemoteSnapshot'
import { taskDraftStorageKey } from '../core/storage/TaskDraftStorage'
import type { SyncAdapter } from '../core/sync/SyncAdapter'
import { SyncProviderRegistry } from '../core/sync/SyncProviderRegistry'
import type { AppState, Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { AppProvider, useApp } from './AppContext'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

interface PendingWrite {
  kind: 'save' | 'replace'
  state: AppState
  resolve(): void
  reject(error: unknown): void
}

class DelayedStorageAdapter implements StorageAdapter {
  readonly writes: PendingWrite[] = []
  readonly loadResult = deferred<AppState | null>()
  persistedState?: AppState
  activeWrites = 0
  maxActiveWrites = 0
  loadCalls = 0

  async load() {
    this.loadCalls += 1
    return this.loadResult.promise
  }

  async loadImportBackup() {
    return null
  }

  save(state: AppState) {
    return this.enqueue('save', state)
  }

  replaceWithBackup(state: AppState) {
    return this.enqueue('replace', state)
  }

  async restoreImportBackup() {
    return null
  }

  async clear() {}

  private enqueue(kind: PendingWrite['kind'], state: AppState) {
    const result = deferred<void>()
    this.activeWrites += 1
    this.maxActiveWrites = Math.max(this.maxActiveWrites, this.activeWrites)
    this.writes.push({
      kind,
      state,
      resolve: () => result.resolve(undefined),
      reject: result.reject,
    })
    return result.promise.then(() => {
      this.persistedState = state
    }).finally(() => {
      this.activeWrites -= 1
    })
  }
}

const taskTemplate = createSeedState().tasks[0]

function addedTask(id: string, title: string): Task {
  const now = new Date().toISOString()
  return { ...taskTemplate, id, title, createdAt: now, updatedAt: now }
}

function StorageHarness() {
  const {
    state,
    addTask,
    importLocalBackup,
    persistState,
    pullFromSyncProvider,
    resetDemo,
    resolveSyncConflict,
    syncConflict,
    updateSettings,
  } = useApp()
  const [resetResult, setResetResult] = useState('')
  const [persistResult, setPersistResult] = useState('')
  return (
    <div>
      <output aria-label="task titles">{state.tasks.map((task) => task.title).join('|')}</output>
      <output aria-label="auto sync">{String(state.settings.autoSync)}</output>
      <output aria-label="sync status">{state.sync.status}</output>
      <button type="button" onClick={() => addTask(addedTask('first', 'first revision'))}>add first</button>
      <button type="button" onClick={() => addTask(addedTask('second', 'second revision'))}>add second</button>
      <button type="button" onClick={() => addTask(addedTask('third', 'third revision'))}>add third</button>
      <button type="button" onClick={() => void importLocalBackup({ ...createSeedState(), tasks: [addedTask('imported', 'imported revision')] }).catch(() => undefined)}>import local</button>
      <button
        type="button"
        onClick={() => void resetDemo().then(
          () => setResetResult('reset complete'),
          () => setResetResult('reset failed'),
        )}
      >reset</button>
      <button
        type="button"
        onClick={() => void persistState().then(
          () => setPersistResult('persist complete'),
          () => setPersistResult('persist failed'),
        )}
      >persist</button>
      <button type="button" onClick={() => void pullFromSyncProvider()}>pull</button>
      <button type="button" onClick={() => void resolveSyncConflict('remote')}>choose remote</button>
      <button type="button" onClick={() => updateSettings({ autoSync: !state.settings.autoSync })}>toggle auto sync</button>
      <output aria-label="reset result">{resetResult}</output>
      <output aria-label="persist result">{persistResult}</output>
      {syncConflict && <div role="alert">sync conflict</div>}
    </div>
  )
}

function loadedState(): AppState {
  const state = createSeedState()
  return {
    ...state,
    tasks: [addedTask('loaded', 'loaded from injected adapter')],
  }
}

function PermanentRemovalHarness() {
  const { state, permanentlyRemoveTask, updatePomodoro } = useApp()
  const taskId = state.tasks[0]?.id
  return (
    <div>
      <output aria-label="first task id">{taskId ?? ''}</output>
      <output aria-label="pomodoro task id">{state.pomodoro.taskId ?? ''}</output>
      <button type="button" disabled={!taskId} onClick={() => taskId && updatePomodoro({ taskId })}>bind pomodoro</button>
      <button type="button" disabled={!taskId} onClick={() => taskId && permanentlyRemoveTask(taskId)}>remove permanently</button>
    </div>
  )
}

describe('AppProvider storage persistence', () => {
  it('clears a Pomodoro task reference when that task is permanently removed', async () => {
    render(
      <AppProvider>
        <PermanentRemovalHarness />
      </AppProvider>,
    )
    const taskId = (await screen.findByLabelText('first task id')).textContent
    expect(taskId).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'bind pomodoro' }))
    expect(screen.getByLabelText('pomodoro task id')).toHaveTextContent(taskId!)
    localStorage.setItem(taskDraftStorageKey(taskId!), 'task draft')
    localStorage.setItem(taskDraftStorageKey('other-task'), 'other draft')
    fireEvent.click(screen.getByRole('button', { name: 'remove permanently' }))

    expect(screen.getByLabelText('first task id')).not.toHaveTextContent(taskId!)
    expect(screen.getByLabelText('pomodoro task id')).toBeEmptyDOMElement()
    expect(localStorage.getItem(taskDraftStorageKey(taskId!))).toBeNull()
    expect(localStorage.getItem(taskDraftStorageKey('other-task'))).toBe('other draft')
  })

  it('leaves storage untouched when the injected adapter cannot finish loading', async () => {
    const adapter = new DelayedStorageAdapter()

    render(
      <AppProvider storageAdapter={adapter}>
        <StorageHarness />
      </AppProvider>,
    )
    adapter.loadResult.reject(new Error('read failed'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Snapshot оставлен без изменений')
    expect(screen.queryByLabelText('task titles')).not.toBeInTheDocument()
    expect(adapter.writes).toHaveLength(0)
  })

  it('uses the injected adapter and never writes the seed before loading resolves', async () => {
    const adapter = new DelayedStorageAdapter()

    render(
      <AppProvider storageAdapter={adapter}>
        <StorageHarness />
      </AppProvider>,
    )

    expect(screen.queryByLabelText('task titles')).not.toBeInTheDocument()
    expect(adapter.writes).toHaveLength(0)

    adapter.loadResult.resolve(loadedState())

    expect(await screen.findByLabelText('task titles')).toHaveTextContent('loaded from injected adapter')
    await waitFor(() => expect(adapter.writes).toHaveLength(1))
    expect(adapter.writes[0].kind).toBe('save')
    expect(adapter.writes[0].state.tasks).toHaveLength(1)
    expect(adapter.writes[0].state.tasks[0].title).toBe('loaded from injected adapter')
    adapter.writes[0].resolve()
  })

  it('keeps the adapter captured at mount when the prop changes without a remount', async () => {
    const firstAdapter = new DelayedStorageAdapter()
    const replacementAdapter = new DelayedStorageAdapter()
    firstAdapter.loadResult.resolve(loadedState())
    replacementAdapter.loadResult.resolve(createSeedState())

    const view = render(
      <AppProvider storageAdapter={firstAdapter}>
        <StorageHarness />
      </AppProvider>,
    )
    await screen.findByLabelText('task titles')
    await waitFor(() => expect(firstAdapter.writes).toHaveLength(1))
    firstAdapter.writes[0].resolve()
    await waitFor(() => expect(firstAdapter.activeWrites).toBe(0))

    view.rerender(
      <AppProvider storageAdapter={replacementAdapter}>
        <StorageHarness />
      </AppProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'add first' }))

    await waitFor(() => expect(firstAdapter.writes).toHaveLength(2))
    expect(firstAdapter.loadCalls).toBe(1)
    expect(replacementAdapter.loadCalls).toBe(0)
    expect(replacementAdapter.writes).toHaveLength(0)
    firstAdapter.writes[1].resolve()
  })

  it('serializes delayed saves and persists the newest coalesced revision last', async () => {
    const adapter = new DelayedStorageAdapter()
    adapter.loadResult.resolve(loadedState())

    render(
      <AppProvider storageAdapter={adapter}>
        <StorageHarness />
      </AppProvider>,
    )

    await screen.findByLabelText('task titles')
    await waitFor(() => expect(adapter.writes).toHaveLength(1))
    adapter.writes[0].resolve()
    await waitFor(() => expect(adapter.activeWrites).toBe(0))

    fireEvent.click(screen.getByRole('button', { name: 'add first' }))
    await waitFor(() => expect(adapter.writes).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: 'add second' }))
    fireEvent.click(screen.getByRole('button', { name: 'add third' }))
    expect(screen.getByLabelText('task titles')).toHaveTextContent('third revision')
    expect(adapter.writes).toHaveLength(2)

    adapter.writes[1].resolve()
    await waitFor(() => expect(adapter.writes).toHaveLength(3))
    expect(adapter.writes[2].kind).toBe('save')
    expect(adapter.writes[2].state.tasks.map((task) => task.id)).toEqual([
      'third',
      'second',
      'first',
      'loaded',
    ])
    adapter.writes[2].resolve()

    await waitFor(() => expect(adapter.persistedState?.tasks[0].id).toBe('third'))
    expect(adapter.maxActiveWrites).toBe(1)
  })

  it('orders an explicit reset after an in-flight normal save and surfaces persistence failure', async () => {
    const adapter = new DelayedStorageAdapter()
    adapter.loadResult.resolve(loadedState())

    render(
      <AppProvider storageAdapter={adapter}>
        <StorageHarness />
      </AppProvider>,
    )

    await screen.findByLabelText('task titles')
    await waitFor(() => expect(adapter.writes).toHaveLength(1))
    adapter.writes[0].resolve()
    await waitFor(() => expect(adapter.activeWrites).toBe(0))

    fireEvent.click(screen.getByRole('button', { name: 'add first' }))
    await waitFor(() => expect(adapter.writes).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))

    expect(adapter.writes.filter((write) => write.kind === 'replace')).toHaveLength(0)
    adapter.writes[1].resolve()
    await waitFor(() => expect(adapter.writes).toHaveLength(3))
    expect(adapter.writes[2].kind).toBe('replace')

    adapter.writes[2].reject(new Error('quota'))

    expect(await screen.findByLabelText('reset result')).toHaveTextContent('reset failed')
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить локальные изменения')
    expect(screen.getByLabelText('task titles')).toHaveTextContent('first revision')
    expect(adapter.maxActiveWrites).toBe(1)
  })

  it('supersedes UI saves made during a successful authoritative replacement', async () => {
    const adapter = new DelayedStorageAdapter()
    adapter.loadResult.resolve(loadedState())

    render(
      <AppProvider storageAdapter={adapter}>
        <StorageHarness />
      </AppProvider>,
    )

    await screen.findByLabelText('task titles')
    await waitFor(() => expect(adapter.writes).toHaveLength(1))
    adapter.writes[0].resolve()
    await waitFor(() => expect(adapter.activeWrites).toBe(0))

    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    await waitFor(() => expect(adapter.writes).toHaveLength(2))
    expect(adapter.writes[1].kind).toBe('replace')

    fireEvent.click(screen.getByRole('button', { name: 'add first' }))
    fireEvent.click(screen.getByRole('button', { name: 'persist' }))
    expect(screen.getByLabelText('task titles')).toHaveTextContent('first revision')
    expect(adapter.writes).toHaveLength(2)

    adapter.writes[1].resolve()

    await waitFor(() => expect(screen.getByLabelText('reset result')).toHaveTextContent('reset complete'))
    await waitFor(() => expect(screen.getByLabelText('persist result')).toHaveTextContent('persist complete'))
    expect(screen.getByLabelText('task titles')).not.toHaveTextContent('first revision')
    expect(adapter.persistedState?.tasks.some((task) => task.id === 'first')).toBe(false)
    expect(adapter.writes).toHaveLength(2)
    expect(adapter.maxActiveWrites).toBe(1)
  })

  it('persists the latest UI mutation when an authoritative replacement fails', async () => {
    const adapter = new DelayedStorageAdapter()
    adapter.loadResult.resolve(loadedState())

    render(
      <AppProvider storageAdapter={adapter}>
        <StorageHarness />
      </AppProvider>,
    )

    await screen.findByLabelText('task titles')
    await waitFor(() => expect(adapter.writes).toHaveLength(1))
    adapter.writes[0].resolve()
    await waitFor(() => expect(adapter.activeWrites).toBe(0))

    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    await waitFor(() => expect(adapter.writes).toHaveLength(2))
    expect(adapter.writes[1].kind).toBe('replace')

    fireEvent.click(screen.getByRole('button', { name: 'add first' }))
    fireEvent.click(screen.getByRole('button', { name: 'persist' }))
    adapter.writes[1].reject(new Error('replace failed'))

    await waitFor(() => expect(adapter.writes).toHaveLength(3))
    expect(adapter.writes[2].kind).toBe('save')
    expect(adapter.writes[2].state.tasks[0].id).toBe('first')
    expect(screen.getByLabelText('reset result')).toHaveTextContent('')
    expect(screen.getByLabelText('persist result')).toHaveTextContent('')
    adapter.writes[2].resolve()

    await waitFor(() => expect(screen.getByLabelText('reset result')).toHaveTextContent('reset failed'))
    await waitFor(() => expect(screen.getByLabelText('persist result')).toHaveTextContent('persist complete'))
    expect(screen.getByLabelText('task titles')).toHaveTextContent('first revision')
    expect(adapter.persistedState?.tasks[0].id).toBe('first')
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить локальные изменения')
    expect(adapter.maxActiveWrites).toBe(1)
  })

  it('restores a local mutation made while an accepted remote replacement is writing', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'delayed-local-replace',
      name: 'Delayed local replacement',
      description: 'Test provider',
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const local = loadedState()
    local.settings.syncProvider = descriptor.id
    local.settings.autoSync = false
    local.sync = {
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
      providerId: descriptor.id,
    }
    const remote = createSeedState()
    remote.tasks = [addedTask('remote', 'remote replacement')]
    const head = { id: 'remote-file', revision: '2' }
    const syncAdapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValue(head),
      download: vi.fn().mockResolvedValue({ head, payload: createRemoteEnvelope(remote) }),
      upload: vi.fn(),
    }
    const storageAdapter = new DelayedStorageAdapter()
    storageAdapter.loadResult.resolve(local)

    render(
      <AppProvider
        storageAdapter={storageAdapter}
        syncRegistry={new SyncProviderRegistry([{
          descriptor,
          createRuntime: () => ({
            acquireAdapter: async () => syncAdapter,
            disconnect: async () => undefined,
          }),
        }])}
      >
        <StorageHarness />
      </AppProvider>,
    )

    await screen.findByLabelText('task titles')
    await waitFor(() => expect(storageAdapter.writes).toHaveLength(1))
    storageAdapter.writes[0].resolve()
    await waitFor(() => expect(storageAdapter.activeWrites).toBe(0))

    fireEvent.click(screen.getByRole('button', { name: 'pull' }))
    await screen.findByText('sync conflict')
    fireEvent.click(screen.getByRole('button', { name: 'choose remote' }))

    let writeIndex = 1
    let replacement: PendingWrite | undefined
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await waitFor(() => expect(storageAdapter.writes.length).toBeGreaterThan(writeIndex))
      const write = storageAdapter.writes[writeIndex]
      writeIndex += 1
      if (write.kind === 'replace') {
        replacement = write
        break
      }
      write.resolve()
    }
    expect(replacement?.kind).toBe('replace')

    fireEvent.click(screen.getByRole('button', { name: 'add first' }))
    expect(screen.getByLabelText('task titles')).toHaveTextContent('first revision')
    replacement?.resolve()

    await waitFor(() => expect(storageAdapter.writes.length).toBeGreaterThan(writeIndex))
    const recoverySave = storageAdapter.writes[writeIndex]
    expect(recoverySave.kind).toBe('save')
    expect(recoverySave.state.tasks[0].id).toBe('first')
    recoverySave.resolve()

    await waitFor(() => expect(storageAdapter.writes.length).toBeGreaterThan(writeIndex + 1))
    storageAdapter.writes[writeIndex + 1].resolve()
    await waitFor(() => expect(storageAdapter.activeWrites).toBe(0))
    expect(screen.getByLabelText('task titles')).toHaveTextContent('first revision')
    expect(screen.getByLabelText('task titles')).not.toHaveTextContent('remote replacement')
    expect(storageAdapter.persistedState?.tasks[0].id).toBe('first')
    expect(storageAdapter.maxActiveWrites).toBe(1)
  })

  it('clears journals only after a successful explicit dataset import', async () => {
    const adapter = new DelayedStorageAdapter()
    adapter.loadResult.resolve(loadedState())
    localStorage.setItem(taskDraftStorageKey(), 'create draft')
    localStorage.setItem(taskDraftStorageKey('loaded'), 'task draft')

    render(
      <AppProvider storageAdapter={adapter}>
        <StorageHarness />
      </AppProvider>,
    )
    await screen.findByLabelText('task titles')
    await waitFor(() => expect(adapter.writes).toHaveLength(1))
    adapter.writes[0].resolve()
    await waitFor(() => expect(adapter.activeWrites).toBe(0))

    fireEvent.click(screen.getByRole('button', { name: 'import local' }))
    await waitFor(() => expect(adapter.writes).toHaveLength(2))
    expect(adapter.writes[1].kind).toBe('replace')
    adapter.writes[1].reject(new Error('quota'))
    await waitFor(() => expect(adapter.activeWrites).toBe(0))
    expect(localStorage.getItem(taskDraftStorageKey())).toBe('create draft')
    expect(localStorage.getItem(taskDraftStorageKey('loaded'))).toBe('task draft')

    fireEvent.click(screen.getByRole('button', { name: 'import local' }))
    await waitFor(() => expect(adapter.writes).toHaveLength(3))
    expect(adapter.writes[2].kind).toBe('replace')
    adapter.writes[2].resolve()

    await waitFor(() => expect(screen.getByLabelText('task titles')).toHaveTextContent('imported revision'))
    expect(localStorage.getItem(taskDraftStorageKey())).toBeNull()
    expect(localStorage.getItem(taskDraftStorageKey('loaded'))).toBeNull()
  })

  it('preserves a local-only setting changed during remote replacement and leaves syncing state', async () => {
    const descriptor: SyncAdapter['descriptor'] = {
      id: 'delayed-local-setting-replace',
      name: 'Delayed local setting replacement',
      description: 'Test provider',
      connection: 'implicit',
      consistency: 'atomic',
      capabilities: { download: true, upload: true },
    }
    const local = loadedState()
    local.settings.syncProvider = descriptor.id
    local.settings.autoSync = false
    local.sync = {
      status: 'idle',
      connectionStatus: 'connected',
      connectionMode: 'implicit',
      providerId: descriptor.id,
    }
    const remote = createSeedState()
    remote.tasks = [addedTask('remote-setting', 'remote setting replacement')]
    const head = { id: 'remote-setting-file', revision: '2' }
    const syncAdapter: SyncAdapter = {
      descriptor,
      head: vi.fn().mockResolvedValue(head),
      download: vi.fn().mockResolvedValue({ head, payload: createRemoteEnvelope(remote) }),
      upload: vi.fn(),
    }
    const storageAdapter = new DelayedStorageAdapter()
    storageAdapter.loadResult.resolve(local)

    render(
      <AppProvider
        storageAdapter={storageAdapter}
        syncRegistry={new SyncProviderRegistry([{
          descriptor,
          createRuntime: () => ({
            acquireAdapter: async () => syncAdapter,
            disconnect: async () => undefined,
          }),
        }])}
      >
        <StorageHarness />
      </AppProvider>,
    )

    await screen.findByLabelText('task titles')
    await waitFor(() => expect(storageAdapter.writes).toHaveLength(1))
    storageAdapter.writes[0].resolve()
    await waitFor(() => expect(storageAdapter.activeWrites).toBe(0))

    fireEvent.click(screen.getByRole('button', { name: 'pull' }))
    await screen.findByText('sync conflict')
    fireEvent.click(screen.getByRole('button', { name: 'choose remote' }))

    let writeIndex = 1
    let replacement: PendingWrite | undefined
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await waitFor(() => expect(storageAdapter.writes.length).toBeGreaterThan(writeIndex))
      const write = storageAdapter.writes[writeIndex]
      writeIndex += 1
      if (write.kind === 'replace') {
        replacement = write
        break
      }
      write.resolve()
    }
    expect(replacement?.kind).toBe('replace')

    fireEvent.click(screen.getByRole('button', { name: 'toggle auto sync' }))
    expect(screen.getByLabelText('auto sync')).toHaveTextContent('true')
    replacement?.resolve()

    await waitFor(() => expect(storageAdapter.writes.length).toBeGreaterThan(writeIndex))
    const recoverySave = storageAdapter.writes[writeIndex]
    expect(recoverySave.kind).toBe('save')
    expect(recoverySave.state.settings.autoSync).toBe(true)
    recoverySave.resolve()

    await waitFor(() => expect(storageAdapter.writes.length).toBeGreaterThan(writeIndex + 1))
    const statusSave = storageAdapter.writes[writeIndex + 1]
    expect(statusSave.kind).toBe('save')
    expect(statusSave.state.settings.autoSync).toBe(true)
    expect(statusSave.state.sync.status).not.toBe('syncing')
    statusSave.resolve()

    await waitFor(() => expect(storageAdapter.activeWrites).toBe(0))
    expect(screen.getByLabelText('auto sync')).toHaveTextContent('true')
    expect(screen.getByLabelText('sync status')).not.toHaveTextContent('syncing')
    expect(screen.getByLabelText('task titles')).not.toHaveTextContent('remote setting replacement')
    expect(storageAdapter.persistedState?.settings.autoSync).toBe(true)
    expect(storageAdapter.persistedState?.sync.status).not.toBe('syncing')
    expect(storageAdapter.maxActiveWrites).toBe(1)
  })

  it('handles a delayed write rejection after unmount without an unhandled promise', async () => {
    const adapter = new DelayedStorageAdapter()
    adapter.loadResult.resolve(loadedState())
    const unhandledRejection = vi.fn()
    window.addEventListener('unhandledrejection', unhandledRejection)

    const view = render(
      <AppProvider storageAdapter={adapter}>
        <StorageHarness />
      </AppProvider>,
    )
    await screen.findByLabelText('task titles')
    await waitFor(() => expect(adapter.writes).toHaveLength(1))
    view.unmount()

    adapter.writes[0].reject(new Error('late failure'))
    await waitFor(() => expect(adapter.activeWrites).toBe(0))
    await Promise.resolve()

    expect(unhandledRejection).not.toHaveBeenCalled()
    window.removeEventListener('unhandledrejection', unhandledRejection)
  })
})
