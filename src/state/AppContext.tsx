import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type { AppSettings, AppState, Habit, Project, PomodoroState, SavedFilter, Task } from '../domain/models'
import { getEffectiveUrgencyThreshold } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { UnsupportedSchemaVersionError } from '../domain/migrations'
import { LocalStorageAdapter } from '../core/storage/LocalStorageAdapter'
import { StateSaveQueue } from '../core/storage/StateSaveQueue'
import type { StorageAdapter } from '../core/storage/StorageAdapter'
import { clearAllTaskDraftStorage, clearTaskDraftStorage } from '../core/storage/TaskDraftStorage'
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
  | { type: 'task/archive-completed'; ids?: string[] }
  | { type: 'task/focus-minutes'; id: string; minutes: number }
  | { type: 'project/add'; project: Project }
  | { type: 'project/update'; project: Project }
  | { type: 'project/remove'; id: string }
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
      return {
        ...state,
        tasks: state.tasks.filter((task) => task.id !== action.id),
        pomodoro: state.pomodoro.taskId === action.id
          ? { ...state.pomodoro, taskId: undefined }
          : state.pomodoro,
      }
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
    case 'task/archive-completed': {
      const ids = action.ids ? new Set(action.ids) : undefined
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.status === 'completed' && (!ids || ids.has(task.id))
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
    case 'project/update':
      return {
        ...state,
        projects: state.projects.map((project) => (project.id === action.project.id ? action.project : project)),
      }
    case 'project/remove': {
      if (action.id === 'inbox') return state
      const updatedAt = new Date().toISOString()
      const removedProject = state.projects.find((project) => project.id === action.id)
      return {
        ...state,
        projects: state.projects.filter((project) => project.id !== action.id),
        tasks: state.tasks.map((task) => {
          if (task.projectId !== action.id) return task
          const taskWithoutThreshold = { ...task }
          delete taskWithoutThreshold.urgencyThresholdOverrideHours
          return {
            ...taskWithoutThreshold,
            projectId: 'inbox',
            ...(task.deadline
              ? { urgencyThresholdOverrideHours: getEffectiveUrgencyThreshold(task, removedProject?.urgencyThresholdHours) }
              : {}),
            updatedAt,
          }
        }),
        savedFilters: state.savedFilters.map((filter) => filter.projectId === action.id ? { ...filter, projectId: undefined } : filter),
      }
    }
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
  intent: SyncIntent
  modifiedAt?: string
  local: SnapshotSummary
  remote: SnapshotSummary
}

export type SyncIntent = 'pull' | 'push' | 'reconcile'

