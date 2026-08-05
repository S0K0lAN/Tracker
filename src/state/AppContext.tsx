import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type { AppSettings, AppState, Habit, Project, PomodoroState, SavedFilter, Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { UnsupportedSchemaVersionError } from '../domain/migrations'
import { LocalStorageAdapter } from '../core/storage/LocalStorageAdapter'
import { AuthorizationError } from '../core/auth/AuthorizationProvider'
import {
  createRemoteEnvelope,
  decodeRemoteSnapshot,
  mergeRemoteState,
  summarizeSnapshot,
  syncableHash,
  type SnapshotSummary,
} from '../core/sync/RemoteSnapshot'
import { decideSync } from '../core/sync/SyncDecision'
import {
  SyncProviderError,
  type RemoteHead,
  type SyncProviderConfig,
  type SyncProviderDescriptor,
  type SyncProviderRuntime,
} from '../core/sync/SyncAdapter'
import { SyncProviderRegistry } from '../core/sync/SyncProviderRegistry'
import { createDefaultSyncProviderRegistry } from '../core/sync/providers'

const FONT_FAMILY_STACKS: Record<AppSettings['fontFamily'], string> = {
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  humanist: '"Trebuchet MS", "Segoe UI", Arial, sans-serif',
  readable: 'Verdana, Geneva, "DejaVu Sans", sans-serif',
}

type Action =
  | { type: 'task/add'; task: Task }
  | { type: 'task/update'; task: Task }
  | { type: 'task/toggle'; id: string }
  | { type: 'task/remove'; id: string }
  | { type: 'task/restore'; id: string }
  | { type: 'task/permanent-remove'; id: string }
  | { type: 'task/archive'; id: string }
  | { type: 'task/restore-archive'; id: string }
  | { type: 'task/archive-completed' }
  | { type: 'task/focus-minutes'; id: string; minutes: number }
  | { type: 'project/add'; project: Project }
  | { type: 'filter/add'; filter: SavedFilter }
  | { type: 'filter/remove'; id: string }
  | { type: 'pomodoro/update'; pomodoro: Partial<PomodoroState> }
  | { type: 'habit/toggle'; id: string; date: string }
  | { type: 'habit/add'; habit: Habit }
  | { type: 'habit/update'; habit: Habit }
  | { type: 'settings/update'; settings: Partial<AppSettings> }
  | { type: 'sync/status'; sync: Partial<AppState['sync']> }
  | { type: 'replace'; state: AppState }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'task/add':
      return { ...state, tasks: [action.task, ...state.tasks] }
    case 'task/update':
      return { ...state, tasks: state.tasks.map((task) => (task.id === action.task.id ? action.task : task)) }
    case 'task/toggle':
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id && (task.status === 'active' || task.status === 'completed')
            ? {
                ...task,
                status: task.status === 'completed' ? 'active' : 'completed',
                completedAt: task.status === 'completed' ? undefined : new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
      }
    case 'task/remove':
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id
            ? {
                ...task,
                previousStatus: task.status === 'deleted' ? task.previousStatus : task.status,
                status: 'deleted',
                deletedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
      }
    case 'task/restore':
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id && task.status === 'deleted'
            ? {
                ...task,
                status: task.previousStatus ?? 'active',
                previousStatus: undefined,
                deletedAt: undefined,
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
      }
    case 'task/permanent-remove':
      return { ...state, tasks: state.tasks.filter((task) => task.id !== action.id) }
    case 'task/archive':
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id && task.status !== 'deleted'
            ? {
                ...task,
                previousStatus: task.status,
                status: 'archived',
                archivedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
      }
    case 'task/restore-archive':
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id && task.status === 'archived'
            ? {
                ...task,
                status: task.previousStatus === 'completed' ? 'completed' : 'active',
                previousStatus: undefined,
                archivedAt: undefined,
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
      }
    case 'task/archive-completed':
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.status === 'completed'
            ? {
                ...task,
                previousStatus: 'completed',
                status: 'archived',
                archivedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
      }
    case 'task/focus-minutes':
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id
            ? { ...task, focusMinutes: task.focusMinutes + Math.max(0, action.minutes), updatedAt: new Date().toISOString() }
            : task,
        ),
      }
    case 'project/add':
      return { ...state, projects: [...state.projects, action.project] }
    case 'filter/add':
      return { ...state, savedFilters: [action.filter, ...state.savedFilters] }
    case 'filter/remove':
      return { ...state, savedFilters: state.savedFilters.filter((filter) => filter.id !== action.id) }
    case 'pomodoro/update':
      return { ...state, pomodoro: { ...state.pomodoro, ...action.pomodoro } }
    case 'habit/toggle':
      return {
        ...state,
        habits: state.habits.map((habit) =>
          habit.id === action.id
            ? {
                ...habit,
                completions: habit.completions.includes(action.date)
                  ? habit.completions.filter((date) => date !== action.date)
                  : [...habit.completions, action.date],
              }
            : habit,
        ),
      }
    case 'habit/add':
      return { ...state, habits: [...state.habits, action.habit] }
    case 'habit/update':
      return {
        ...state,
        habits: state.habits.map((habit) => (habit.id === action.habit.id ? action.habit : habit)),
      }
    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.settings } }
    case 'sync/status':
      return { ...state, sync: { ...state.sync, ...action.sync } }
    case 'replace':
      return action.state
  }
}

