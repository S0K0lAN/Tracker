import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import type { StorageAdapter } from '../core/storage/StorageAdapter'
import type { AppState } from '../domain/models'
import { AppProvider, useApp } from '../state/AppContext'
import { TaskEditor } from './TaskEditor'
import {
  getTaskDraftStorageKey,
  readTaskDraft,
  TASK_DRAFT_DEBOUNCE_MS,
  writeTaskDraft,
  type TaskDraftData,
} from './taskDraftJournal'

const STORAGE_KEY = 'focus-flow.state.v1'

function formatExpectedLocalDateTime(value: string) {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function mountEditor(
  task?: Task,
  defaults?: Partial<Pick<Task, 'projectId' | 'allDayDate' | 'startAt' | 'deadline' | 'plannedDurationMinutes'>>,
  storageAdapter?: StorageAdapter,
) {
  const onClose = vi.fn()
  const view = render(
    <AppProvider storageAdapter={storageAdapter}>
      <TaskEditor task={task} defaults={defaults} onClose={onClose} />
    </AppProvider>,
  )
  await screen.findByRole('dialog', { name: task?.title ?? 'Что нужно сделать?' })
  return { onClose, view }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

class ControlledTaskStorage implements StorageAdapter {
  controlled = false
  initialSaves = 0
  persistedState?: AppState
  readonly pending: Array<{
    state: AppState
    resolve(): void
    reject(error: unknown): void
  }> = []

  async load() { return createSeedState() }
  async loadImportBackup() { return null }
  async replaceWithBackup(state: AppState) { this.persistedState = state }
  async restoreImportBackup() { return null }
  async clear() {}

  save(state: AppState) {
    if (!this.controlled) {
      this.initialSaves += 1
      this.persistedState = state
      return Promise.resolve()
    }
    const result = deferred<void>()
    this.pending.push({
      state,
      resolve: () => {
        this.persistedState = state
        result.resolve(undefined)
      },
      reject: result.reject,
    })
    return result.promise
  }
}

async function renderEditor(
  task?: Task,
  defaults?: Partial<Pick<Task, 'projectId' | 'allDayDate' | 'startAt' | 'deadline' | 'plannedDurationMinutes'>>,
) {
  const { onClose } = await mountEditor(task, defaults)
  return onClose
}

function ProjectRemovalHarness({ onClose }: { onClose: () => void }) {
  const { removeProject } = useApp()
  return (
    <>
      <button data-testid="remove-project-during-edit" onClick={() => removeProject('work')}>Удалить проект</button>
      <TaskEditor defaults={{ projectId: 'work', startAt: '2026-08-31T09:00:00.000Z' }} onClose={onClose} />
    </>
  )
}

describe('TaskEditor defaults and date validation', () => {
  it('creates a task without an implicit duration', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor()

    expect(screen.getByLabelText('Длительность')).toHaveValue(null)
    expect(screen.getByText(/Необязательно:/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Название'), 'Задача без длительности')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.tasks.find((item: Task) => item.title === 'Задача без длительности')).not.toHaveProperty('plannedDurationMinutes')
    })
  })

  it('uses and persists a contextual project for a new task', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor(undefined, { projectId: 'work' })

    expect(screen.getByRole('combobox', { name: 'Проект' })).toHaveTextContent('Работа')
    await user.type(screen.getByLabelText('Название'), 'Задача из проекта')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.tasks.find((item: Task) => item.title === 'Задача из проекта')?.projectId).toBe('work')
    })
  })

  it('inherits the selected project threshold, updates it on project switch and saves no override', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    state.projects.find((project) => project.id === 'work')!.urgencyThresholdHours = 24
    state.projects.find((project) => project.id === 'personal')!.urgencyThresholdHours = 168
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const onClose = await renderEditor(undefined, {
      projectId: 'work',
      startAt: '2026-08-31T09:00:00.000Z',
    })
    expect(screen.queryByRole('combobox', { name: 'Порог срочности' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Срочность вручную' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Дедлайн'), '31.08.2026, 18:00')
    await user.tab()
    const threshold = screen.getByRole('combobox', { name: 'Порог срочности' })

    await waitFor(() => expect(threshold).toHaveTextContent('Из проекта · 1 день'))
    expect(screen.getByText('Эффективный порог: 1 день до дедлайна')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Проект' }))
    await user.click(screen.getByRole('option', { name: /Личное/ }))

    expect(threshold).toHaveTextContent('Из проекта · 7 дней')
    expect(screen.getByText('Эффективный порог: 7 дней до дедлайна')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Название'), 'Наследуемая срочность')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      const created = saved.tasks.find((item: Task) => item.title === 'Наследуемая срочность')
      expect(created.projectId).toBe('personal')
      expect(created).not.toHaveProperty('urgencyThresholdOverrideHours')
    })
  })

  it('saves an explicit preset as a task override', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    state.projects.find((project) => project.id === 'work')!.urgencyThresholdHours = 24
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const onClose = await renderEditor(undefined, {
      projectId: 'work',
      startAt: '2026-08-31T09:00:00.000Z',
    })
    await user.type(screen.getByLabelText('Дедлайн'), '31.08.2026, 18:00')
    await user.tab()
    const threshold = screen.getByRole('combobox', { name: 'Порог срочности' })
    await waitFor(() => expect(threshold).toHaveTextContent('Из проекта · 1 день'))

    await user.click(threshold)
    await user.click(screen.getByRole('option', { name: /^3 дня/ }))
    expect(threshold).toHaveTextContent('3 дня')
    expect(threshold).toHaveTextContent('Рекомендуемое значение')
    await user.type(screen.getByLabelText('Название'), 'Собственный порог')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.tasks.find((item: Task) => item.title === 'Собственный порог')?.urgencyThresholdOverrideHours).toBe(72)
    })
  })

  it('lets an existing task return from an individual threshold to project inheritance', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    const project = state.projects.find((item) => item.id === 'work')!
    project.name = 'Работа с порогом'
    project.urgencyThresholdHours = 24
    const task = {
      ...state.tasks.find((item) => item.projectId === 'work')!,
      urgencyThresholdOverrideHours: 168,
    }
    state.tasks = state.tasks.map((item) => item.id === task.id ? task : item)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const onClose = await renderEditor(task)
    const threshold = screen.getByRole('combobox', { name: 'Порог срочности' })

    expect(threshold).toHaveTextContent('7 дней')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Проект' })).toHaveTextContent('Работа с порогом'))
    await user.click(threshold)
    await user.click(screen.getByRole('option', { name: /^Из проекта · 1 день/ }))
    expect(threshold).toHaveTextContent('Из проекта · 1 день')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.tasks.find((item: Task) => item.id === task.id)).not.toHaveProperty('urgencyThresholdOverrideHours')
    })
  })

  it('moves an open draft to the inbox and preserves its inherited threshold if the project disappears', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    state.projects.find((project) => project.id === 'work')!.urgencyThresholdHours = 24
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const onClose = vi.fn()
    render(
      <AppProvider>
        <ProjectRemovalHarness onClose={onClose} />
      </AppProvider>,
    )
    await screen.findByRole('dialog', { name: 'Что нужно сделать?' })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Проект' })).toHaveTextContent('Работа'))
    await user.type(screen.getByLabelText('Дедлайн'), '31.08.2026, 18:00')
    await user.tab()

    fireEvent.click(screen.getByTestId('remove-project-during-edit'))

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Проект' })).toHaveTextContent('Без проекта'))
    expect(screen.getByRole('combobox', { name: 'Порог срочности' })).toHaveTextContent('1 день')
    expect(screen.getByText(/прежний порог срочности сохранён/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Название'), 'Черновик удалённого проекта')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      const created = saved.tasks.find((item: Task) => item.title === 'Черновик удалённого проекта')
      expect(created.projectId).toBe('inbox')
      expect(created.urgencyThresholdOverrideHours).toBe(24)
    })
  })

  it('removes urgency settings when the deadline is cleared', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor(undefined, {
      startAt: '2026-08-31T09:00:00.000Z',
      deadline: '2026-08-31T15:00:00.000Z',
    })

    await user.click(screen.getByRole('combobox', { name: 'Порог срочности' }))
    await user.click(screen.getByRole('option', { name: /^1 день / }))
    await user.click(screen.getByRole('combobox', { name: 'Срочность вручную' }))
    await user.click(screen.getByRole('option', { name: /^Срочно/ }))

    await user.clear(screen.getByLabelText('Дедлайн'))

    expect(screen.queryByRole('combobox', { name: 'Порог срочности' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Срочность вручную' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Название'), 'Задача без срочности')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      const created = saved.tasks.find((item: Task) => item.title === 'Задача без срочности')
      expect(created).not.toHaveProperty('deadline')
      expect(created).not.toHaveProperty('urgencyThresholdOverrideHours')
      expect(created).not.toHaveProperty('urgencyOverride')
    })
  })

  it('allows a deadline before the planned start once a start exists', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor()
    await user.type(screen.getByLabelText('Название'), 'Задача с независимым дедлайном')
    await user.type(screen.getByLabelText('Начало'), '21.08.2026, 12:00')
    await user.tab()
    await user.type(screen.getByLabelText('Дедлайн'), '21.08.2026, 11:00')
    await user.tab()

    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      const task = saved.tasks.find((item: Task) => item.title === 'Задача с независимым дедлайном')
      expect(task.startAt).toBe(new Date(2026, 7, 21, 12, 0).toISOString())
      expect(task.deadline).toBe(new Date(2026, 7, 21, 11, 0).toISOString())
      expect(task).not.toHaveProperty('plannedDurationMinutes')
    })
  })

  it('makes duration and deadline mutually exclusive while allowing the user to switch modes', async () => {
    const user = userEvent.setup()
    await renderEditor(undefined, {
      startAt: '2026-08-31T09:00:00.000Z',
      plannedDurationMinutes: 90,
    })
    const duration = screen.getByLabelText('Длительность')
    const durationUnit = screen.getByLabelText('Единица длительности')
    const deadline = screen.getByLabelText('Дедлайн')

    expect(duration).toHaveValue(90)
    expect(deadline).toBeDisabled()
    expect(screen.getByText('Сначала очистите длительность, чтобы указать дедлайн.')).toBeInTheDocument()

    await user.clear(duration)
    expect(deadline).toBeEnabled()
    await user.type(deadline, '31.08.2026, 18:00')
    await user.tab()

    expect(duration).toBeDisabled()
    expect(durationUnit).toBeDisabled()
    expect(screen.getByText('Сначала уберите дедлайн, чтобы указать длительность.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Очистить дату дедлайна' }))
    expect(duration).toBeEnabled()
    expect(durationUnit).toBeEnabled()
  })

  it('creates an ordinary all-day task from a blank editor with one button', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor()
    const today = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    const toggle = screen.getByRole('button', { name: 'Весь день' })

    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(getComputedStyle(toggle).minHeight).toBe('44px')
    expect(screen.getByText('Одним нажатием запланировать обычную задачу на текущую дату.')).toBeInTheDocument()
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Дата')).toHaveValue(todayKey)
    await waitFor(() => expect(screen.getByLabelText('Дата')).toHaveFocus())
    expect(screen.queryByLabelText('Начало')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Длительность')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Дедлайн')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Срочность вручную' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Название'), 'Обычная задача на весь день')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      const created = saved.tasks.find((item: Task) => item.title === 'Обычная задача на весь день')
      expect(created.allDayDate).toBe(todayKey)
      expect(created).not.toHaveProperty('startAt')
      expect(created).not.toHaveProperty('plannedDurationMinutes')
      expect(created).not.toHaveProperty('deadline')
      expect(created).not.toHaveProperty('urgencyOverride')
    })
  })

  it('preserves the selected date, time and duration when switching all-day mode back off', async () => {
    const user = userEvent.setup()
    await renderEditor(undefined, {
      startAt: new Date(2026, 7, 31, 9, 15).toISOString(),
      plannedDurationMinutes: 90,
    })
    const toggle = screen.getByRole('button', { name: 'Весь день' })

    expect(screen.getByText('Одним нажатием сделать задачу на весь день на дату начала.')).toBeInTheDocument()
    await user.click(toggle)
    const date = screen.getByLabelText('Дата')
    expect(date).toHaveValue('2026-08-31')
    await user.clear(date)
    await user.type(date, '2026-09-02')
    await user.click(toggle)

    expect(screen.getByLabelText('Начало')).toHaveValue('02.09.2026, 09:15')
    expect(screen.getByLabelText('Длительность')).toHaveValue(90)
    expect(screen.getByLabelText('Дедлайн')).toBeDisabled()
  })

  it('keeps all-day mode blocked until an existing deadline is cleared and labels default urgency as absent', async () => {
    const user = userEvent.setup()
    await renderEditor(undefined, {
      startAt: '2026-08-31T09:00:00.000Z',
      deadline: '2026-08-31T15:00:00.000Z',
    })
    const toggle = screen.getByRole('button', { name: 'Весь день' })

    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('combobox', { name: 'Срочность вручную' })).toHaveTextContent('Нет')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('alert')).toHaveTextContent('Сначала уберите дедлайн')
    expect(screen.getByLabelText('Дедлайн')).not.toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Очистить дату дедлайна' }))
    expect(toggle).toHaveAttribute('aria-disabled', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('requires a valid date while all-day mode remains selected', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor()
    await user.type(screen.getByLabelText('Название'), 'Нужна дата')
    await user.click(screen.getByRole('button', { name: 'Весь день' }))
    const date = screen.getByLabelText('Дата')
    await user.clear(date)
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Укажите корректную дату')
    expect(date).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Весь день' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('locks the deadline until start is valid and prevents removing a required start', async () => {
    const user = userEvent.setup()
    await renderEditor()
    const start = screen.getByLabelText('Начало')
    const deadline = screen.getByLabelText('Дедлайн')

    expect(deadline).toBeDisabled()
    expect(screen.getByText('Сначала укажите корректное начало задачи.')).toBeInTheDocument()

    await user.type(start, '31.08.2026, 09:00')
    expect(deadline).toBeEnabled()
    await user.tab()
    await user.type(deadline, '31.08.2026, 18:00')
    await user.tab()

    await user.click(screen.getByRole('button', { name: 'Очистить дату начала' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Сначала уберите дедлайн')
    expect(start).toHaveValue('31.08.2026, 09:00')
    expect(deadline).toHaveValue('31.08.2026, 18:00')

    await user.click(screen.getByRole('button', { name: 'Очистить дату дедлайна' }))
    await user.click(screen.getByRole('button', { name: 'Очистить дату начала' }))
    expect(start).toHaveValue('')
    expect(deadline).toBeDisabled()
  })

  it('preserves a legacy deadline-only task and lets the user clear its deadline', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    const legacyTask = {
      ...state.tasks[0],
      startAt: undefined,
      deadline: '2026-08-31T15:00:00.000Z',
    }
    state.tasks = state.tasks.map((task) => task.id === legacyTask.id ? legacyTask : task)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const onClose = await renderEditor(legacyTask)
    const deadline = screen.getByLabelText('Дедлайн')

    expect(deadline).toBeDisabled()
    expect(deadline).toHaveValue(formatExpectedLocalDateTime(legacyTask.deadline))
    expect(screen.getByText(/Добавьте начало, чтобы изменить дедлайн/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Очистить дату дедлайна' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Очистить дату дедлайна' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.tasks.find((task: Task) => task.id === legacyTask.id)).not.toHaveProperty('deadline')
    })
  })

  it('repairs an existing duration-deadline conflict by preserving the deadline', async () => {
    const user = userEvent.setup()
    const conflictingTask = {
      ...createSeedState().tasks[0],
      startAt: '2026-08-21T09:00:00.000Z',
      plannedDurationMinutes: 90,
      deadline: '2026-08-21T18:00:00.000Z',
    }
    const onClose = await renderEditor(conflictingTask)

    expect(screen.getByLabelText('Дедлайн')).toHaveValue(formatExpectedLocalDateTime(conflictingTask.deadline))
    expect(screen.getByLabelText('Длительность')).toBeDisabled()
    expect(screen.getByLabelText('Длительность')).toHaveValue(null)

    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.tasks.find((task: Task) => task.id === conflictingTask.id)).not.toHaveProperty('plannedDurationMinutes')
    })
  })

  it('saves duration in hours and reloads it as minutes', async () => {
    const user = userEvent.setup()
    const { onClose, view } = await mountEditor()
    await user.type(screen.getByLabelText('Название'), 'Полуторачасовой блок')
    await user.selectOptions(screen.getByLabelText('Единица длительности'), 'hours')
    const duration = screen.getByLabelText('Длительность')
    await user.clear(duration)
    await user.type(duration, '1.5')

    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(onClose).toHaveBeenCalledOnce()
    const saved = await waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      const task = state.tasks.find((item: Task) => item.title === 'Полуторачасовой блок') as Task | undefined
      expect(task?.plannedDurationMinutes).toBe(90)
      return task!
    })
    view.unmount()

    await mountEditor(saved)
    expect(screen.getByLabelText('Длительность')).toHaveValue(90)
    expect(screen.getByText(/^1 ч 30 мин\./)).toBeInTheDocument()
  })

  it.each([1, 1_439])('keeps %s canonical minutes when switching duration units', async (minutes) => {
    const user = userEvent.setup()
    await renderEditor(undefined, { plannedDurationMinutes: minutes })

    await user.selectOptions(screen.getByLabelText('Единица длительности'), 'hours')
    await user.selectOptions(screen.getByLabelText('Единица длительности'), 'minutes')

    expect(screen.getByLabelText('Длительность')).toHaveValue(minutes)
  })

  it('keeps a timed block within its local day and allows it to end exactly at midnight', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor()
    await user.type(screen.getByLabelText('Название'), 'Вечерний блок')
    await user.type(screen.getByLabelText('Начало'), '21.08.2026, 23:30')
    await user.tab()
    const duration = screen.getByLabelText('Длительность')
    await user.clear(duration)
    await user.type(duration, '31')

    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Длительность выходит за пределы дня')
    expect(screen.getByRole('alert')).toHaveTextContent('максимум 30 мин')
    expect(duration).toHaveFocus()
    expect(duration).toHaveAttribute('aria-invalid', 'true')
    expect(onClose).not.toHaveBeenCalled()

    await user.clear(duration)
    await user.type(duration, '30')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.tasks.find((item: Task) => item.title === 'Вечерний блок')?.plannedDurationMinutes).toBe(30)
    })
  })

  it('rejects duration outside the one-day storage range even without a start', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor()
    await user.type(screen.getByLabelText('Название'), 'Слишком длинная задача')
    const duration = screen.getByLabelText('Длительность')
    await user.clear(duration)
    await user.type(duration, '1441')

    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(screen.getByRole('alert')).toHaveTextContent('от 1 минуты до 24 часов')
    expect(duration).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()
  })
})

