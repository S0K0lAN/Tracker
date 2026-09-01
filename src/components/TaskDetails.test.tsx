import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../App'
import { RouterProvider } from '../core/router/Router'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'

function renderStoredInbox() {
  return render(
    <RouterProvider initialPath="/inbox">
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  )
}

function renderInbox() {
  const state = createSeedState()
  const task = state.tasks.find((item) => item.id === 'task-plan')!
  task.projectId = 'inbox'
  task.startAt = undefined
  task.deadline = undefined
  task.plannedDurationMinutes = 60
  localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
  return renderStoredInbox()
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
    const durationFact = within(details).getByText('Длительность').closest<HTMLElement>('.task-details__schedule-item')!
    expect(within(durationFact).getByText('1 ч')).toBeInTheDocument()
    expect(within(details).getByText('Планирование')).toBeInTheDocument()
    expect(within(details).queryByText('Срочность')).not.toBeInTheDocument()
    expect(within(details).queryByText('Не срочная')).not.toBeInTheDocument()

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

  it('shows the effective threshold and distinguishes project inheritance from a task override', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    const project = state.projects.find((item) => item.id === 'work')!
    project.urgencyThresholdHours = 24
    const inheritedTask = state.tasks.find((item) => item.id === 'task-plan')!
    inheritedTask.title = 'Наследуемый порог'
    const individualTask = state.tasks.find((item) => item.id === 'task-team-sync')!
    individualTask.title = 'Индивидуальный порог'
    individualTask.plannedDurationMinutes = undefined
    individualTask.deadline = inheritedTask.deadline
    individualTask.urgencyThresholdOverrideHours = 168
    localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
    renderStoredInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.click(screen.getByRole('button', { name: 'Все' }))
    await screen.findByText('Наследуемый порог', { selector: '.task-card__title' })

    await user.click(taskCard('Наследуемый порог').querySelector<HTMLButtonElement>('.task-card__body')!)
    let details = screen.getByRole('dialog', { name: 'Наследуемый порог' })
    expect(within(details).getByText('24 ч до дедлайна')).toBeInTheDocument()
    expect(within(details).getByText('Наследуется из проекта «Работа»')).toBeInTheDocument()
    await user.click(within(details).getByRole('button', { name: 'Закрыть задачу' }))

    await user.click(taskCard('Индивидуальный порог').querySelector<HTMLButtonElement>('.task-card__body')!)
    details = screen.getByRole('dialog', { name: 'Индивидуальный порог' })
    expect(within(details).getByText('168 ч до дедлайна')).toBeInTheDocument()
    expect(within(details).getByText('Индивидуальный для задачи')).toBeInTheDocument()
  })

  it('shows no urgency before the automatic deadline window and preserves an explicit manual low state', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    const project = state.projects.find((item) => item.id === 'work')!
    project.urgencyThresholdHours = 24
    const automatic = state.tasks.find((item) => item.id === 'task-plan')!
    automatic.title = 'Пока без срочности'
    automatic.startAt = new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString()
    automatic.deadline = new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString()
    automatic.urgencyOverride = undefined
    const manualLow = state.tasks.find((item) => item.id === 'task-workout')!
    manualLow.title = 'Явно не срочная'
    manualLow.projectId = 'work'
    manualLow.urgencyOverride = 'low'
    localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
    renderStoredInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.click(screen.getByRole('button', { name: 'Все' }))

    await user.click(taskCard('Пока без срочности').querySelector<HTMLButtonElement>('.task-card__body')!)
    let details = screen.getByRole('dialog', { name: 'Пока без срочности' })
    expect(within(details).getByText('Нет срочности')).toBeInTheDocument()
    expect(within(details).getByText('Станет срочной за 24 ч до дедлайна')).toBeInTheDocument()
    await user.click(within(details).getByRole('button', { name: 'Закрыть задачу' }))

    await user.click(taskCard('Явно не срочная').querySelector<HTMLButtonElement>('.task-card__body')!)
    details = screen.getByRole('dialog', { name: 'Явно не срочная' })
    expect(within(details).getByText('Не срочная')).toBeInTheDocument()
    expect(within(details).getByText('Установлено вручную')).toBeInTheDocument()
  })

  it('does not predict future urgency for a completed deadline task', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    const completed = state.tasks.find((item) => item.id === 'task-plan')!
    completed.title = 'Завершённая задача со сроком'
    completed.status = 'completed'
    completed.completedAt = new Date().toISOString()
    completed.urgencyOverride = undefined
    localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
    renderStoredInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.click(screen.getByRole('button', { name: 'Все' }))
    await user.click(screen.getByRole('button', { name: 'Показать завершённые' }))
    await user.click(taskCard('Завершённая задача со сроком').querySelector<HTMLButtonElement>('.task-card__body')!)

    const details = screen.getByRole('dialog', { name: 'Завершённая задача со сроком' })
    expect(within(details).getByText('Нет срочности')).toBeInTheDocument()
    expect(within(details).getByText('Задача завершена')).toBeInTheDocument()
    expect(within(details).queryByText(/Станет срочной/)).not.toBeInTheDocument()
    expect(within(details).queryByText(/до дедлайна/)).not.toBeInTheDocument()
  })

  it('shows a date-only all-day schedule without empty timed or urgency facts', async () => {
    const user = userEvent.setup()
    const state = createSeedState()
    const allDayTask = state.tasks.find((item) => item.id === 'task-plan')!
    allDayTask.title = 'День без времени'
    allDayTask.projectId = 'inbox'
    allDayTask.allDayDate = '2026-08-23'
    allDayTask.startAt = undefined
    allDayTask.plannedDurationMinutes = undefined
    allDayTask.deadline = undefined
    allDayTask.urgencyThresholdOverrideHours = undefined
    allDayTask.urgencyOverride = undefined
    localStorage.setItem('focus-flow.state.v1', JSON.stringify(state))
    renderStoredInbox()
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Фильтры' }))
    await user.click(screen.getByRole('button', { name: 'Все' }))
    await user.click(taskCard('День без времени').querySelector<HTMLButtonElement>('.task-card__body')!)

    const details = screen.getByRole('dialog', { name: 'День без времени' })
    const schedule = within(details).getByText('Планирование').closest<HTMLElement>('.task-details__fact--schedule')!
    expect(within(schedule).getByText('Дата')).toBeInTheDocument()
    expect(within(schedule).getByText(/23 августа 2026/)).toBeInTheDocument()
    expect(within(schedule).getByText('Режим')).toBeInTheDocument()
    expect(within(schedule).getByText('Весь день')).toBeInTheDocument()
    expect(within(schedule).queryByText('Начало')).not.toBeInTheDocument()
    expect(within(schedule).queryByText('Длительность')).not.toBeInTheDocument()
    expect(within(schedule).queryByText('Дедлайн')).not.toBeInTheDocument()
    expect(within(details).queryByText('Срочность')).not.toBeInTheDocument()
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