export interface SyncConflictView {
  modifiedAt?: string
  local: SnapshotSummary
  remote: SnapshotSummary
}

interface AppContextValue {
  state: AppState
  ready: boolean
  addTask(task: Task): void
  updateTask(task: Task): void
  toggleTask(id: string): void
  completionNotice?: { id: string; title: string }
  undoTaskCompletion(): void
  dismissCompletionNotice(): void
  removeTask(id: string): void
  restoreTask(id: string): void
  permanentlyRemoveTask(id: string): void
  archiveTask(id: string): void
  restoreArchivedTask(id: string): void
  archiveCompletedTasks(): void
  addFocusMinutes(id: string, minutes: number): void
  addProject(project: Project): void
  addSavedFilter(filter: SavedFilter): void
  removeSavedFilter(id: string): void
  updatePomodoro(pomodoro: Partial<PomodoroState>): void
  toggleHabit(id: string, date: string): void
  addHabit(habit: Habit): void
  updateHabit(habit: Habit): void
  updateSettings(settings: Partial<AppSettings>): void
  updateSyncProviderConfig(key: string, value: string): void
  persistState(): Promise<void>
  syncProviders: SyncProviderDescriptor[]
  syncConflict?: SyncConflictView
  importBackupAvailable: boolean
  selectSyncProvider(id: string): Promise<void>
  connectSyncProvider(): Promise<void>
  disconnectSyncProvider(): Promise<void>
  syncNow(): Promise<void>
  resolveSyncConflict(choice: 'remote' | 'local' | 'cancel'): Promise<void>
  restoreImportBackup(): Promise<void>
  resetDemo(): Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)
const storage = new LocalStorageAdapter()

interface ConflictCandidate {
  head: RemoteHead
  remoteState: AppState
}

export interface AppProviderProps {
  children: ReactNode
  syncRegistry?: SyncProviderRegistry
}

function syncErrorMessage(error: unknown) {
  if (error instanceof AuthorizationError) {
    if (error.code === 'cancel') return 'Подключение отменено'
    if (error.code === 'config') return 'Проверьте параметры OAuth и разрешённый адрес приложения'
    return 'Не удалось открыть авторизацию хранилища'
  }
  return error instanceof Error ? error.message : 'Ошибка синхронизации'
}

function providerConfigKey(config: SyncProviderConfig) {
  return JSON.stringify(Object.entries(config).sort(([left], [right]) => left.localeCompare(right)))
}

function effectiveProviderConfig(descriptor: SyncProviderDescriptor, saved: SyncProviderConfig) {
  return Object.fromEntries([
    ...(descriptor.configFields ?? []).flatMap((field) => (
      field.defaultValue !== undefined ? [[field.key, field.defaultValue] as const] : []
    )),
    ...Object.entries(saved),
  ])
}

