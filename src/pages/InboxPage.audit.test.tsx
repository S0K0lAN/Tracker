import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { InboxPage } from './InboxPage'

const STORAGE_KEY = 'focus-flow.state.v1'

afterEach(() => vi.useRealTimers())

describe('Inbox live day summary', () => {
  it('uses the current weekday, counts start or deadline once, and refreshes urgency with the shared clock', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 21, 12, 0, 0))
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
      makeTask({ id: 'start-only', title: 'Только начало', startAt: '2026-08-21T09:00:00.000+03:00' }),
      makeTask({ id: 'deadline-only', title: 'Только дедлайн', deadline: '2026-08-21T12:31:00.000+03:00', urgencyThresholdHours: 0.5 }),
      makeTask({ id: 'both', title: 'Начало и дедлайн', startAt: '2026-08-21T10:00:00.000+03:00', deadline: '2026-08-21T18:00:00.000+03:00', urgencyThresholdHours: 1 }),
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    render(<AppProvider><InboxPage onEditTask={vi.fn()} /></AppProvider>)
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText('Пятница · обзор дня')).toBeInTheDocument()
    const summary = screen.getByRole('region', { name: 'Сводка' })
    expect(within(summary).getByText('На сегодня').nextElementSibling).toHaveTextContent('3')
    expect(within(summary).getByText('Срочные').nextElementSibling).toHaveTextContent('0')

    act(() => {
      vi.setSystemTime(new Date(2026, 7, 21, 12, 2, 0))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(within(summary).getByText('Срочные').nextElementSibling).toHaveTextContent('1')
  })
})
