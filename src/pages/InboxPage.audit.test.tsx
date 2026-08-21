import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
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
    state.projects = state.projects.map((project) => ({
      ...project,
      urgencyThresholdHours: project.id === 'work' ? 0.5 : project.id === 'personal' ? 1 : project.urgencyThresholdHours,
    }))
    state.tasks = [
      makeTask({ id: 'start-only', title: 'Только начало', startAt: '2026-08-21T09:00:00.000+03:00' }),
      makeTask({ id: 'deadline-only', title: 'Только дедлайн', projectId: 'work', deadline: '2026-08-21T12:31:00.000+03:00' }),
      makeTask({ id: 'both', title: 'Начало и дедлайн', projectId: 'personal', startAt: '2026-08-21T10:00:00.000+03:00', deadline: '2026-08-21T18:00:00.000+03:00' }),
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

    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.click(screen.getByRole('button', { name: 'Все' }))

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

  it('uses each task project threshold in the summary and urgent filter', async () => {
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

    const summary = screen.getByRole('region', { name: 'Сводка' })
    expect(within(summary).getByText('Срочные').nextElementSibling).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: /Фильтры/ }))
    await user.click(screen.getByRole('button', { name: 'Срочные' }))

    expect(screen.getByText('Срочная по проекту')).toBeInTheDocument()
    expect(screen.queryByText('Несрочная по проекту')).not.toBeInTheDocument()
  })
})