export function AppProvider({ children, syncRegistry }: AppProviderProps) {
  const [state, dispatch] = useReducer(reducer, undefined, createSeedState)
  const [ready, setReady] = useState(false)
  const [storageLoadError, setStorageLoadError] = useState<string>()
  const [storageWriteError, setStorageWriteError] = useState<string>()
  const [completionNotice, setCompletionNotice] = useState<{ id: string; title: string }>()
  const [syncConflict, setSyncConflict] = useState<SyncConflictView>()
  const [importBackupAvailable, setImportBackupAvailable] = useState(false)
  const stateRef = useRef(state)
  const registryRef = useRef<SyncProviderRegistry | null>(null)
  const runtimeRef = useRef<{
    providerId: string
    configKey: string
    runtime: SyncProviderRuntime
  }>()
  const conflictCandidateRef = useRef<ConflictCandidate>()
  const skipNextSaveRef = useRef(false)
  const observedHashRef = useRef<string>()
  const syncInFlightRef = useRef<Promise<void> | null>(null)
  const syncQueuedRef = useRef(false)
  const syncEpochRef = useRef(0)
  stateRef.current = state
  if (!registryRef.current) registryRef.current = syncRegistry ?? createDefaultSyncProviderRegistry()

  const commitSyncState = useCallback((sync: Partial<AppState['sync']>) => {
    const nextSync = { ...stateRef.current.sync, ...sync }
    stateRef.current = { ...stateRef.current, sync: nextSync }
    dispatch({ type: 'sync/status', sync })
  }, [])

  const releaseRuntime = useCallback(async () => {
    const runtime = runtimeRef.current?.runtime
    runtimeRef.current = undefined
    if (!runtime) return
    try {
      await runtime.disconnect()
    } catch {
      // Provider cleanup must never block a local reset, restore, or auth state transition.
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const saved = await storage.load()
        if (saved) {
          stateRef.current = saved
          dispatch({ type: 'replace', state: saved })
        }
        setImportBackupAvailable(Boolean(await storage.loadImportBackup()))
        setReady(true)
      } catch (error) {
        setStorageLoadError(error instanceof UnsupportedSchemaVersionError
          ? 'Локальные данные созданы более новой версией Focus Flow. Обновите приложение — snapshot оставлен без изменений.'
          : 'Не удалось безопасно прочитать локальные данные. Snapshot оставлен без изменений.')
      }
    })()
  }, [])

  useEffect(() => {
    if (!ready) return
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    void storage.save(state).then(
      () => setStorageWriteError(undefined),
      () => setStorageWriteError('Не удалось сохранить локальные изменения. Освободите место в браузере и не закрывайте вкладку.'),
    )
  }, [ready, state])

  useEffect(() => {
    if (!completionNotice) return
    const timeout = window.setTimeout(() => setCompletionNotice(undefined), 6000)
    return () => window.clearTimeout(timeout)
  }, [completionNotice])

  useLayoutEffect(() => {
    if (!ready) return
    const root = document.documentElement
    root.dataset.theme = state.settings.theme
    root.dataset.accent = state.settings.accent
    root.dataset.fontFamily = state.settings.fontFamily
    root.dataset.fontScale = String(state.settings.fontScale)
    root.dataset.compact = String(state.settings.compactMode)
    root.dataset.reduceMotion = String(state.settings.reduceMotion)
    root.dataset.background = state.settings.backgroundPreset
    root.style.setProperty('--background-dim', String(state.settings.backgroundDim / 100))
    root.style.setProperty('--app-font-family', FONT_FAMILY_STACKS[state.settings.fontFamily])
    root.style.setProperty('--app-font-scale', String(state.settings.fontScale / 100))
    root.style.setProperty(
      '--custom-background-image',
      state.settings.customBackgroundDataUrl ? `url("${state.settings.customBackgroundDataUrl}")` : 'none',
    )
  }, [ready, state.settings])

  const getAdapter = useCallback(async (interactive: boolean) => {
    const current = stateRef.current
    const providerId = current.settings.syncProvider
    const definition = registryRef.current?.get(providerId)
    if (!definition) throw new SyncProviderError('unavailable', `Провайдер «${providerId}» не установлен`)
    const config = effectiveProviderConfig(
      definition.descriptor,
      current.settings.syncProviderConfigs[providerId] ?? {},
    )
    const missingRequiredField = definition.descriptor.configFields?.find((field) => (
      field.required && !config[field.key]?.trim()
    ))
    if (missingRequiredField) {
      throw new SyncProviderError('unavailable', `Заполните обязательный параметр «${missingRequiredField.label}»`)
    }
    const configKey = providerConfigKey(config)
    if (runtimeRef.current?.providerId !== providerId || runtimeRef.current.configKey !== configKey) {
      await releaseRuntime()
      runtimeRef.current = {
        providerId,
        configKey,
        runtime: definition.createRuntime(config),
      }
    }
    commitSyncState({ connectionMode: definition.descriptor.connection })
    const adapter = await runtimeRef.current.runtime.acquireAdapter({
      interactive,
      resume: current.sync.connectionStatus !== 'disconnected',
    })
    if (adapter.descriptor.id !== providerId) {
      throw new SyncProviderError('unavailable', `Провайдер «${providerId}» вернул адаптер другого типа`)
    }
    return adapter
  }, [commitSyncState, releaseRuntime])

  const applyRemoteState = useCallback(async (
    local: AppState,
    remote: AppState,
    head: RemoteHead,
    providerId: string,
    message: string,
    syncEpoch: number,
  ) => {
    const merged = mergeRemoteState(local, remote)
    const mergedHash = syncableHash(merged)
    const nextState: AppState = {
      ...merged,
      sync: {
        ...local.sync,
        status: 'success',
        connectionStatus: 'connected',
        providerId,
        remoteId: head.id,
        remoteRevision: head.revision,
        lastSyncedHash: mergedHash,
        lastSyncedAt: new Date().toISOString(),
        message,
      },
    }
    await storage.replaceWithBackup(nextState)
    if (syncEpoch !== syncEpochRef.current || stateRef.current.settings.syncProvider !== providerId) return
    setImportBackupAvailable(true)
    skipNextSaveRef.current = true
    observedHashRef.current = mergedHash
    stateRef.current = nextState
    conflictCandidateRef.current = undefined
    setSyncConflict(undefined)
    dispatch({ type: 'replace', state: nextState })
  }, [])

  const performSync = useCallback(async (interactive: boolean) => {
    if (syncInFlightRef.current) {
      syncQueuedRef.current = true
      return syncInFlightRef.current
    }

    const operation = (async () => {
      const syncEpoch = syncEpochRef.current
      const providerId = stateRef.current.settings.syncProvider
      const isCurrent = () => syncEpoch === syncEpochRef.current
        && stateRef.current.settings.syncProvider === providerId
      commitSyncState({ status: 'syncing', providerId, message: 'Проверяем удалённую копию…' })
      try {
        const adapter = await getAdapter(interactive)
        if (!isCurrent()) return
        commitSyncState({ connectionStatus: 'connected', status: 'syncing', message: 'Синхронизация…' })
        const head = await adapter.head()
        if (!isCurrent()) return
        const local = stateRef.current
        const localHash = syncableHash(local)
        const metadata = local.sync.providerId === providerId
          ? {
              remoteId: local.sync.remoteId,
              remoteRevision: local.sync.remoteRevision,
              lastSyncedHash: local.sync.lastSyncedHash,
            }
          : {}
        const decision = decideSync(localHash, metadata, head)

        if (decision === 'create-remote') {
          const uploaded = await adapter.upload(createRemoteEnvelope(local))
          if (!isCurrent()) return
          const localChangedDuringUpload = syncableHash(stateRef.current) !== localHash
          commitSyncState({
            status: 'success',
            connectionStatus: 'connected',
            providerId,
            remoteId: uploaded.id,
            remoteRevision: uploaded.revision,
            lastSyncedHash: localHash,
            lastSyncedAt: new Date().toISOString(),
            message: localChangedDuringUpload
              ? 'Копия создана; сохраняем более новые локальные изменения…'
              : 'Защищённая копия создана в хранилище',
          })
          if (localChangedDuringUpload) syncQueuedRef.current = true
          return
        }

        if (decision === 'noop') {
          commitSyncState({
            status: 'success',
            connectionStatus: 'connected',
            lastSyncedAt: new Date().toISOString(),
            message: 'Локальные и удалённые данные совпадают',
          })
          return
        }

        if (decision === 'upload-local' && head) {
          const uploaded = await adapter.upload(createRemoteEnvelope(local), { expectedRevision: head.revision })
          if (!isCurrent()) return
          const localChangedDuringUpload = syncableHash(stateRef.current) !== localHash
          commitSyncState({
            status: 'success',
            connectionStatus: 'connected',
            remoteId: uploaded.id,
            remoteRevision: uploaded.revision,
            lastSyncedHash: localHash,
            lastSyncedAt: new Date().toISOString(),
            message: localChangedDuringUpload
              ? 'Копия обновлена; сохраняем более новые локальные изменения…'
              : 'Изменения сохранены в хранилище',
          })
          if (localChangedDuringUpload) syncQueuedRef.current = true
          return
        }

        if (!head) throw new SyncProviderError('conflict', 'Удалённая копия исчезла во время синхронизации')
        const downloaded = await adapter.download(head)
        if (!isCurrent()) return
        if (!downloaded) throw new SyncProviderError('conflict', 'Удалённая копия была удалена')
        const remoteState = decodeRemoteSnapshot(downloaded.payload)

        // A user action can complete while the remote request is in flight. Never
        // replace that newer local state just because the pre-request snapshot was clean.
        const latestLocal = stateRef.current
        if (syncableHash(latestLocal) !== localHash) {
          conflictCandidateRef.current = { head: downloaded.head, remoteState }
          setSyncConflict({
            modifiedAt: downloaded.head.modifiedAt,
            local: summarizeSnapshot(latestLocal),
            remote: summarizeSnapshot(remoteState),
          })
          commitSyncState({
            status: 'conflict',
            connectionStatus: 'connected',
            message: 'Локальные данные изменились во время загрузки; выберите копию',
          })
          return
        }

        if (decision === 'download-remote') {
          await applyRemoteState(local, remoteState, downloaded.head, providerId, 'Данные загружены из хранилища', syncEpoch)
          return
        }

        if (syncableHash(remoteState) === localHash) {
          commitSyncState({
            status: 'success',
            connectionStatus: 'connected',
            providerId,
            remoteId: downloaded.head.id,
            remoteRevision: downloaded.head.revision,
            lastSyncedHash: localHash,
            lastSyncedAt: new Date().toISOString(),
            message: 'Подключение настроено, данные совпадают',
          })
          return
        }

        conflictCandidateRef.current = { head: downloaded.head, remoteState }
        setSyncConflict({
          modifiedAt: downloaded.head.modifiedAt,
          local: summarizeSnapshot(local),
          remote: summarizeSnapshot(remoteState),
        })
        commitSyncState({
          status: 'conflict',
          connectionStatus: 'connected',
          message: 'Выберите, какую копию сохранить',
        })
      } catch (error) {
        if (!isCurrent()) return
        const needsAuthorization = error instanceof SyncProviderError && error.code === 'auth-required'
        if (needsAuthorization) {
          await releaseRuntime()
          if (!isCurrent()) return
        }
        commitSyncState({
          status: 'error',
          connectionStatus: needsAuthorization
            ? 'authorization-required'
            : stateRef.current.sync.connectionStatus,
          message: syncErrorMessage(error),
        })
      }
    })()

    syncInFlightRef.current = operation
    try {
      await operation
    } finally {
      syncInFlightRef.current = null
      if (syncQueuedRef.current) {
        syncQueuedRef.current = false
        window.setTimeout(() => void performSync(false), 0)
      }
    }
  }, [applyRemoteState, commitSyncState, getAdapter, releaseRuntime])

  const updateSyncProviderConfig = useCallback((key: string, value: string) => {
    const current = stateRef.current
    const providerId = current.settings.syncProvider
    const savedConfig = current.settings.syncProviderConfigs[providerId] ?? {}
    if (savedConfig[key] === value) return
    syncEpochRef.current += 1
    syncQueuedRef.current = false
    void releaseRuntime()
    const definition = registryRef.current?.get(providerId)
    const nextSettings: AppSettings = {
      ...current.settings,
      syncProviderConfigs: {
        ...current.settings.syncProviderConfigs,
        [providerId]: { ...savedConfig, [key]: value },
      },
    }
    const nextSync: AppState['sync'] = {
      status: definition ? 'idle' : 'error',
      connectionStatus: definition?.descriptor.connection === 'implicit' ? 'connected' : 'disconnected',
      connectionMode: definition?.descriptor.connection,
      providerId,
      remoteId: undefined,
      remoteRevision: undefined,
      lastSyncedHash: undefined,
      lastSyncedAt: undefined,
      message: definition ? 'Параметры хранилища изменены; подключение нужно проверить заново' : `Провайдер «${providerId}» недоступен`,
    }
    stateRef.current = { ...current, settings: nextSettings, sync: nextSync }
    conflictCandidateRef.current = undefined
    setSyncConflict(undefined)
    dispatch({ type: 'settings/update', settings: { syncProviderConfigs: nextSettings.syncProviderConfigs } })
    dispatch({ type: 'sync/status', sync: nextSync })
  }, [releaseRuntime])

  const selectSyncProvider = useCallback(async (id: string) => {
    syncEpochRef.current += 1
    syncQueuedRef.current = false
    await releaseRuntime()
    conflictCandidateRef.current = undefined
    setSyncConflict(undefined)
    const definition = registryRef.current?.get(id)
    const nextSettings = { ...stateRef.current.settings, syncProvider: id }
    const nextSync: AppState['sync'] = {
      status: definition ? 'idle' : 'error',
      connectionStatus: definition?.descriptor.connection === 'implicit' ? 'connected' : 'disconnected',
      connectionMode: definition?.descriptor.connection,
      providerId: id,
      lastSyncedAt: undefined,
      remoteId: undefined,
      remoteRevision: undefined,
      lastSyncedHash: undefined,
      message: definition ? undefined : `Провайдер «${id}» недоступен`,
    }
    stateRef.current = { ...stateRef.current, settings: nextSettings, sync: nextSync }
    dispatch({ type: 'settings/update', settings: { syncProvider: id } })
    dispatch({ type: 'sync/status', sync: nextSync })
  }, [releaseRuntime])

  const disconnectSyncProvider = useCallback(async () => {
    syncEpochRef.current += 1
    syncQueuedRef.current = false
    await releaseRuntime()
    conflictCandidateRef.current = undefined
    setSyncConflict(undefined)
    commitSyncState({
      status: 'idle',
      connectionStatus: registryRef.current?.get(stateRef.current.settings.syncProvider)?.descriptor.connection === 'implicit'
        ? 'connected'
        : 'disconnected',
      remoteId: undefined,
      remoteRevision: undefined,
      lastSyncedHash: undefined,
      message: 'Хранилище отключено',
    })
  }, [commitSyncState, releaseRuntime])

  const resolveSyncConflict = useCallback(async (choice: 'remote' | 'local' | 'cancel') => {
    const candidate = conflictCandidateRef.current
    if (!candidate || choice === 'cancel') {
      conflictCandidateRef.current = undefined
      setSyncConflict(undefined)
      commitSyncState({ status: 'idle', message: choice === 'cancel' ? 'Синхронизация отменена' : undefined })
      return
    }
    const providerId = stateRef.current.settings.syncProvider
    const syncEpoch = syncEpochRef.current
    if (choice === 'remote') {
      commitSyncState({ status: 'syncing', message: 'Загружаем выбранную копию…' })
      try {
        await applyRemoteState(
          stateRef.current,
          candidate.remoteState,
          candidate.head,
          providerId,
          'Загружена копия из хранилища; прежние локальные данные сохранены в backup',
          syncEpoch,
        )
      } catch (error) {
        commitSyncState({ status: 'error', message: syncErrorMessage(error) })
      }
      return
    }

    commitSyncState({ status: 'syncing', message: 'Сохраняем локальную копию…' })
    try {
      const local = stateRef.current
      const adapter = await getAdapter(true)
      const uploaded = await adapter.upload(createRemoteEnvelope(local), { expectedRevision: candidate.head.revision })
      if (syncEpoch !== syncEpochRef.current || stateRef.current.settings.syncProvider !== providerId) return
      const localHash = syncableHash(local)
      const localChangedDuringUpload = syncableHash(stateRef.current) !== localHash
      conflictCandidateRef.current = undefined
      setSyncConflict(undefined)
      commitSyncState({
        status: 'success',
        connectionStatus: 'connected',
        remoteId: uploaded.id,
        remoteRevision: uploaded.revision,
        lastSyncedHash: localHash,
        lastSyncedAt: new Date().toISOString(),
        message: localChangedDuringUpload
          ? 'Локальная копия сохранена; отправляем более новые изменения…'
          : 'Локальная копия сохранена в хранилище',
      })
      if (localChangedDuringUpload) window.setTimeout(() => void performSync(false), 0)
    } catch (error) {
      const needsAuthorization = error instanceof SyncProviderError && error.code === 'auth-required'
      if (needsAuthorization) {
        await releaseRuntime()
      }
      commitSyncState({
        status: 'error',
        connectionStatus: needsAuthorization ? 'authorization-required' : stateRef.current.sync.connectionStatus,
        message: syncErrorMessage(error),
      })
    }
  }, [applyRemoteState, commitSyncState, getAdapter, performSync, releaseRuntime])

  const currentSyncHash = useMemo(() => (
    state.settings.autoSync ? syncableHash(state) : undefined
  ), [
    state.habits,
    state.pomodoro,
    state.projects,
    state.savedFilters,
    state.schemaVersion,
    state.settings.accent,
    state.settings.autoSync,
    state.settings.backgroundDim,
    state.settings.backgroundPreset,
    state.settings.compactMode,
    state.settings.customBackgroundDataUrl,
    state.settings.defaultUrgencyThresholdHours,
    state.settings.fontFamily,
    state.settings.fontScale,
    state.settings.inboxSort,
    state.settings.inboxView,
    state.settings.reduceMotion,
    state.settings.theme,
    state.tasks,
  ])
  useEffect(() => {
    if (!ready) {
      observedHashRef.current = currentSyncHash
      return
    }
    const previous = observedHashRef.current
    observedHashRef.current = currentSyncHash
    if (!currentSyncHash || previous === currentSyncHash) return
    if (state.sync.connectionStatus !== 'connected' || state.sync.status === 'conflict') return
    const timeout = window.setTimeout(() => void performSync(false), 1800)
    return () => window.clearTimeout(timeout)
  }, [currentSyncHash, performSync, ready, state.settings.autoSync, state.sync.connectionStatus, state.sync.status])

  useEffect(() => {
    const onOnline = () => {
      const current = stateRef.current
      if (current.settings.autoSync && current.sync.connectionStatus === 'connected') void performSync(false)
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [performSync])

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      ready,
      addTask: (task) => dispatch({ type: 'task/add', task }),
      updateTask: (task) => dispatch({ type: 'task/update', task }),
      toggleTask: (id) => {
        const task = state.tasks.find((item) => item.id === id)
        dispatch({ type: 'task/toggle', id })
        setCompletionNotice(task?.status === 'active' ? { id, title: task.title } : undefined)
      },
      completionNotice,
      undoTaskCompletion: () => {
        if (!completionNotice) return
        const task = state.tasks.find((item) => item.id === completionNotice.id)
        if (task?.status === 'completed') dispatch({ type: 'task/toggle', id: completionNotice.id })
        setCompletionNotice(undefined)
      },
      dismissCompletionNotice: () => setCompletionNotice(undefined),
      removeTask: (id) => dispatch({ type: 'task/remove', id }),
      restoreTask: (id) => dispatch({ type: 'task/restore', id }),
      permanentlyRemoveTask: (id) => dispatch({ type: 'task/permanent-remove', id }),
      archiveTask: (id) => dispatch({ type: 'task/archive', id }),
      restoreArchivedTask: (id) => dispatch({ type: 'task/restore-archive', id }),
      archiveCompletedTasks: () => dispatch({ type: 'task/archive-completed' }),
      addFocusMinutes: (id, minutes) => dispatch({ type: 'task/focus-minutes', id, minutes }),
      addProject: (project) => dispatch({ type: 'project/add', project }),
      addSavedFilter: (filter) => dispatch({ type: 'filter/add', filter }),
      removeSavedFilter: (id) => dispatch({ type: 'filter/remove', id }),
      updatePomodoro: (pomodoro) => dispatch({ type: 'pomodoro/update', pomodoro }),
      toggleHabit: (id, date) => dispatch({ type: 'habit/toggle', id, date }),
      addHabit: (habit) => dispatch({ type: 'habit/add', habit }),
      updateHabit: (habit) => dispatch({ type: 'habit/update', habit }),
      updateSettings: (settings) => dispatch({ type: 'settings/update', settings }),
      updateSyncProviderConfig,
      persistState: () => storage.save(stateRef.current),
      syncProviders: registryRef.current?.list().map((provider) => provider.descriptor) ?? [],
      syncConflict,
      importBackupAvailable,
      selectSyncProvider,
      connectSyncProvider: () => performSync(true),
      disconnectSyncProvider,
      syncNow: () => performSync(true),
      resolveSyncConflict,
      restoreImportBackup: async () => {
        syncEpochRef.current += 1
        syncQueuedRef.current = false
        await releaseRuntime()
        try {
          const restored = await storage.restoreImportBackup()
          if (!restored) {
            setImportBackupAvailable(false)
            return
          }
          const nextState: AppState = {
            ...restored,
            sync: {
              ...restored.sync,
              status: 'idle',
              message: 'Восстановлена локальная копия до последнего импорта',
            },
          }
          stateRef.current = nextState
          conflictCandidateRef.current = undefined
          setSyncConflict(undefined)
          dispatch({ type: 'replace', state: nextState })
          setImportBackupAvailable(true)
        } catch (error) {
          const definition = registryRef.current?.get(stateRef.current.settings.syncProvider)
          commitSyncState({
            status: 'error',
            connectionStatus: definition?.descriptor.connection === 'implicit' ? 'connected' : 'disconnected',
            message: `Не удалось восстановить локальную копию: ${syncErrorMessage(error)}`,
          })
        }
      },
      resetDemo: async () => {
        syncEpochRef.current += 1
        syncQueuedRef.current = false
        await releaseRuntime()
        await storage.clear()
        const seed = createSeedState()
        stateRef.current = seed
        conflictCandidateRef.current = undefined
        setSyncConflict(undefined)
        setImportBackupAvailable(false)
        setStorageWriteError(undefined)
        dispatch({ type: 'replace', state: seed })
      },
    }),
    [commitSyncState, completionNotice, disconnectSyncProvider, importBackupAvailable, performSync, ready, releaseRuntime, resolveSyncConflict, selectSyncProvider, state, syncConflict, updateSyncProviderConfig],
  )

  if (storageLoadError) {
    return <main className="storage-load-error" role="alert"><h1>Данные не открыты</h1><p>{storageLoadError}</p></main>
  }

  return (
    <AppContext.Provider value={value}>
      {ready ? children : null}
      {storageWriteError && <div className="storage-write-error" role="alert">{storageWriteError}</div>}
    </AppContext.Provider>
  )
}

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}
