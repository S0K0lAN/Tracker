import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { RouterProvider } from '../core/router/Router'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { formatTaskDate } from './TaskCard'

function renderInbox(onlyTask = false) {
  const state = createSeedState()
  const task = state.tasks.find((item) => item.id === 'task-plan')!
  task.projectId = 'inbox'
  task.startAt = undefined
  task.deadline = undefined
  if (onlyTask) state.tasks = [task]
  localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
  return render(
    <RouterProvider initialPath="/inbox">
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  )
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
