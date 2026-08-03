import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import type { AppSettings, AppState, Habit, Project, PomodoroState, SavedFilter, Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { LocalStorageAdapter } from '../core/storage/LocalStorageAdapter'
import { DemoSyncAdapter } from '../core/sync/DemoSyncAdapter'
import { GoogleDriveAdapter } from '../core/sync/GoogleDriveAdapter'

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
  | { type: 'sync/status'; sync: AppState['sync'] }
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
      return { ...state, sync: action.sync }
    case 'replace':
      return action.state
  }
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
  persistState(): Promise<void>
  sync(token?: string): Promise<void>
  resetDemo(): Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)
const storage = new LocalStorageAdapter()

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createSeedState)
  const [ready, setReady] = useState(false)
  const [completionNotice, setCompletionNotice] = useState<{ id: string; title: string }>()

  useEffect(() => {
    storage.load().then((saved) => {
      if (saved) dispatch({ type: 'replace', state: saved })
      setReady(true)
    })
  }, [])

  useEffect(() => {
    if (ready) void storage.save(state)
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
    root.dataset.compact = String(state.settings.compactMode)
    root.dataset.reduceMotion = String(state.settings.reduceMotion)
    root.dataset.background = state.settings.backgroundPreset
    root.style.setProperty('--background-dim', String(state.settings.backgroundDim / 100))
    root.style.setProperty(
      '--custom-background-image',
      state.settings.customBackgroundDataUrl ? `url("${state.settings.customBackgroundDataUrl}")` : 'none',
    )
  }, [ready, state.settings])

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
      persistState: () => storage.save(state),
      sync: async (token) => {
        dispatch({ type: 'sync/status', sync: { status: 'syncing', message: 'Синхронизация…' } })
        try {
          const adapter =
            state.settings.syncProvider === 'google-drive' && token
              ? new GoogleDriveAdapter(token)
              : new DemoSyncAdapter()
          const result = await adapter.sync(state)
          dispatch({
            type: 'sync/status',
            sync: { status: 'success', lastSyncedAt: new Date().toISOString(), message: result.message },
          })
        } catch (error) {
          dispatch({
            type: 'sync/status',
            sync: { status: 'error', message: error instanceof Error ? error.message : 'Ошибка синхронизации' },
          })
        }
      },
      resetDemo: async () => {
        await storage.clear()
        dispatch({ type: 'replace', state: createSeedState() })
      },
    }),
    [completionNotice, ready, state],
  )

  return <AppContext.Provider value={value}>{ready ? children : null}</AppContext.Provider>
}

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}
