import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { InboxPage } from './InboxPage'

const STORAGE_KEY = 'focus-flow.state.v1'

describe('Inbox header', () => {
  it('defaults to unassigned undated tasks and restores the complete view through All', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    const base = state.tasks[0]
    const makeTask = (task: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({
      ...base,
      status: 'active',
      startAt: undefined,
      deadline: undefined,
      urgencyThresholdOverrideHours: undefined,
      urgencyOverride: undefined,
      ...task,
    })
    state.tasks = [
      makeTask({ id: 'inbox', title: 'Неразобранная', projectId: 'inbox' }),
      makeTask({ id: 'project', title: 'В проекте', projectId: 'work' }),
      makeTask({ id: 'start-only', title: 'С началом', projectId: 'inbox', startAt: '2026-08-21T09:00:00.000+03:00' }),
      makeTask({ id: 'deadline-only', title: 'С дедлайном', projectId: 'inbox', deadline: '2026-08-21T12:31:00.000+03:00' }),
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    render(<AppProvider><InboxPage onEditTask={vi.fn()} /></AppProvider>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText('Очередь разбора')).toBeInTheDocument()
    expect(screen.getByText('Неразобранных задач: 1')).toBeInTheDocument()
    expect(screen.getByText('Неразобранная')).toBeInTheDocument()
    expect(screen.queryByText('В проекте')).not.toBeInTheDocument()
    expect(screen.queryByText('С началом')).not.toBeInTheDocument()
    expect(screen.queryByText('С дедлайном')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Сводка' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Вид: Список' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    expect(screen.getByRole('button', { name: 'Неразобранные' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Все' }))

    expect(screen.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Неразобранные' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Общий обзор')).toBeInTheDocument()
    expect(screen.getByText('Активных задач: 4')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Все задачи' })).toBeInTheDocument()
    expect(screen.getByText('Неразобранная')).toBeInTheDocument()
    expect(screen.getByText('В проекте')).toBeInTheDocument()
    expect(screen.getByText('С началом')).toBeInTheDocument()
    expect(screen.getByText('С дедлайном')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сегодня' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Фильтр по проекту во входящих' })).not.toBeInTheDocument()
  })

  it('uses each task project threshold in the urgent filter', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    const base = state.tasks[0]
    const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    state.projects = state.projects.map((project) => ({
      ...project,
      urgencyThresholdHours: project.id === 'work' ? 48 : project.id === 'personal' ? 12 : project.urgencyThresholdHours,
    }))
    state.tasks = [
      { ...base, id: 'project-urgent', title: 'Срочная по проекту', projectId: 'work', deadline, startAt: undefined, urgencyThresholdOverrideHours: undefined, urgencyOverride: undefined },
      { ...base, id: 'project-calm', title: 'Несрочная по проекту', projectId: 'personal', deadline, startAt: undefined, urgencyThresholdOverrideHours: undefined, urgencyOverride: undefined },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    render(<AppProvider><InboxPage onEditTask={vi.fn()} /></AppProvider>)
    await act(async () => { await Promise.resolve() })

    await user.click(screen.getByRole('button', { name: /Фильтры/ }))
    await user.click(screen.getByRole('button', { name: 'Срочные' }))

    expect(screen.getByText('Срочная по проекту')).toBeInTheDocument()
    expect(screen.queryByText('Несрочная по проекту')).not.toBeInTheDocument()
  })

  it('archives only completed tasks visible through the selected quick filter', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    const base = state.tasks[0]
    const today = new Date()
    today.setHours(10, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    state.tasks = [
      { ...base, id: 'completed-today', title: 'Завершена сегодня', status: 'completed', startAt: today.toISOString(), deadline: undefined, completedAt: today.toISOString() },
      { ...base, id: 'completed-tomorrow', title: 'Завершена завтра', status: 'completed', startAt: tomorrow.toISOString(), deadline: undefined, completedAt: today.toISOString() },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    render(<AppProvider><InboxPage onEditTask={vi.fn()} /></AppProvider>)
    await act(async () => { await Promise.resolve() })

    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.click(screen.getByRole('button', { name: 'Сегодня' }))
    await user.click(screen.getByRole('button', { name: 'Показать завершённые' }))

    expect(screen.getByText('Завершена сегодня')).toBeInTheDocument()
    expect(screen.queryByText('Завершена завтра')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Архивировать' }))

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as { tasks: Task[] }
      expect(stored.tasks.find((task) => task.id === 'completed-today')?.status).toBe('archived')
      expect(stored.tasks.find((task) => task.id === 'completed-tomorrow')?.status).toBe('completed')
    })
  })
})
