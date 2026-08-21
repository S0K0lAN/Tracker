import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { RouterProvider } from '../core/router/Router'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'

const STORAGE_KEY = 'focus-flow.state.v1'

afterEach(() => {
  vi.useRealTimers()
})

describe('application clock', () => {
  it('refreshes a route without its own clock subscription across local midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 21, 23, 59, 30))
    const state = createSeedState()
    const template = state.tasks[0]
    state.tasks = [
      {
        ...template,
        id: 'before-midnight',
        title: 'Задача уходящего дня',
        startAt: new Date(2026, 7, 21, 12).toISOString(),
        deadline: undefined,
        status: 'active',
      },
      {
        ...template,
        id: 'after-midnight',
        title: 'Задача нового дня',
        startAt: new Date(2026, 7, 22, 9).toISOString(),
        deadline: undefined,
        status: 'active',
      },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    const view = render(
      <RouterProvider initialPath="/today">
        <AppProvider><App /></AppProvider>
      </RouterProvider>,
    )
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText('Задача уходящего дня')).toBeInTheDocument()
    expect(screen.queryByText('Задача нового дня')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(31_000))

    expect(screen.queryByText('Задача уходящего дня')).not.toBeInTheDocument()
    expect(screen.getByText('Задача нового дня')).toBeInTheDocument()
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
