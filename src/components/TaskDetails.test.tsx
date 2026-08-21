import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { RouterProvider } from '../core/router/Router'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'

function renderInbox() {
  const state = createSeedState()
  const task = state.tasks.find((item) => item.id === 'task-plan')!
  task.projectId = 'inbox'
  task.startAt = undefined
  task.deadline = undefined
  localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
  return render(
    <RouterProvider initialPath="/inbox">
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  )
}

function taskCard(title: string) {
  const heading = screen.getByText(title, { selector: '.task-card__title' })
  const card = heading.closest<HTMLElement>('.task-card')
  if (!card) throw new Error(`Task card was not found: ${title}`)
  return card
}

describe('task details', () => {
  it('opens an existing task in read mode and enters editing only after an explicit action', async () => {
    const user = userEvent.setup()
    renderInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    const card = taskCard('Подготовить план недели')
    const opener = card.querySelector<HTMLButtonElement>('.task-card__body')!
    await user.click(opener)

    const details = screen.getByRole('dialog', { name: 'Подготовить план недели' })
    expect(within(details).queryByLabelText('Название')).not.toBeInTheDocument()
    expect(within(details).getByText('Сверить встречи и выбрать три главных результата.')).toBeInTheDocument()
    expect(within(details).getAllByText('Без проекта').length).toBeGreaterThan(0)
    expect(within(details).getByText('#планирование')).toBeInTheDocument()
    expect(within(details).getByRole('checkbox', { name: 'Проверить календарь' })).toBeChecked()

    await user.click(within(details).getByRole('button', { name: 'Редактировать' }))

    const editor = screen.getByRole('dialog', { name: 'Подготовить план недели' })
    expect(within(editor).getByLabelText('Название')).toHaveValue('Подготовить план недели')
    expect(within(editor).getByRole('button', { name: 'Сохранить' })).toBeInTheDocument()

    await user.click(within(editor).getByRole('button', { name: 'Закрыть редактор' }))
    const reopenedDetails = screen.getByRole('dialog', { name: 'Подготовить план недели' })
    expect(within(reopenedDetails).queryByLabelText('Название')).not.toBeInTheDocument()
    await user.click(within(reopenedDetails).getByRole('button', { name: 'Закрыть задачу' }))
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('makes the task toolbar actions observable and keeps subtask changes in the view', async () => {
    const user = userEvent.setup()
    renderInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    const card = taskCard('Подготовить план недели')
    await user.click(card.querySelector<HTMLButtonElement>('.task-card__body')!)
    let details = screen.getByRole('dialog', { name: 'Подготовить план недели' })

    const subtask = within(details).getByRole('checkbox', { name: 'Определить приоритеты' })
    await user.click(subtask)
    expect(subtask).toBeChecked()
    expect(within(details).getByText('2/3')).toBeInTheDocument()

    await user.click(within(details).getByRole('button', { name: 'Завершить' }))
    details = screen.getByRole('dialog', { name: 'Подготовить план недели' })
    expect(within(details).getByText('Выполнена')).toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Вернуть в работу' })).toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Архивировать' })).toBeInTheDocument()

    await user.click(within(details).getByRole('button', { name: 'Вернуть в работу' }))
    expect(within(details).getByText('Активная задача')).toBeInTheDocument()
  })

  it('opens the Pomodoro from read mode and exposes its controls instead of leaving the click silent', async () => {
    const user = userEvent.setup()
    renderInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(taskCard('Подготовить план недели').querySelector<HTMLButtonElement>('.task-card__body')!)
    const details = screen.getByRole('dialog', { name: 'Подготовить план недели' })
    await user.click(within(details).getByRole('button', { name: 'Таймер · 25 минут' }))

    expect(screen.queryByRole('dialog', { name: 'Подготовить план недели' })).not.toBeInTheDocument()
    const timer = screen.getByRole('complementary', { name: 'Таймер фокуса' })
    expect(within(timer).getByText('Подготовить план недели', { exact: true })).toBeInTheDocument()
    expect(within(timer).getByRole('button', { name: 'Запустить таймер' })).toBeInTheDocument()
    await waitFor(() => expect(within(timer).getByRole('button', { name: 'Запустить таймер' })).toHaveFocus())
  })

  it('opens read mode from the ellipsis menu and restores focus to the menu trigger', async () => {
    const user = userEvent.setup()
    renderInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    const trigger = screen.getByRole('button', { name: 'Действия задачи Подготовить план недели' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Открыть' }))

    const details = screen.getByRole('dialog', { name: 'Подготовить план недели' })
    expect(within(details).queryByLabelText('Название')).not.toBeInTheDocument()
    await user.click(within(details).getByRole('button', { name: 'Закрыть задачу' }))

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('returns focus to the durable page heading after editing and moving the task to trash', async () => {
    const user = userEvent.setup()
    renderInbox()
    const heading = await screen.findByRole('heading', { name: 'Входящие', level: 1 })
    await user.click(taskCard('Подготовить план недели').querySelector<HTMLButtonElement>('.task-card__body')!)
    await user.click(screen.getByRole('button', { name: 'Редактировать' }))
    const editor = screen.getByRole('dialog', { name: 'Подготовить план недели' })

    await user.click(within(editor).getByRole('button', { name: 'В корзину' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Подготовить план недели' })).not.toBeInTheDocument())
    await waitFor(() => expect(heading).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
  })
})
