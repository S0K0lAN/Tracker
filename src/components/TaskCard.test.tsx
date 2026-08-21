import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { RouterProvider } from '../core/router/Router'
import { AppProvider } from '../state/AppContext'
import { formatTaskDate } from './TaskCard'

function renderInbox() {
  return render(
    <RouterProvider initialPath="/inbox">
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  )
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
})
