import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { RouterProvider } from '../core/router/Router'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { formatAllDayTaskDate, formatTaskDate } from './TaskCard'

function renderStoredInbox() {
  return render(
    <RouterProvider initialPath="/inbox">
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  )
}

function renderInbox(onlyTask = false) {
  const state = createSeedState()
  const task = state.tasks.find((item) => item.id === 'task-plan')!
  task.projectId = 'inbox'
  task.startAt = undefined
  task.deadline = undefined
  if (onlyTask) state.tasks = [task]
  localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
  return renderStoredInbox()
}

function storeSingleActiveTask(configure: (task: ReturnType<typeof createSeedState>['tasks'][number]) => void) {
  const state = createSeedState()
  const task = state.tasks.find((item) => item.id === 'task-plan')!
  configure(task)
  state.tasks = [task]
  localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
}

describe('TaskCard safety and focus', () => {
  it('formats invalid persisted dates without throwing a RangeError', () => {
    expect(() => formatTaskDate('not-a-date')).not.toThrow()
    expect(formatTaskDate('not-a-date')).toBe('Некорректная дата')
    expect(formatAllDayTaskDate('2026-02-30')).toBe('Некорректная дата')
  })

  it('shows a date-only task without inventing time, deadline or urgency', async () => {
    const user = userEvent.setup()
    storeSingleActiveTask((task) => {
      task.startAt = undefined
      task.plannedDurationMinutes = undefined
      task.deadline = undefined
      task.allDayDate = '2026-09-01'
      task.urgencyOverride = undefined
      task.urgencyThresholdOverrideHours = undefined
    })
    renderStoredInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.click(screen.getByRole('button', { name: 'Все' }))

    const card = screen
      .getByText('Подготовить план недели', { selector: '.task-card__title' })
      .closest<HTMLElement>('.task-card')!
    expect(within(card).getByText(/1 сент. 2026 г. · весь день/)).toBeInTheDocument()
    expect(within(card).queryByText('Срочно')).not.toBeInTheDocument()
    expect(within(card).queryByText('Не срочно')).not.toBeInTheDocument()
  })

  it('renders urgency from the task project threshold', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    const base = state.tasks.find((item) => item.id === 'task-plan')!
    const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    state.projects = state.projects.map((project) => ({
      ...project,
      urgencyThresholdHours: project.id === 'work' ? 48 : project.id === 'personal' ? 12 : project.urgencyThresholdHours,
    }))
    state.tasks = [
      { ...base, id: 'card-urgent', title: 'Карточка срочная', projectId: 'work', deadline, urgencyThresholdOverrideHours: undefined, urgencyOverride: undefined },
      { ...base, id: 'card-calm', title: 'Карточка несрочная', projectId: 'personal', deadline, urgencyThresholdOverrideHours: undefined, urgencyOverride: undefined },
      { ...base, id: 'card-manual-low', title: 'Карточка явно несрочная', projectId: 'work', deadline, urgencyThresholdOverrideHours: undefined, urgencyOverride: 'low' },
    ]
    localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))

    renderStoredInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.click(screen.getByRole('button', { name: 'Все' }))

    const urgentCard = (await screen.findByText('Карточка срочная')).closest('.task-card')
    const calmCard = screen.getByText('Карточка несрочная').closest('.task-card')
    const manualLowCard = screen.getByText('Карточка явно несрочная').closest('.task-card')
    expect(urgentCard).not.toBeNull()
    expect(calmCard).not.toBeNull()
    expect(within(urgentCard as HTMLElement).getByText('Срочно')).toBeInTheDocument()
    expect(within(calmCard as HTMLElement).queryByText('Не срочно')).not.toBeInTheDocument()
    expect(within(manualLowCard as HTMLElement).getByText('Не срочно')).toBeInTheDocument()
  })

  it('does not show urgency for a task without a deadline', async () => {
    renderInbox(true)
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    const card = screen.getByText('Подготовить план недели', { selector: '.task-card__title' }).closest('.task-card')!
    expect(within(card as HTMLElement).queryByText('Срочно')).not.toBeInTheDocument()
    expect(within(card as HTMLElement).queryByText('Не срочно')).not.toBeInTheDocument()
  })

  it('moves focus to the Pomodoro primary action after starting it from the menu', async () => {
    const user = userEvent.setup()
    renderInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Действия задачи Подготовить план недели' }))
    await user.click(screen.getByRole('menuitem', { name: 'Таймер фокуса · 25 минут' }))

    const timer = screen.getByRole('complementary', { name: 'Таймер фокуса' })
    const primaryAction = within(timer).getByRole('button', { name: 'Запустить таймер' })
    await waitFor(() => expect(primaryAction).toHaveFocus())
  })

  it('moves focus to the next card when completing the focused task removes its card', async () => {
    const user = userEvent.setup()
    renderInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Завершить задачу Подготовить план недели' }))

    await waitFor(() => expect(document.activeElement?.closest('.task-card')).not.toBeNull())
    expect(document.activeElement).toHaveAccessibleName(/задач/i)
    expect(document.activeElement?.isConnected).toBe(true)
  })

  it('moves focus to the list heading when removing the only task', async () => {
    const user = userEvent.setup()
    renderInbox(true)
    const heading = await screen.findByRole('heading', { name: 'Неразобранные задачи', level: 2 })

    await user.click(screen.getByRole('button', { name: 'Действия задачи Подготовить план недели' }))
    await user.click(screen.getByRole('menuitem', { name: 'В корзину' }))

    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('moves focus to the durable Today page heading when its only task section disappears', async () => {
    const user = userEvent.setup()
    storeSingleActiveTask((task) => {
      const today = new Date()
      today.setHours(9, 0, 0, 0)
      task.startAt = today.toISOString()
      task.deadline = undefined
    })
    render(
      <RouterProvider initialPath="/today">
        <AppProvider>
          <App />
        </AppProvider>
      </RouterProvider>,
    )
    const pageHeading = await screen.findByRole('heading', { name: 'Сегодня', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Завершить задачу Подготовить план недели' }))

    await waitFor(() => expect(pageHeading).toHaveFocus())
  })

  it('moves focus to the durable Search page heading when its only result section disappears', async () => {
    const user = userEvent.setup()
    storeSingleActiveTask((task) => {
      task.title = 'Единственный результат'
    })
    render(
      <RouterProvider initialPath="/search">
        <AppProvider>
          <App />
        </AppProvider>
      </RouterProvider>,
    )
    const pageHeading = await screen.findByRole('heading', { name: 'Поиск', level: 1 })
    await user.type(screen.getByRole('textbox', { name: 'Глобальный поиск' }), 'Единственный результат')

    await user.click(screen.getByRole('button', { name: 'Завершить задачу Единственный результат' }))

    await waitFor(() => expect(pageHeading).toHaveFocus())
  })
})