const recoveryData: TaskDraftData = {
  title: 'Восстановленный отчёт',
  description: 'Не потерять локальные изменения',
  projectId: 'work',
  allDay: false,
  allDayDate: '',
  startAt: '2026-08-21T09:00',
  deadline: '2026-08-21T18:00',
  plannedDurationMinutes: '',
  importance: 'high',
  urgencyThresholdOverrideHours: 24,
  urgencyOverride: 'high',
  tags: 'работа, восстановление',
  subtasks: [{ id: 'draft-subtask', title: 'Проверить цифры', completed: false }],
  pendingSubtaskTitle: 'Отправить письмо',
  reminders: [{ id: 'draft-reminder', at: '2026-08-21T17:00:00.000Z' }],
}

describe('TaskEditor recovery journal', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('writes meaningful changes only after the debounce interval', async () => {
    await renderEditor()
    vi.useFakeTimers()

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Черновик с задержкой' } })
    expect(localStorage.getItem(getTaskDraftStorageKey())).toBeNull()
    act(() => vi.advanceTimersByTime(TASK_DRAFT_DEBOUNCE_MS - 1))
    expect(localStorage.getItem(getTaskDraftStorageKey())).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(localStorage.getItem(getTaskDraftStorageKey())).toContain('Черновик с задержкой')
  })

  it('offers recovery without silently replacing the editor and restores all supported fields on request', async () => {
    const user = userEvent.setup()
    expect(writeTaskDraft(recoveryData).status).toBe('saved')
    await renderEditor()

    expect(screen.getByRole('status', { name: 'Найден несохранённый черновик' })).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveValue('')
    expect(screen.getByLabelText('Название').closest('.field')).toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Восстановить' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Восстановить' }))

    expect(screen.getByLabelText('Название')).toHaveValue(recoveryData.title)
    expect(screen.getByLabelText('Дополнительный текст')).toHaveValue(recoveryData.description)
    expect(screen.getByRole('combobox', { name: 'Проект' })).toHaveTextContent('Работа')
    expect(screen.getByRole('combobox', { name: 'Важность' })).toHaveTextContent('Важная')
    expect(screen.getByRole('combobox', { name: 'Порог срочности' })).toHaveTextContent('1 день')
    expect(screen.getByRole('combobox', { name: 'Срочность вручную' })).toHaveTextContent('Срочно')
    expect(screen.getByLabelText('Начало')).toHaveValue('21.08.2026, 09:00')
    expect(screen.getByLabelText('Дедлайн')).toHaveValue('21.08.2026, 18:00')
    expect(screen.getByLabelText('Длительность')).toBeDisabled()
    expect(screen.getByLabelText('Длительность')).toHaveValue(null)
    expect(screen.getByLabelText('Теги через запятую')).toHaveValue(recoveryData.tags)
    expect(screen.getByText('Проверить цифры')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Добавить подзадачу')).toHaveValue('Отправить письмо')
    expect(screen.getByLabelText('Время напоминания')).not.toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('Черновик восстановлен')
  })

  it('restores a duration draft without enabling a conflicting deadline', async () => {
    const user = userEvent.setup()
    expect(writeTaskDraft({
      ...recoveryData,
      deadline: '',
      plannedDurationMinutes: 90,
      urgencyThresholdOverrideHours: '',
      urgencyOverride: '',
    }).status).toBe('saved')
    await renderEditor()

    await user.click(screen.getByRole('button', { name: 'Восстановить' }))

    expect(screen.getByLabelText('Длительность')).toHaveValue(90)
    expect(screen.getByLabelText('Дедлайн')).toBeDisabled()
    expect(screen.queryByRole('combobox', { name: 'Срочность вручную' })).not.toBeInTheDocument()
  })

  it('restores an all-day draft without exposing conflicting timing controls', async () => {
    const user = userEvent.setup()
    expect(writeTaskDraft({
      ...recoveryData,
      allDay: true,
      allDayDate: '2026-08-23',
      startAt: '',
      deadline: '',
      plannedDurationMinutes: '',
      urgencyThresholdOverrideHours: '',
      urgencyOverride: '',
    }).status).toBe('saved')
    await renderEditor()

    await user.click(screen.getByRole('button', { name: 'Восстановить' }))

    expect(screen.getByRole('button', { name: 'Весь день' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Дата')).toHaveValue('2026-08-23')
    expect(screen.queryByLabelText('Начало')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Длительность')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Дедлайн')).not.toBeInTheDocument()
  })

  it('restores selected all-day mode when the required date was cleared before closing', async () => {
    const user = userEvent.setup()
    const firstEditor = await mountEditor()
    await user.click(screen.getByRole('button', { name: 'Весь день' }))
    await user.clear(screen.getByLabelText('Дата'))
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))

    expect(firstEditor.onClose).toHaveBeenCalledOnce()
    expect(readTaskDraft()?.data).toMatchObject({ allDay: true, allDayDate: '' })
    firstEditor.view.unmount()
    await renderEditor()

    await user.click(screen.getByRole('button', { name: 'Восстановить' }))

    expect(screen.getByRole('button', { name: 'Весь день' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Дата')).toHaveValue('')
    expect(screen.queryByLabelText('Начало')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Длительность')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Дедлайн')).not.toBeInTheDocument()
  })

  it('keeps a recovered legacy deadline but requires start before creating the task', async () => {
    const user = userEvent.setup()
    expect(writeTaskDraft({ ...recoveryData, startAt: '' }).status).toBe('saved')
    const onClose = await renderEditor()

    await user.click(screen.getByRole('button', { name: 'Восстановить' }))
    expect(screen.getByLabelText('Дедлайн')).toBeDisabled()
    expect(screen.getByLabelText('Дедлайн')).toHaveValue('21.08.2026, 18:00')

    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Сначала укажите корректное начало задачи')
    expect(screen.getByLabelText('Начало')).toHaveFocus()

    await user.type(screen.getByLabelText('Начало'), '21.08.2026, 09:00')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('ignores and removes a corrupt journal', async () => {
    const task = {
      ...createSeedState().tasks[0],
      updatedAt: '2026-08-23T10:00:00.000Z',
    }
    const key = getTaskDraftStorageKey(task.id)
    localStorage.setItem(key, '{broken')
    await renderEditor(task)
    expect(screen.queryByText('Найден несохранённый черновик')).not.toBeInTheDocument()
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('ignores and removes a journal older than the saved task', async () => {
    const task = {
      ...createSeedState().tasks[0],
      updatedAt: '2026-08-23T10:00:00.000Z',
    }
    const key = getTaskDraftStorageKey(task.id)
    expect(writeTaskDraft(recoveryData, task.id, '2026-08-20T10:00:00.000Z', Date.parse('2026-08-22T10:00:00.000Z')).status).toBe('saved')
    await renderEditor(task)
    expect(screen.queryByText('Найден несохранённый черновик')).not.toBeInTheDocument()
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('warns before offering a draft based on an older revision of the saved task', async () => {
    const task = {
      ...createSeedState().tasks[0],
      title: 'Более новая сохранённая версия',
      updatedAt: '2026-08-22T10:00:00.000Z',
    }
    expect(writeTaskDraft(recoveryData, task.id, '2026-08-20T10:00:00.000Z', Date.parse('2026-08-23T10:00:00.000Z')).status).toBe('saved')

    await renderEditor(task)

    expect(screen.getByLabelText('Название')).toHaveValue('Более новая сохранённая версия')
    expect(screen.getByText('Сохранённая задача изменялась позже')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Восстановить' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Удалить черновик' })).toBeInTheDocument()
  })

  it('preserves an immediate edit on ordinary close and removes it only on explicit discard', async () => {
    const user = userEvent.setup()
    const { onClose, view } = await mountEditor()
    await user.type(screen.getByLabelText('Название'), 'Оставить после закрытия')
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(localStorage.getItem(getTaskDraftStorageKey())).toContain('Оставить после закрытия')

    await user.click(screen.getByRole('button', { name: 'Удалить черновик и закрыть' }))
    expect(localStorage.getItem(getTaskDraftStorageKey())).toBeNull()
    view.unmount()
    expect(localStorage.getItem(getTaskDraftStorageKey())).toBeNull()
  })

  it('flushes an immediate change during unmount, as on the global Escape path', async () => {
    const { view } = await mountEditor()
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Черновик перед Escape' } })

    view.unmount()

    expect(localStorage.getItem(getTaskDraftStorageKey())).toContain('Черновик перед Escape')
  })

  it('clears the journal after a valid save', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor()
    await user.type(screen.getByLabelText('Название'), 'Сохранить без хвоста')
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(localStorage.getItem(getTaskDraftStorageKey())).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(getTaskDraftStorageKey())).toBeNull()
  })

  it('shows and executes the platform-neutral keyboard save shortcut', async () => {
    const onClose = await renderEditor()
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Быстро сохранить' } })
    expect(screen.getByText(/Ctrl\/Cmd \+ Enter/)).toBeVisible()

    fireEvent.keyDown(screen.getByLabelText('Название'), { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(localStorage.getItem(getTaskDraftStorageKey())).toBeNull()
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      expect(saved.tasks.some((item: Task) => item.title === 'Быстро сохранить')).toBe(true)
    })
  })

  it('commits a focused date field before saving with the keyboard shortcut', async () => {
    const onClose = await renderEditor(undefined, { startAt: '2026-08-21T09:00:00.000Z' })
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Срок через shortcut' } })
    const deadline = screen.getByLabelText('Дедлайн')
    fireEvent.change(deadline, { target: { value: '21.08.2026, 18:00' } })

    fireEvent.keyDown(deadline, { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      const task = saved.tasks.find((item: Task) => item.title === 'Срок через shortcut')
      expect(task?.deadline).toBe(new Date(2026, 7, 21, 18, 0).toISOString())
    })
  })

  it('keeps the editor open on Escape when an immediate journal flush fails', async () => {
    const user = userEvent.setup()
    const { onClose } = await mountEditor()
    const nativeSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === getTaskDraftStorageKey()) throw new DOMException('Blocked', 'SecurityError')
      return nativeSetItem.call(this, key, value)
    })
    await user.type(screen.getByLabelText('Название'), 'Не закрывать без journal')

    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить аварийный черновик')
    setItem.mockRestore()
    await user.click(screen.getByRole('button', { name: 'Удалить черновик и закрыть' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps a failed durable save recoverable and retries with one stable task id', async () => {
    const user = userEvent.setup()
    const storage = new ControlledTaskStorage()
    const { onClose } = await mountEditor(undefined, undefined, storage)
    await waitFor(() => expect(storage.initialSaves).toBeGreaterThan(0))
    storage.controlled = true
    await user.type(screen.getByLabelText('Название'), 'Durable retry')

    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))
    await waitFor(() => expect(storage.pending).toHaveLength(1))
    const firstId = storage.pending[0].state.tasks.find((task) => task.title === 'Durable retry')?.id
    expect(firstId).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(localStorage.getItem(getTaskDraftStorageKey())).not.toBeNull()

    storage.pending[0].reject(new Error('quota'))
    expect(await screen.findByText(/Не удалось надёжно сохранить задачу/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(localStorage.getItem(getTaskDraftStorageKey())).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))
    await waitFor(() => expect(storage.pending).toHaveLength(2))
    const retriedTasks = storage.pending[1].state.tasks.filter((task) => task.id === firstId)
    expect(retriedTasks).toHaveLength(1)
    expect(retriedTasks[0].title).toBe('Durable retry')
    storage.pending[1].resolve()

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(localStorage.getItem(getTaskDraftStorageKey())).toBeNull()
    expect(storage.persistedState?.tasks.filter((task) => task.id === firstId)).toHaveLength(1)
  })

  it('does not clear a newer same-key journal after a delayed durable success', async () => {
    const user = userEvent.setup()
    const storage = new ControlledTaskStorage()
    const { onClose } = await mountEditor(undefined, undefined, storage)
    await waitFor(() => expect(storage.initialSaves).toBeGreaterThan(0))
    storage.controlled = true
    await user.type(screen.getByLabelText('Название'), 'Сохраняемая версия')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))
    await waitFor(() => expect(storage.pending).toHaveLength(1))

    const newer = writeTaskDraft({ ...recoveryData, title: 'Черновик другой вкладки' })
    expect(newer.status).toBe('saved')
    storage.pending[0].resolve()

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(readTaskDraft()?.data.title).toBe('Черновик другой вкладки')
  })

  it('does not let the debounce create a stale journal during a delayed durable save', async () => {
    const storage = new ControlledTaskStorage()
    const { onClose } = await mountEditor(undefined, undefined, storage)
    await waitFor(() => expect(storage.initialSaves).toBeGreaterThan(0))
    storage.controlled = true
    vi.useFakeTimers()

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Медленное сохранение' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))
    expect(storage.pending).toHaveLength(1)
    expect(localStorage.getItem(getTaskDraftStorageKey())).not.toBeNull()

    act(() => vi.advanceTimersByTime(TASK_DRAFT_DEBOUNCE_MS + 1))
    await act(async () => {
      storage.pending[0].resolve()
      await Promise.resolve()
    })

    expect(onClose).toHaveBeenCalledOnce()
    expect(localStorage.getItem(getTaskDraftStorageKey())).toBeNull()
  })

  it('clears the matching recovered journal when every field returns to its initial value', async () => {
    const initialExceptTitle: TaskDraftData = {
      title: 'Временный текст',
      description: '',
      projectId: 'inbox',
      allDay: false,
      allDayDate: '',
      startAt: '',
      deadline: '',
      plannedDurationMinutes: '',
      importance: 'low',
      urgencyThresholdOverrideHours: '',
      urgencyOverride: '',
      tags: '',
      subtasks: [],
      pendingSubtaskTitle: '',
      reminders: [],
    }
    expect(writeTaskDraft(initialExceptTitle).status).toBe('saved')
    const { onClose } = await mountEditor()

    fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: '' } })
    await waitFor(() => expect(localStorage.getItem(getTaskDraftStorageKey())).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not clear a newer cross-tab journal when restored fields return to initial values', async () => {
    const initialExceptTitle: TaskDraftData = {
      title: 'Старый локальный текст',
      description: '',
      projectId: 'inbox',
      allDay: false,
      allDayDate: '',
      startAt: '',
      deadline: '',
      plannedDurationMinutes: '',
      importance: 'low',
      urgencyThresholdOverrideHours: '',
      urgencyOverride: '',
      tags: '',
      subtasks: [],
      pendingSubtaskTitle: '',
      reminders: [],
    }
    expect(writeTaskDraft(initialExceptTitle).status).toBe('saved')
    const { onClose } = await mountEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }))
    expect(writeTaskDraft({ ...initialExceptTitle, title: 'Новая версия другой вкладки' }).status).toBe('saved')

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(readTaskDraft()?.data.title).toBe('Новая версия другой вкладки')
  })

  it('keeps the task journal and editor open when durable trash persistence fails', async () => {
    const user = userEvent.setup()
    const storage = new ControlledTaskStorage()
    const task = createSeedState().tasks[0]
    const { onClose } = await mountEditor(task, undefined, storage)
    await waitFor(() => expect(storage.initialSaves).toBeGreaterThan(0))
    storage.controlled = true

    await user.click(screen.getByRole('button', { name: 'В корзину' }))
    await waitFor(() => expect(storage.pending).toHaveLength(1))
    expect(storage.pending[0].state.tasks.find((item) => item.id === task.id)?.status).toBe('deleted')
    expect(localStorage.getItem(getTaskDraftStorageKey(task.id))).not.toBeNull()
    storage.pending[0].reject(new Error('quota'))

    expect(await screen.findByText(/Не удалось надёжно переместить задачу в корзину/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(localStorage.getItem(getTaskDraftStorageKey(task.id))).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'В корзину' }))
    await waitFor(() => expect(storage.pending).toHaveLength(2))
    storage.pending[1].resolve()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(localStorage.getItem(getTaskDraftStorageKey(task.id))).toBeNull()
  })
})

