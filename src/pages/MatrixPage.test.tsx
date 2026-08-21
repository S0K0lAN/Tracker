import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Importance, Task, TaskStatus } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { MatrixPage } from './MatrixPage'

const STORAGE_KEY = 'focus-flow.state.v1'

describe('Matrix project urgency thresholds', () => {
  it('places active tasks in all four quadrants and excludes inactive statuses', async () => {
    const state = createSeedState()
    const base = state.tasks[0]
    const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    state.projects = state.projects.map((project) => ({
      ...project,
      urgencyThresholdHours: project.id === 'work' ? 48 : project.id === 'personal' ? 12 : project.urgencyThresholdHours,
    }))
    const makeTask = (
      id: string,
      title: string,
      importance: Importance,
      projectId: string,
      status: TaskStatus = 'active',
    ): Task => ({
      ...base,
      id,
      title,
      importance,
      projectId,
      status,
      startAt: undefined,
      deadline,
      urgencyThresholdOverrideHours: undefined,
      urgencyOverride: undefined,
    })
    state.tasks = [
      makeTask('high-high', 'Важно срочно по проекту', 'high', 'work'),
      makeTask('high-low', 'Важно спокойно по проекту', 'high', 'personal'),
      makeTask('low-high', 'Обычно срочно по проекту', 'low', 'work'),
      makeTask('low-low', 'Обычно спокойно по проекту', 'low', 'personal'),
      makeTask('completed', 'Завершённая вне матрицы', 'high', 'work', 'completed'),
      makeTask('archived', 'Архивная вне матрицы', 'high', 'work', 'archived'),
      makeTask('deleted', 'Удалённая вне матрицы', 'high', 'work', 'deleted'),
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    render(<AppProvider><MatrixPage onEditTask={vi.fn()} /></AppProvider>)
    await act(async () => { await Promise.resolve() })

    const quadrant = (name: string) => screen.getByRole('heading', { name }).closest('article') as HTMLElement
    expect(within(quadrant('Важно и срочно')).getByText('Важно срочно по проекту')).toBeInTheDocument()
    expect(within(quadrant('Важно, не срочно')).getByText('Важно спокойно по проекту')).toBeInTheDocument()
    expect(within(quadrant('Не важно, срочно')).getByText('Обычно срочно по проекту')).toBeInTheDocument()
    expect(within(quadrant('Не важно, не срочно')).getByText('Обычно спокойно по проекту')).toBeInTheDocument()
    expect(screen.queryByText('Завершённая вне матрицы')).not.toBeInTheDocument()
    expect(screen.queryByText('Архивная вне матрицы')).not.toBeInTheDocument()
    expect(screen.queryByText('Удалённая вне матрицы')).not.toBeInTheDocument()
  })
})
