import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import type { StorageAdapter } from '../core/storage/StorageAdapter'
import type { AppState } from '../domain/models'
import { AppProvider } from '../state/AppContext'
import { TaskEditor } from './TaskEditor'
import {
  getTaskDraftStorageKey,
  readTaskDraft,
  TASK_DRAFT_DEBOUNCE_MS,
  writeTaskDraft,
  type TaskDraftData,
} from './taskDraftJournal'

const STORAGE_KEY = 'focus-flow.state.v1'

async function mountEditor(
  task?: Task,
  defaults?: Partial<Pick<Task, 'projectId' | 'startAt' | 'deadline'>>,
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
  defaults?: Partial<Pick<Task, 'projectId' | 'startAt' | 'deadline'>>,
) {
  const { onClose } = await mountEditor(task, defaults)
  return onClose
}

describe('TaskEditor defaults and date validation', () => {
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

  it('blocks a deadline earlier than the start, announces the error and focuses the deadline', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor()
    await user.type(screen.getByLabelText('Название'), 'Задача с неверным сроком')
    await user.type(screen.getByLabelText('Начало'), '21.08.2026, 12:00')
    await user.tab()
    await user.type(screen.getByLabelText('Дедлайн'), '21.08.2026, 11:00')
    await user.tab()

    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Дедлайн не может быть раньше начала')
    expect(screen.getByLabelText('Дедлайн')).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()
  })
})

const recoveryData: TaskDraftData = {
  title: 'Восстановленный отчёт',
  description: 'Не потерять локальные изменения',
  projectId: 'work',
  startAt: '2026-08-21T09:00',
  deadline: '2026-08-21T18:00',
  importance: 'high',
  urgencyThresholdHours: 24,
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
    expect(screen.getByLabelText('Теги через запятую')).toHaveValue(recoveryData.tags)
    expect(screen.getByText('Проверить цифры')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Добавить подзадачу')).toHaveValue('Отправить письмо')
    expect(screen.getByLabelText('Время напоминания')).not.toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('Черновик восстановлен')
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
    const onClose = await renderEditor()
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
      startAt: '',
      deadline: '',
      importance: 'low',
      urgencyThresholdHours: createSeedState().settings.defaultUrgencyThresholdHours,
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
      startAt: '',
      deadline: '',
      importance: 'low',
      urgencyThresholdHours: createSeedState().settings.defaultUrgencyThresholdHours,
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
  it('applies an unmarked spoken date to the start and leaves the deadline empty', async () => {
    await renderEditor()
    await previewAndApply('Запланировать встречу завтра в 10')

    await waitFor(() => expect((screen.getByLabelText('Начало') as HTMLInputElement).value).toMatch(/10:00$/))
    expect(screen.getByLabelText('Дедлайн')).toHaveValue('')
  })

  it('applies a date with a deadline marker only to the deadline field', async () => {
    await renderEditor()
    await previewAndApply('Сдать отчёт дедлайн завтра в 12:30')

    expect(screen.getByLabelText('Начало')).toHaveValue('')
    await waitFor(() => expect((screen.getByLabelText('Дедлайн') as HTMLInputElement).value).toMatch(/12:30$/))
  })

  it('clears an existing deadline when an unmarked spoken date becomes the start', async () => {
    const task = {
      ...createSeedState().tasks[0],
      startAt: '2026-08-01T08:00:00.000Z',
      deadline: '2026-08-03T15:00:00.000Z',
    }
    await renderEditor(task)
    await previewAndApply('Перенести встречу завтра в 11')

    await waitFor(() => expect((screen.getByLabelText('Начало') as HTMLInputElement).value).toMatch(/11:00$/))
    expect(screen.getByLabelText('Дедлайн')).toHaveValue('')
  })

  it('clears an existing start when the spoken date is explicitly a deadline', async () => {
    const task = {
      ...createSeedState().tasks[0],
      startAt: '2026-08-01T08:00:00.000Z',
      deadline: '2026-08-03T15:00:00.000Z',
    }
    await renderEditor(task)
    await previewAndApply('Перенести встречу дедлайн завтра в 16')

    expect(screen.getByLabelText('Начало')).toHaveValue('')
    await waitFor(() => expect((screen.getByLabelText('Дедлайн') as HTMLInputElement).value).toMatch(/16:00$/))
  })

  it('resets stale date validation when voice input replaces an invalid manual value', async () => {
    const user = userEvent.setup()
    const onClose = await renderEditor()
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
