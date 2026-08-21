import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { TaskEditor } from './TaskEditor'

const STORAGE_KEY = 'focus-flow.state.v1'

async function renderEditor(
  task?: Task,
  defaults?: Partial<Pick<Task, 'projectId' | 'startAt' | 'deadline'>>,
) {
  const onClose = vi.fn()
  render(
    <AppProvider>
      <TaskEditor task={task} defaults={defaults} onClose={onClose} />
    </AppProvider>,
  )
  await screen.findByRole('dialog', { name: task?.title ?? 'Что нужно сделать?' })
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