interface AppContextValue {
  state: AppState
  ready: boolean
  addTask(task: Task): void
  updateTask(task: Task): void
  saveTaskDurably(task: Task): Promise<void>
  toggleTask(id: string): void
  completionNotice?: { id: string; title: string }
  undoTaskCompletion(): void
  dismissCompletionNotice(): void
  removeTask(id: string): void
  trashTaskDurably(id: string): Promise<void>
  restoreTask(id: string): void
  permanentlyRemoveTask(id: string): void
  archiveTask(id: string): void
  restoreArchivedTask(id: string): void
  archiveCompletedTasks(ids?: string[]): void
  addFocusMinutes(id: string, minutes: number): void
  addProject(project: Project): void
  updateProject(project: Project): void
  removeProject(id: string): void
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
  activeSyncIntent?: SyncIntent
  importBackupAvailable: boolean
  selectSyncProvider(id: string): Promise<void>
  connectSyncProvider(): Promise<void>
  disconnectSyncProvider(): Promise<void>
  pullFromSyncProvider(): Promise<void>
  pushToSyncProvider(): Promise<void>
  syncNow(): Promise<void>
  resolveSyncConflict(choice: 'remote' | 'local' | 'cancel'): Promise<void>
  importLocalBackup(state: AppState): Promise<void>
  restoreImportBackup(): Promise<boolean>
  resetDemo(): Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

interface ConflictCandidate {
  head: RemoteHead
  remoteState: AppState
  intent: SyncIntent
}

export interface AppProviderProps {
  children: ReactNode
  syncRegistry?: SyncProviderRegistry
  /** Captured for the provider lifetime. Remount AppProvider to switch adapters. */
  storageAdapter?: StorageAdapter
}

function syncErrorMessage(error: unknown) {
  if (error instanceof AuthorizationError) {
    if (error.code === 'cancel') return 'Подключение отменено'
    if (error.code === 'access-denied') return 'Google не разрешил вход. Проверьте, что аккаунт добавлен в Test users приложения'
    if (error.code === 'config') return 'Проверьте параметры OAuth и разрешённый адрес приложения'
    return 'Не удалось открыть авторизацию хранилища'
  }
  return error instanceof Error ? error.message : 'Ошибка синхронизации'
}

function providerConfigKey(config: SyncProviderConfig) {
  return JSON.stringify(Object.entries(config).sort(([left], [right]) => left.localeCompare(right)))
}

function localSyncSettingsKey(settings: AppSettings) {
  return JSON.stringify([
    settings.autoSync,
    settings.syncProvider,
    Object.entries(settings.syncProviderConfigs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([providerId, config]) => [providerId, providerConfigKey(config)]),
  ])
}

function effectiveProviderConfig(descriptor: SyncProviderDescriptor, saved: SyncProviderConfig) {
  return Object.fromEntries([
    ...(descriptor.configFields ?? []).flatMap((field) => (
      field.defaultValue !== undefined ? [[field.key, field.defaultValue] as const] : []
    )),
    ...Object.entries(saved),
  ])
}

export function AppProvider({ children, syncRegistry, storageAdapter }: AppProviderProps) {
  const [state, dispatch] = useReducer(reducer, undefined, createSeedState)
  const [storage] = useState<StorageAdapter>(() => storageAdapter ?? new LocalStorageAdapter())
  const [saveQueue] = useState(() => new StateSaveQueue(storage))
  const [ready, setReady] = useState(false)
  const [storageLoadError, setStorageLoadError] = useState<string>()
  const [storageWriteError, setStorageWriteError] = useState<string>()
  const [completionNotice, setCompletionNotice] = useState<{ id: string; title: string }>()
  const [syncConflict, setSyncConflict] = useState<SyncConflictView>()
  const [activeSyncIntent, setActiveSyncIntent] = useState<SyncIntent>()
  const [importBackupAvailable, setImportBackupAvailable] = useState(false)
  const stateRef = useRef(state)
  const registryRef = useRef<SyncProviderRegistry | null>(null)
  const runtimeRef = useRef<{
    providerId: string
    configKey: string
    runtime: SyncProviderRuntime
  }>()
  const conflictCandidateRef = useRef<ConflictCandidate>()
  const skipSaveStateRef = useRef<AppState>()
  const observedHashRef = useRef<string>()
  const syncInFlightRef = useRef<Promise<void> | null>(null)
  const localDataOperationRef = useRef(false)
  const syncQueuedRef = useRef(false)
  const syncEpochRef = useRef(0)
  stateRef.current = state
  if (!registryRef.current) registryRef.current = syncRegistry ?? createDefaultSyncProviderRegistry()

  const trackStorageWrite = useCallback(async <T,>(operation: Promise<T>) => {
    try {
      const result = await operation
      setStorageWriteError(undefined)
      return result
    } catch (error) {
      setStorageWriteError('Не удалось сохранить локальные изменения. Освободите место в браузере и не закрывайте вкладку.')
      throw error
    }
  }, [])

  const ensureTaskCommitAvailable = useCallback(() => {
    if (localDataOperationRef.current
      || syncInFlightRef.current
      || stateRef.current.sync.status === 'connecting'
      || stateRef.current.sync.status === 'syncing') {
      throw new Error('Дождитесь завершения синхронизации или операции с локальными данными')
    }
  }, [])

  const saveTaskDurably = useCallback(async (task: Task) => {
    ensureTaskCommitAvailable()
    const current = stateRef.current
    if (!current.projects.some((project) => project.id === task.projectId)) {
      throw new Error('Task project no longer exists')
    }
    const action: Action = current.tasks.some((item) => item.id === task.id)
      ? { type: 'task/update', task }
      : { type: 'task/add', task }
    const nextState = reducer(current, action)
    stateRef.current = nextState
    skipSaveStateRef.current = nextState
    dispatch({ type: 'replace', state: nextState })
    await trackStorageWrite(saveQueue.save(nextState))
  }, [ensureTaskCommitAvailable, saveQueue, trackStorageWrite])

  const trashTaskDurably = useCallback(async (id: string) => {
    ensureTaskCommitAvailable()
    const nextState = reducer(stateRef.current, { type: 'task/remove', id })
    stateRef.current = nextState
    skipSaveStateRef.current = nextState
    dispatch({ type: 'replace', state: nextState })
    await trackStorageWrite(saveQueue.save(nextState))
  }, [ensureTaskCommitAvailable, saveQueue, trackStorageWrite])

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
    let cancelled = false
    void (async () => {
      try {
        const saved = await storage.load()
        const hasImportBackup = Boolean(await storage.loadImportBackup())
        if (cancelled) return
        if (saved) {
          stateRef.current = saved
          dispatch({ type: 'replace', state: saved })
        }
        setImportBackupAvailable(hasImportBackup)
        setReady(true)
      } catch (error) {
        if (cancelled) return
        setStorageLoadError(error instanceof UnsupportedSchemaVersionError
          ? 'Локальные данные созданы более новой версией Focus Flow. Обновите приложение — snapshot оставлен без изменений.'
          : 'Не удалось безопасно прочитать локальные данные. Snapshot оставлен без изменений.')
      }
    })()
    return () => { cancelled = true }
  }, [storage])

  useEffect(() => {
    if (!ready) return
    if (skipSaveStateRef.current === state) {
      skipSaveStateRef.current = undefined
      return
    }
    void trackStorageWrite(saveQueue.save(state)).catch(() => undefined)
  }, [ready, saveQueue, state, trackStorageWrite])

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
    const backgroundDim = state.settings.backgroundPreset === 'custom'
      ? Math.max(65, state.settings.backgroundDim)
      : state.settings.backgroundDim
    root.style.setProperty('--background-dim', String(backgroundDim / 100))
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
    const confirmedLocalHash = syncableHash(local)
    const confirmedLocalSyncSettings = localSyncSettingsKey(local.settings)
    const isCurrent = () => syncEpoch === syncEpochRef.current
      && stateRef.current.settings.syncProvider === providerId
      && syncableHash(stateRef.current) === confirmedLocalHash
      && localSyncSettingsKey(stateRef.current.settings) === confirmedLocalSyncSettings
    const leaveStaleReplacement = () => {
      if (syncEpoch !== syncEpochRef.current || stateRef.current.settings.syncProvider !== providerId) return
      const candidate = conflictCandidateRef.current
      if (candidate) {
        setSyncConflict({
          intent: candidate.intent,
          modifiedAt: candidate.head.modifiedAt,
          local: summarizeSnapshot(stateRef.current),
          remote: summarizeSnapshot(candidate.remoteState),
        })
        commitSyncState({
          status: 'conflict',
          connectionStatus: 'connected',
          message: 'Локальные данные изменились во время сохранения; проверьте выбор ещё раз',
        })
      } else {
        commitSyncState({
          status: 'idle',
          connectionStatus: 'connected',
          message: 'Локальные данные изменились во время получения; повторите синхронизацию',
        })
      }
    }
    if (!isCurrent()) {
      leaveStaleReplacement()
      return
    }
    await trackStorageWrite(saveQueue.runAuthoritative(
      (adapter) => adapter.replaceWithBackup(nextState),
      isCurrent,
    ))
    if (!isCurrent()) {
      leaveStaleReplacement()
      return
    }
    setImportBackupAvailable(true)
    skipSaveStateRef.current = nextState
    observedHashRef.current = mergedHash
    stateRef.current = nextState
    conflictCandidateRef.current = undefined
    setSyncConflict(undefined)
    dispatch({ type: 'replace', state: nextState })
  }, [commitSyncState, saveQueue, trackStorageWrite])

  const runSync = useCallback(async (intent: SyncIntent, interactive: boolean) => {
    if (localDataOperationRef.current || conflictCandidateRef.current) return
    if (syncInFlightRef.current) {
      // Only background reconciliation may be coalesced. A click on another
      // explicit direction must not silently turn into a different operation.
      if (intent === 'reconcile' && !interactive) syncQueuedRef.current = true
      return syncInFlightRef.current
    }

    const operation = (async () => {
      const syncEpoch = syncEpochRef.current
      const providerId = stateRef.current.settings.syncProvider
      const isCurrent = () => syncEpoch === syncEpochRef.current
        && stateRef.current.settings.syncProvider === providerId
      const operationLabel = intent === 'pull'
        ? 'Получаем данные из хранилища…'
        : intent === 'push'
          ? 'Отправляем данные в хранилище…'
          : 'Проверяем удалённую копию…'
      setActiveSyncIntent(intent)
      commitSyncState({ status: 'syncing', providerId, message: operationLabel })

      const showConflict = (local: AppState, remoteState: AppState, head: RemoteHead, message: string) => {
        conflictCandidateRef.current = { head, remoteState, intent }
        setSyncConflict({
          intent,
          modifiedAt: head.modifiedAt,
          local: summarizeSnapshot(local),
          remote: summarizeSnapshot(remoteState),
        })
        commitSyncState({ status: 'conflict', connectionStatus: 'connected', message })
      }

      const markMatched = (head: RemoteHead, localHash: string, message: string) => {
        commitSyncState({
          status: 'success',
          connectionStatus: 'connected',
          providerId,
          remoteId: head.id,
          remoteRevision: head.revision,
          lastSyncedHash: localHash,
          lastSyncedAt: new Date().toISOString(),
          message,
        })
      }

      const uploadLocal = async (
        adapter: Awaited<ReturnType<typeof getAdapter>>,
        local: AppState,
        localHash: string,
        expectedRevision: string | null,
      ) => {
        const uploaded = await adapter.upload(createRemoteEnvelope(local), { expectedRevision })
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
            ? 'Копия сохранена; отправляем более новые локальные изменения…'
            : expectedRevision === null
              ? 'Защищённая копия создана в хранилище'
              : 'Локальные данные отправлены в хранилище',
        })
        if (localChangedDuringUpload) syncQueuedRef.current = true
      }

      try {
        const adapter = await getAdapter(interactive)
        if (!isCurrent()) return
        if (intent === 'pull' && !adapter.descriptor.capabilities.download) {
          throw new SyncProviderError('unavailable', `«${adapter.descriptor.name}» не поддерживает получение данных`)
        }
        if (intent === 'push' && !adapter.descriptor.capabilities.upload) {
          throw new SyncProviderError('unavailable', `«${adapter.descriptor.name}» не поддерживает отправку данных`)
        }
        commitSyncState({ connectionStatus: 'connected', status: 'syncing', message: operationLabel })
        const head = await adapter.head()
        if (!isCurrent()) return

        if (intent === 'pull') {
          if (!head) {
            commitSyncState({
              status: 'idle',
              connectionStatus: 'connected',
              message: `В «${adapter.descriptor.name}» пока нет удалённой копии`,
            })
            return
          }
          const local = stateRef.current
          const localHash = syncableHash(local)
          const downloaded = await adapter.download(head)
          if (!isCurrent()) return
          if (!downloaded) throw new SyncProviderError('conflict', 'Удалённая копия была удалена во время получения')
          const remoteState = decodeRemoteSnapshot(downloaded.payload)
          const latestLocal = stateRef.current
          if (syncableHash(latestLocal) !== localHash) {
            showConflict(latestLocal, remoteState, downloaded.head, 'Локальные данные изменились во время получения; выберите копию')
            return
          }
          if (syncableHash(remoteState) === localHash) {
            markMatched(downloaded.head, localHash, 'Удалённая и локальная копии совпадают')
            return
          }
          showConflict(local, remoteState, downloaded.head, 'Удалённая копия отличается; подтвердите получение')
          return
        }

        const local = stateRef.current
        const localHash = syncableHash(local)

        if (intent === 'push') {
          if (!head) {
            await uploadLocal(adapter, local, localHash, null)
            return
          }
          const metadataIsCurrent = local.sync.providerId === providerId
            && local.sync.remoteId === head.id
            && local.sync.remoteRevision === head.revision
            && Boolean(local.sync.lastSyncedHash)
          if (metadataIsCurrent) {
            if (local.sync.lastSyncedHash === localHash) {
              markMatched(head, localHash, 'В хранилище уже сохранена текущая локальная копия')
              return
            }
            await uploadLocal(adapter, local, localHash, head.revision)
            return
          }
          if (!adapter.descriptor.capabilities.download) {
            throw new SyncProviderError('conflict', 'Нельзя безопасно проверить существующую удалённую копию перед отправкой')
          }
          const downloaded = await adapter.download(head)
          if (!isCurrent()) return
          if (!downloaded) throw new SyncProviderError('conflict', 'Удалённая копия была удалена во время проверки')
          const remoteState = decodeRemoteSnapshot(downloaded.payload)
          const latestLocal = stateRef.current
          if (syncableHash(latestLocal) !== localHash) {
            showConflict(latestLocal, remoteState, downloaded.head, 'Локальные данные изменились во время проверки; выберите копию')
            return
          }
          if (syncableHash(remoteState) === localHash) {
            markMatched(downloaded.head, localHash, 'Удалённая копия уже содержит текущие локальные данные')
            return
          }
          showConflict(local, remoteState, downloaded.head, 'В хранилище есть другая копия; подтвердите замену')
          return
        }

        const metadata = local.sync.providerId === providerId
          ? {
              remoteId: local.sync.remoteId,
              remoteRevision: local.sync.remoteRevision,
              lastSyncedHash: local.sync.lastSyncedHash,
            }
          : {}
        const decision = decideSync(localHash, metadata, head)

        if (decision === 'create-remote') {
          if (!adapter.descriptor.capabilities.upload) {
            throw new SyncProviderError('unavailable', `«${adapter.descriptor.name}» не поддерживает отправку данных`)
          }
          await uploadLocal(adapter, local, localHash, null)
          return
        }
        if (decision === 'noop' && head) {
          markMatched(head, localHash, 'Локальные и удалённые данные совпадают')
          return
        }
        if (decision === 'upload-local' && head) {
          if (!adapter.descriptor.capabilities.upload) {
            throw new SyncProviderError('unavailable', `«${adapter.descriptor.name}» не поддерживает отправку данных`)
          }
          await uploadLocal(adapter, local, localHash, head.revision)
          return
        }
        if (!head) throw new SyncProviderError('conflict', 'Удалённая копия исчезла во время синхронизации')
        if (!adapter.descriptor.capabilities.download) {
          throw new SyncProviderError('unavailable', `«${adapter.descriptor.name}» не поддерживает получение данных`)
        }
        const downloaded = await adapter.download(head)
        if (!isCurrent()) return
        if (!downloaded) throw new SyncProviderError('conflict', 'Удалённая копия была удалена')
        const remoteState = decodeRemoteSnapshot(downloaded.payload)
        const latestLocal = stateRef.current
        if (syncableHash(latestLocal) !== localHash) {
          showConflict(latestLocal, remoteState, downloaded.head, 'Локальные данные изменились во время загрузки; выберите копию')
          return
        }
        if (decision === 'download-remote') {
          await applyRemoteState(local, remoteState, downloaded.head, providerId, 'Данные загружены из хранилища', syncEpoch)
          return
        }
        if (syncableHash(remoteState) === localHash) {
          markMatched(downloaded.head, localHash, 'Подключение настроено, данные совпадают')
          return
        }
        showConflict(local, remoteState, downloaded.head, 'Выберите, какую копию сохранить')
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
      setActiveSyncIntent(undefined)
      if (syncQueuedRef.current) {
        syncQueuedRef.current = false
        if (!conflictCandidateRef.current) window.setTimeout(() => void runSync('reconcile', false), 0)
      }
    }
  }, [applyRemoteState, commitSyncState, getAdapter, releaseRuntime])

  const connectSyncProvider = useCallback(async () => {
    if (localDataOperationRef.current || conflictCandidateRef.current) return
    if (syncInFlightRef.current) return syncInFlightRef.current

    const operation = (async () => {
      const syncEpoch = syncEpochRef.current
      const providerId = stateRef.current.settings.syncProvider
      const providerName = registryRef.current?.get(providerId)?.descriptor.name ?? providerId
      const isCurrent = () => syncEpoch === syncEpochRef.current
        && stateRef.current.settings.syncProvider === providerId
      commitSyncState({ status: 'connecting', providerId, message: 'Открываем авторизацию хранилища…' })
      try {
        await getAdapter(true)
        if (!isCurrent()) return
        commitSyncState({
          status: 'idle',
          connectionStatus: 'connected',
          providerId,
          message: `Подключение к «${providerName}» установлено. Выберите действие с данными.`,
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
        if (!conflictCandidateRef.current) window.setTimeout(() => void runSync('reconcile', false), 0)
      }
    }
  }, [commitSyncState, getAdapter, releaseRuntime, runSync])

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
      const cancelledAction = candidate?.intent === 'pull'
        ? 'Получение отменено'
        : candidate?.intent === 'push'
          ? 'Отправка отменена'
          : 'Синхронизация отменена'
      commitSyncState({ status: 'idle', message: choice === 'cancel' ? cancelledAction : undefined })
      return
    }
    if (candidate.intent === 'pull' && choice === 'local') {
      commitSyncState({
        status: 'conflict',
        message: 'Во время получения можно применить удалённую копию или отменить действие',
      })
      return
    }
    if (candidate.intent === 'push' && choice === 'remote') {
      commitSyncState({
        status: 'conflict',
        message: 'Во время отправки можно заменить удалённую копию локальными данными или отменить действие',
      })
      return
    }
    const providerId = stateRef.current.settings.syncProvider
    const syncEpoch = syncEpochRef.current
    const isCurrent = () => syncEpoch === syncEpochRef.current
      && stateRef.current.settings.syncProvider === providerId
    if (choice === 'remote') {
      setActiveSyncIntent('pull')
      commitSyncState({ status: 'syncing', message: 'Загружаем выбранную копию…' })
      try {
        const confirmedLocalHash = syncableHash(stateRef.current)
        const adapter = await getAdapter(true)
        if (!adapter.descriptor.capabilities.download) {
          throw new SyncProviderError('unavailable', `«${adapter.descriptor.name}» не поддерживает получение данных`)
        }
        const latestHead = await adapter.head()
        if (!isCurrent()) return
        if (!latestHead) throw new SyncProviderError('conflict', 'Удалённая копия была удалена до подтверждения')
        if (latestHead.id !== candidate.head.id || latestHead.revision !== candidate.head.revision) {
          const downloaded = await adapter.download(latestHead)
          if (!isCurrent()) return
          if (!downloaded) throw new SyncProviderError('conflict', 'Удалённая копия была удалена до повторной проверки')
          const remoteState = decodeRemoteSnapshot(downloaded.payload)
          conflictCandidateRef.current = { head: downloaded.head, remoteState, intent: candidate.intent }
          setSyncConflict({
            intent: candidate.intent,
            modifiedAt: downloaded.head.modifiedAt,
            local: summarizeSnapshot(stateRef.current),
            remote: summarizeSnapshot(remoteState),
          })
          commitSyncState({
            status: 'conflict',
            connectionStatus: 'connected',
            message: 'Удалённая копия изменилась после просмотра; проверьте её ещё раз',
          })
          return
        }
        if (syncableHash(stateRef.current) !== confirmedLocalHash) {
          setSyncConflict({
            intent: candidate.intent,
            modifiedAt: candidate.head.modifiedAt,
            local: summarizeSnapshot(stateRef.current),
            remote: summarizeSnapshot(candidate.remoteState),
          })
          commitSyncState({
            status: 'conflict',
            connectionStatus: 'connected',
            message: 'Локальные данные изменились после подтверждения; проверьте выбор ещё раз',
          })
          return
        }
        await applyRemoteState(
          stateRef.current,
          candidate.remoteState,
          candidate.head,
          providerId,
          'Загружена копия из хранилища; прежние локальные данные сохранены в backup',
          syncEpoch,
        )
      } catch (error) {
        if (!isCurrent()) return
        const needsAuthorization = error instanceof SyncProviderError && error.code === 'auth-required'
        if (needsAuthorization) await releaseRuntime()
        if (!isCurrent()) return
        commitSyncState({
          status: 'error',
          connectionStatus: needsAuthorization ? 'authorization-required' : stateRef.current.sync.connectionStatus,
          message: syncErrorMessage(error),
        })
      } finally {
        setActiveSyncIntent(undefined)
      }
      return
    }

    setActiveSyncIntent('push')
    commitSyncState({ status: 'syncing', message: 'Сохраняем локальную копию…' })
    try {
      const local = stateRef.current
      const adapter = await getAdapter(true)
      if (!adapter.descriptor.capabilities.upload) {
        throw new SyncProviderError('unavailable', `«${adapter.descriptor.name}» не поддерживает отправку данных`)
      }
      const uploaded = await adapter.upload(createRemoteEnvelope(local), { expectedRevision: candidate.head.revision })
      if (!isCurrent()) return
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
      if (localChangedDuringUpload) window.setTimeout(() => void runSync('reconcile', false), 0)
    } catch (error) {
      if (!isCurrent()) return
      const needsAuthorization = error instanceof SyncProviderError && error.code === 'auth-required'
      if (needsAuthorization) {
        await releaseRuntime()
      }
      if (!isCurrent()) return
      commitSyncState({
        status: 'error',
        connectionStatus: needsAuthorization ? 'authorization-required' : stateRef.current.sync.connectionStatus,
        message: syncErrorMessage(error),
      })
    } finally {
      setActiveSyncIntent(undefined)
    }
  }, [applyRemoteState, commitSyncState, getAdapter, releaseRuntime, runSync])

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
    const timeout = window.setTimeout(() => void runSync('reconcile', false), 1800)
    return () => window.clearTimeout(timeout)
  }, [currentSyncHash, ready, runSync, state.settings.autoSync, state.sync.connectionStatus, state.sync.status])

  useEffect(() => {
    const onOnline = () => {
      const current = stateRef.current
      if (current.settings.autoSync && current.sync.connectionStatus === 'connected') void runSync('reconcile', false)
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [runSync])

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      ready,
      addTask: (task) => dispatch({ type: 'task/add', task }),
      updateTask: (task) => dispatch({ type: 'task/update', task }),
      saveTaskDurably,
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
      trashTaskDurably,
      restoreTask: (id) => dispatch({ type: 'task/restore', id }),
      permanentlyRemoveTask: (id) => {
        dispatch({ type: 'task/permanent-remove', id })
        clearTaskDraftStorage(id)
      },
      archiveTask: (id) => dispatch({ type: 'task/archive', id }),
      restoreArchivedTask: (id) => dispatch({ type: 'task/restore-archive', id }),
      archiveCompletedTasks: (ids) => dispatch({ type: 'task/archive-completed', ids }),
      addFocusMinutes: (id, minutes) => dispatch({ type: 'task/focus-minutes', id, minutes }),
      addProject: (project) => dispatch({ type: 'project/add', project }),
      updateProject: (project) => dispatch({ type: 'project/update', project }),
      removeProject: (id) => dispatch({ type: 'project/remove', id }),
      addSavedFilter: (filter) => dispatch({ type: 'filter/add', filter }),
      removeSavedFilter: (id) => dispatch({ type: 'filter/remove', id }),
      updatePomodoro: (pomodoro) => dispatch({ type: 'pomodoro/update', pomodoro }),
      toggleHabit: (id, date) => dispatch({ type: 'habit/toggle', id, date }),
      addHabit: (habit) => dispatch({ type: 'habit/add', habit }),
      updateHabit: (habit) => dispatch({ type: 'habit/update', habit }),
      updateSettings: (settings) => dispatch({ type: 'settings/update', settings }),
      updateSyncProviderConfig,
      persistState: () => trackStorageWrite(saveQueue.save(stateRef.current)),
      syncProviders: registryRef.current?.list().map((provider) => provider.descriptor) ?? [],
      syncConflict,
      activeSyncIntent,
      importBackupAvailable,
      selectSyncProvider,
      connectSyncProvider,
      disconnectSyncProvider,
      pullFromSyncProvider: () => runSync('pull', true),
      pushToSyncProvider: () => runSync('push', true),
      syncNow: () => runSync('reconcile', true),
      resolveSyncConflict,
      importLocalBackup: async (backupState) => {
        if (localDataOperationRef.current
          || syncInFlightRef.current
          || stateRef.current.sync.status === 'connecting'
          || stateRef.current.sync.status === 'syncing') {
          throw new Error('Дождитесь завершения синхронизации перед импортом')
        }
        localDataOperationRef.current = true
        try {
          const current = stateRef.current
          const imported = mergeRemoteState(current, backupState)
          const nextState: AppState = {
            ...imported,
            sync: {
              ...current.sync,
              status: 'idle',
              message: undefined,
            },
          }
          await trackStorageWrite(saveQueue.runAuthoritative((adapter) => adapter.replaceWithBackup(nextState)))
          clearAllTaskDraftStorage()
          syncEpochRef.current += 1
          syncQueuedRef.current = false
          skipSaveStateRef.current = nextState
          observedHashRef.current = current.settings.autoSync ? syncableHash(nextState) : undefined
          stateRef.current = nextState
          conflictCandidateRef.current = undefined
          setSyncConflict(undefined)
          setImportBackupAvailable(true)
          dispatch({ type: 'replace', state: nextState })
        } finally {
          localDataOperationRef.current = false
        }
      },
      restoreImportBackup: async () => {
        if (localDataOperationRef.current
          || syncInFlightRef.current
          || stateRef.current.sync.status === 'connecting'
          || stateRef.current.sync.status === 'syncing') {
          return false
        }
        localDataOperationRef.current = true
        syncEpochRef.current += 1
        syncQueuedRef.current = false
        try {
          const restored = await saveQueue.runExclusive((adapter) => adapter.loadImportBackup())
          if (!restored) {
            setImportBackupAvailable(false)
            return false
          }
          const definition = registryRef.current?.get(restored.settings.syncProvider)
          const connectionMode = definition?.descriptor.connection ?? restored.sync.connectionMode
          const connectionStatus = connectionMode === 'implicit'
            ? 'connected'
            : connectionMode === 'interactive' && restored.sync.connectionStatus !== 'disconnected'
              ? 'authorization-required'
              : restored.sync.connectionStatus
          const nextState: AppState = {
            ...restored,
            sync: {
              ...restored.sync,
              status: 'idle',
              connectionMode,
              connectionStatus,
              providerId: restored.settings.syncProvider,
              message: 'Восстановлена локальная копия до последнего импорта',
            },
          }
          await releaseRuntime()
          await trackStorageWrite(saveQueue.runAuthoritative((adapter) => adapter.replaceWithBackup(nextState)))
          clearAllTaskDraftStorage()
          skipSaveStateRef.current = nextState
          observedHashRef.current = nextState.settings.autoSync ? syncableHash(nextState) : undefined
          stateRef.current = nextState
          conflictCandidateRef.current = undefined
          setSyncConflict(undefined)
          dispatch({ type: 'replace', state: nextState })
          setImportBackupAvailable(true)
          return true
        } catch (error) {
          const definition = registryRef.current?.get(stateRef.current.settings.syncProvider)
          commitSyncState({
            status: 'error',
            connectionStatus: definition?.descriptor.connection === 'implicit' ? 'connected' : 'disconnected',
            message: `Не удалось восстановить локальную копию: ${syncErrorMessage(error)}`,
          })
          return false
        } finally {
          localDataOperationRef.current = false
        }
      },
      resetDemo: async () => {
        if (localDataOperationRef.current
          || syncInFlightRef.current
          || stateRef.current.sync.status === 'connecting'
          || stateRef.current.sync.status === 'syncing') {
          throw new Error('Дождитесь завершения синхронизации перед сбросом')
        }
        localDataOperationRef.current = true
        const seed = createSeedState()
        syncEpochRef.current += 1
        syncQueuedRef.current = false
        try {
          await releaseRuntime()
          await trackStorageWrite(saveQueue.runAuthoritative((adapter) => adapter.replaceWithBackup(seed)))
          clearAllTaskDraftStorage()
          skipSaveStateRef.current = seed
          observedHashRef.current = seed.settings.autoSync ? syncableHash(seed) : undefined
          stateRef.current = seed
          conflictCandidateRef.current = undefined
          setSyncConflict(undefined)
          setImportBackupAvailable(true)
          setStorageWriteError(undefined)
          dispatch({ type: 'replace', state: seed })
        } finally {
          localDataOperationRef.current = false
        }
      },
    }),
    [activeSyncIntent, commitSyncState, completionNotice, connectSyncProvider, disconnectSyncProvider, importBackupAvailable, ready, releaseRuntime, resolveSyncConflict, runSync, saveQueue, saveTaskDurably, selectSyncProvider, state, syncConflict, trackStorageWrite, trashTaskDurably, updateSyncProviderConfig],
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
