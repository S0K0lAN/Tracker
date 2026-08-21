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
      urgencyThresholdHours: 72,
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
})
