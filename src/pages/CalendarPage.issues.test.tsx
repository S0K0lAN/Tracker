import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { RouterProvider } from '../core/router/Router'
import type { Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { CalendarPage } from './CalendarPage'
import { addLocalDays, startOfLocalDay, startOfWeek } from './calendarLayout'

const STORAGE_KEY = 'focus-flow.state.v1'

function at(day: Date, hours: number, minutes = 0) {
  const value = new Date(day)
  value.setHours(hours, minutes, 0, 0)
  return value.toISOString()
}

function taskFrom(template: Task, id: string, title: string, timing: Pick<Task, 'startAt' | 'deadline'>): Task {
  return {
    ...template,
    id,
    title,
    startAt: timing.startAt,
    deadline: timing.deadline,
    status: 'active',
    tags: [],
    subtasks: [],
    attachments: [],
    reminders: [],
  }
}

function renderCalendar(tasks: Task[]) {
  const state = createSeedState()
  state.tasks = tasks
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  const onEditTask = vi.fn()
  const result = render(
    <AppProvider>
      <CalendarPage onEditTask={onEditTask} />
    </AppProvider>,
  )
  return { ...result, onEditTask }
}

function renderCalendarApp(tasks: Task[]) {
  const state = createSeedState()
  state.tasks = tasks
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  return render(
    <RouterProvider initialPath="/calendar">
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  )
}

describe('CalendarPage GitHub issues #33 and #35', () => {
  it('opens every task of the day from the accessible deadline overflow and restores focus', async () => {
    const user = userEvent.setup()
    const today = startOfLocalDay(new Date())
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const deadlineTasks = Array.from({ length: 6 }, (_, index) => taskFrom(
      template,
      `deadline-${index}`,
      `Срок ${index + 1}`,
      { deadline: at(today, 12, index) },
    ))
    const scheduledOnly = taskFrom(template, 'scheduled-only', 'Только запланировано', { startAt: at(today, 9) })
    const { container } = renderCalendar([...deadlineTasks, scheduledOnly])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    const weekOverflow = screen.getByRole('button', { name: /Показать все задачи и дедлайны.+скрыто 3/i })
    expect(weekOverflow).toHaveTextContent('Ещё 3')
    expect(getComputedStyle(weekOverflow).minHeight).toBe('24px')
    expect(container.querySelector<HTMLElement>('.week-calendar')?.style.getPropertyValue('--week-deadline-height')).toBe('105px')

    weekOverflow.focus()
    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: /Все задачи дня/i })
    expect(dialog.querySelectorAll('.calendar-day-dialog__task')).toHaveLength(7)
    expect(within(dialog).getByText('Только запланировано')).toBeInTheDocument()
    for (const task of deadlineTasks) expect(within(dialog).getByText(task.title)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(weekOverflow).toHaveFocus())

    await user.click(screen.getByRole('button', { name: '3 дня' }))
    expect(screen.getByRole('button', { name: /Показать все задачи и дедлайны.+скрыто 3/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'День' }))
    const dayOverflow = screen.getByRole('button', { name: /Показать все задачи и дедлайны.+скрыто 1/i })
    await user.click(dayOverflow)
    await user.click(within(screen.getByRole('dialog', { name: /Все задачи дня/i })).getByRole('button', { name: 'Закрыть список задач' }))
    await waitFor(() => expect(dayOverflow).toHaveFocus())
  })

  it('renders continuous month bands with stable lanes and a one-day deadline-only band', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const gridStart = startOfWeek(new Date(now.getFullYear(), now.getMonth(), 1))
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const crossing = taskFrom(template, 'crossing', 'Через границу недели', {
      startAt: at(addLocalDays(gridStart, 5), 9),
      deadline: at(addLocalDays(gridStart, 9), 18),
    })
    const overlapping = taskFrom(template, 'overlapping', 'Соседняя полоса', {
      startAt: at(addLocalDays(gridStart, 6), 10),
      deadline: at(addLocalDays(gridStart, 8), 17),
    })
    const deadlineOnly = taskFrom(template, 'deadline-only', 'Только дедлайн', {
      deadline: at(addLocalDays(gridStart, 8), 15),
    })
    const { container, onEditTask } = renderCalendar([crossing, overlapping, deadlineOnly])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Месяц' }))

    expect(container.querySelectorAll('.month-calendar__week')).toHaveLength(6)
    const crossingSegments = [...container.querySelectorAll<HTMLElement>('[data-task-id="crossing"]')]
    expect(crossingSegments).toHaveLength(2)
    expect(crossingSegments.map((segment) => segment.dataset.rangeSpan)).toEqual(['2', '3'])
    expect(crossingSegments.map((segment) => segment.dataset.rangeLane)).toEqual(['0', '0'])
    expect(crossingSegments[0]).toHaveClass('continues-after')
    expect(crossingSegments[1]).toHaveClass('continues-before')

    const overlappingSegments = [...container.querySelectorAll<HTMLElement>('[data-task-id="overlapping"]')]
    expect(overlappingSegments).toHaveLength(2)
    expect(overlappingSegments.map((segment) => segment.dataset.rangeLane)).toEqual(['1', '1'])

    const deadlineOnlyBands = [...container.querySelectorAll<HTMLElement>('[data-task-id="deadline-only"]')]
    expect(deadlineOnlyBands).toHaveLength(1)
    expect(deadlineOnlyBands[0]).toHaveAttribute('data-range-span', '1')
    expect(deadlineOnlyBands[0]).toHaveClass('month-day__deadline')
    const deadlineDateLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
      .format(new Date(deadlineOnly.deadline!))
    expect(deadlineOnlyBands[0]).toHaveAccessibleName(`Дедлайн: Только дедлайн, ${deadlineDateLabel}`)

    await user.click(crossingSegments[1])
    expect(onEditTask).toHaveBeenCalledWith(crossing)
  })

  it('caps month deadline lanes and exposes all 500 hidden tasks on demand', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const gridStart = startOfWeek(new Date(now.getFullYear(), now.getMonth(), 1))
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const tasks = Array.from({ length: 500 }, (_, index) => taskFrom(
      template,
      `large-range-${index}`,
      `Большой срок ${index + 1}`,
      {
        startAt: at(addLocalDays(gridStart, -1), 9),
        deadline: at(addLocalDays(gridStart, 42), 18),
      },
    ))
    const { container } = renderCalendar(tasks)

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Месяц' }))

    const weeks = [...container.querySelectorAll<HTMLElement>('.month-calendar__week')]
    expect(weeks).toHaveLength(6)
    expect(weeks.every((week) => week.dataset.rangeLanes === '3')).toBe(true)
    expect(container.querySelectorAll('.month-calendar__range')).toHaveLength(18)

    const hiddenDeadlineButtons = screen.getAllByRole('button', { name: /скрытых сроков 497/i })
    expect(hiddenDeadlineButtons).toHaveLength(42)
    await user.click(hiddenDeadlineButtons[0])
    expect(screen.getByRole('dialog', { name: /Все задачи дня/i }).querySelectorAll('.calendar-day-dialog__task')).toHaveLength(500)
  })

  it('keeps stable focus targets while opening task details and a new editor from the day dialog', async () => {
    const user = userEvent.setup()
    const today = startOfLocalDay(new Date())
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const deadlineTasks = Array.from({ length: 6 }, (_, index) => taskFrom(
      template,
      `focus-deadline-${index}`,
      `Фокус-срок ${index + 1}`,
      { deadline: at(today, 12, index) },
    ))
    renderCalendarApp(deadlineTasks)

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    const stableOpener = screen.getByRole('button', { name: /Показать все задачи и дедлайны.+скрыто 3/i })
    await user.click(stableOpener)
    let dayDialog = screen.getByRole('dialog', { name: /Все задачи дня/i })
    const taskOpener = within(dayDialog).getByRole('button', { name: /Фокус-срок 4/i })

    await user.click(taskOpener)
    const details = screen.getByRole('dialog', { name: 'Фокус-срок 4' })
    expect(screen.queryByRole('dialog', { name: /Все задачи дня/i })).not.toBeInTheDocument()
    await user.click(within(details).getByRole('button', { name: 'Закрыть задачу' }))
    await waitFor(() => expect(stableOpener).toHaveFocus())

    await user.click(stableOpener)
    dayDialog = screen.getByRole('dialog', { name: /Все задачи дня/i })
    const createButton = within(dayDialog).getByRole('button', { name: 'Добавить задачу' })
    await user.click(createButton)
    const editor = screen.getByRole('dialog', { name: 'Что нужно сделать?' })
    expect(screen.queryByRole('dialog', { name: /Все задачи дня/i })).not.toBeInTheDocument()
    await user.click(within(editor).getByRole('button', { name: 'Закрыть редактор' }))
    await waitFor(() => expect(stableOpener).toHaveFocus())
  })
})