async function previewAndApply(transcript: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Надиктовать задачу' }))
  await user.type(screen.getByLabelText('Фраза для разбора задачи'), transcript)
  await user.click(screen.getByRole('button', { name: 'Разобрать' }))
  await user.click(screen.getByRole('button', { name: 'Применить' }))
}

describe('TaskEditor voice input', () => {
  it('keeps the manual fallback phrase available after cancelling its preview', async () => {
    const user = userEvent.setup()
    await renderEditor()

    await user.click(screen.getByRole('button', { name: 'Надиктовать задачу' }))
    const command = screen.getByLabelText('Фраза для разбора задачи')
    await user.type(command, 'Позвонить врачу завтра в 10')
    await user.click(screen.getByRole('button', { name: 'Разобрать' }))
    await user.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(command).toHaveValue('Позвонить врачу завтра в 10')
    expect(screen.getByText('Голосовой ввод не поддерживается этим браузером')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Применить' })).not.toBeInTheDocument()
  })

  it('applies an unmarked spoken date to the start and leaves the deadline empty', async () => {
    await renderEditor()
    await previewAndApply('Запланировать встречу завтра в 10')

    await waitFor(() => expect((screen.getByLabelText('Начало') as HTMLInputElement).value).toMatch(/10:00$/))
    expect(screen.getByLabelText('Дедлайн')).toHaveValue('')
  })

  it('requires an existing start before applying a spoken deadline', async () => {
    await renderEditor()
    await previewAndApply('Сдать отчёт дедлайн завтра в 12:30')

    expect(screen.getByLabelText('Начало')).toHaveValue('')
    expect(screen.getByLabelText('Дедлайн')).toHaveValue('')
    expect(screen.getByRole('alert')).toHaveTextContent('Сначала укажите корректное начало задачи')
    expect(screen.getByLabelText('Начало')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Применить' })).toBeInTheDocument()
  })

  it('does not silently replace a duration with a spoken deadline', async () => {
    await renderEditor(undefined, {
      startAt: '2026-08-21T09:00:00.000Z',
      plannedDurationMinutes: 90,
    })

    await previewAndApply('Сдать отчёт дедлайн завтра в 12:30')

    expect(screen.getByLabelText('Длительность')).toHaveValue(90)
    expect(screen.getByLabelText('Длительность')).toHaveFocus()
    expect(screen.getByLabelText('Дедлайн')).toHaveValue('')
    expect(screen.getByRole('alert')).toHaveTextContent('Сначала очистите длительность')
    expect(screen.getByRole('button', { name: 'Применить' })).toBeInTheDocument()
  })

  it('preserves an existing deadline when an unmarked spoken date changes the start', async () => {
    const task = {
      ...createSeedState().tasks[0],
      startAt: '2026-08-01T08:00:00.000Z',
      deadline: '2026-08-03T15:00:00.000Z',
    }
    await renderEditor(task)
    await previewAndApply('Перенести встречу завтра в 11')

    await waitFor(() => expect((screen.getByLabelText('Начало') as HTMLInputElement).value).toMatch(/11:00$/))
    expect(screen.getByLabelText('Дедлайн')).toHaveValue(formatExpectedLocalDateTime(task.deadline))
  })

  it('preserves an existing start when the spoken date changes the deadline', async () => {
    const task = {
      ...createSeedState().tasks[0],
      startAt: '2026-08-01T08:00:00.000Z',
      deadline: '2026-08-03T15:00:00.000Z',
    }
    await renderEditor(task)
    const initialStart = (screen.getByLabelText('Начало') as HTMLInputElement).value
    await previewAndApply('Перенести встречу дедлайн завтра в 16')

    expect(screen.getByLabelText('Начало')).toHaveValue(initialStart)
    await waitFor(() => expect((screen.getByLabelText('Дедлайн') as HTMLInputElement).value).toMatch(/16:00$/))
  })

  it('resets stale date validation when voice input replaces an invalid manual value', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor(undefined, { startAt: '2026-02-28T09:00:00.000Z' })
    const deadline = screen.getByLabelText('Дедлайн')
    await user.type(deadline, '31.02.2026, 18:00')
    await user.tab()
    expect(deadline).toHaveAttribute('aria-invalid', 'true')

    await previewAndApply('Подготовить отчёт завтра в 10')
    expect(deadline).toHaveValue('')
    expect(deadline).toHaveAttribute('aria-invalid', 'false')

    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByText('Исправьте дату и время перед сохранением')).not.toBeInTheDocument()
  })
})
