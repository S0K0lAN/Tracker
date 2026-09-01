import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { RouterProvider } from '../core/router/Router'
import type { AppState, Task } from '../domain/models'
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

function taskFrom(
  template: Task,
  id: string,
  title: string,
  timing: { startAt?: string; deadline?: string; plannedDurationMinutes?: number },
): Task {
  return {
    ...template,
    id,
    title,
    startAt: timing.startAt,
    deadline: timing.deadline,
    plannedDurationMinutes: timing.plannedDurationMinutes ?? (timing.deadline ? undefined : 60),
    status: 'active',
    tags: [],
    subtasks: [],
    attachments: [],
    reminders: [],
  } as Task
}

function renderCalendar(tasks: Task[], configure?: (state: AppState) => void) {
  const state = createSeedState()
  state.tasks = tasks
  configure?.(state)
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

describe('CalendarPage GitHub issues #33, #35, #45 and #46', () => {
  it('marks the current local date in every calendar mode and keeps the frame on the full day surface', async () => {
    const user = userEvent.setup()
    const { container } = renderCalendar([])
    const todayLabel = new Date().toLocaleDateString('ru-RU')

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })

    for (const mode of ['Год', 'Месяц', 'Неделя', '3 дня', 'День'] as const) {
      await user.click(screen.getByRole('button', { name: mode }))
      const currentDates = container.querySelectorAll<HTMLElement>('[aria-current="date"]')

      expect(currentDates).toHaveLength(1)
      expect(currentDates[0].getAttribute('aria-label')).toContain(todayLabel)

      const framedDay = mode === 'Год'
        ? currentDates[0]
        : currentDates[0].closest<HTMLElement>(mode === 'Месяц' ? '.month-day' : '.week-day')
      expect(framedDay).toHaveClass('is-today')
    }
  })

  it('shows separate visual indicators and accessible labels for importance and inherited computed urgency', async () => {
    const today = startOfLocalDay(new Date())
    const deadline = new Date(Date.now() + 36 * 60 * 60_000).toISOString()
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const inheritedUrgent = {
      ...taskFrom(template, 'inherited-urgent', 'Срочная по порогу проекта', { startAt: at(today, 9), deadline }),
      projectId: 'work',
      importance: 'low' as const,
      urgencyOverride: undefined,
      urgencyThresholdOverrideHours: undefined,
    }
    const importantCalm = {
      ...taskFrom(template, 'important-calm', 'Важная без срочности', { startAt: at(today, 10), deadline }),
      projectId: 'personal',
      importance: 'high' as const,
      urgencyOverride: undefined,
      urgencyThresholdOverrideHours: undefined,
    }
    const importantUrgent = {
      ...taskFrom(template, 'important-urgent', 'Важная и срочная', { startAt: at(today, 11), deadline }),
      projectId: 'work',
      importance: 'high' as const,
      urgencyOverride: undefined,
      urgencyThresholdOverrideHours: undefined,
    }
    const { container } = renderCalendar(
      [inheritedUrgent, importantCalm, importantUrgent],
      (state) => {
        state.projects.find((project) => project.id === 'work')!.urgencyThresholdHours = 48
        state.projects.find((project) => project.id === 'personal')!.urgencyThresholdHours = 24
      },
    )

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    const deadlineRange = (title: string) => [...container.querySelectorAll<HTMLButtonElement>('.time-calendar__all-day-range')]
      .find((task) => task.textContent?.includes(title))!

    const urgent = deadlineRange(inheritedUrgent.title)
    expect(urgent).toHaveAttribute('data-importance', 'low')
    expect(urgent).toHaveAttribute('data-urgency', 'high')
    expect(urgent).toHaveAccessibleName(/Срочная задача/)
    expect(urgent).not.toHaveAccessibleName(/Важная задача/)
    expect(urgent.querySelector('.calendar-task-signal--urgency')).toBeInTheDocument()
    expect(urgent.querySelector('.calendar-task-signal--importance')).not.toBeInTheDocument()

    const important = deadlineRange(importantCalm.title)
    expect(important).toHaveAttribute('data-importance', 'high')
    expect(important).toHaveAttribute('data-urgency', 'low')
    expect(important).toHaveAccessibleName(/Важная задача/)
    expect(important).not.toHaveAccessibleName(/Срочная задача/)
    expect(important.querySelector('.calendar-task-signal--importance')).toBeInTheDocument()
    expect(important.querySelector('.calendar-task-signal--urgency')).not.toBeInTheDocument()

    const both = deadlineRange(importantUrgent.title)
    expect(both).toHaveAttribute('data-importance', 'high')
    expect(both).toHaveAttribute('data-urgency', 'high')
    expect(both).toHaveAccessibleName(/Важная задача/)
    expect(both).toHaveAccessibleName(/Срочная задача/)
    expect(both.querySelector('.calendar-task-signal--importance')).toBeInTheDocument()
    expect(both.querySelector('.calendar-task-signal--urgency')).toBeInTheDocument()
  })

  it('does not render stale manual urgency for a scheduled task without a deadline', async () => {
    const today = startOfLocalDay(new Date())
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const scheduledWithoutDeadline = {
      ...taskFrom(template, 'scheduled-without-deadline', 'План без дедлайна', { startAt: at(today, 9) }),
      importance: 'low' as const,
      urgencyOverride: 'high' as const,
    }
    const { container } = renderCalendar([scheduledWithoutDeadline])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    const timedTask = [...container.querySelectorAll<HTMLButtonElement>('.calendar-task')]
      .find((task) => task.textContent?.includes(scheduledWithoutDeadline.title))!

    expect(timedTask).toBeInTheDocument()
    expect(timedTask).toHaveAttribute('data-urgency', 'low')
    expect(timedTask).not.toHaveAccessibleName(/Срочная задача/)
    expect(timedTask.querySelector('.calendar-task-signal--urgency')).not.toBeInTheDocument()
  })

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
    expect(container.querySelector<HTMLElement>('.week-calendar')?.style.getPropertyValue('--week-all-day-height')).toBe('114px')

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

  it('shows one continuous deadline range across the all-day lane of every time view', async () => {
    const user = userEvent.setup()
    const today = startOfLocalDay(new Date())
    const weekStart = startOfWeek(today)
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const deadlineTask = taskFrom(template, 'all-day-deadline', 'Контрольный срок', {
      startAt: at(addLocalDays(weekStart, -3), 9),
      deadline: at(addLocalDays(weekStart, 10), 18, 45),
    })
    const scheduledOnly = taskFrom(template, 'scheduled-only', 'Только план', {
      startAt: at(today, 11),
    })
    const { container, onEditTask } = renderCalendar([deadlineTask, scheduledOnly])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })

    for (const [mode, expectedSpan] of [['Неделя', '7'], ['3 дня', '3'], ['День', '1']] as const) {
      if (mode !== 'Неделя') await user.click(screen.getByRole('button', { name: mode }))

      expect(screen.getByText('Весь день')).toBeInTheDocument()
      expect(screen.queryByText('Сроки')).not.toBeInTheDocument()
      expect(container.querySelectorAll('.week-day__all-day')).toHaveLength(mode === 'Неделя' ? 7 : mode === '3 дня' ? 3 : 1)
      const range = container.querySelector<HTMLButtonElement>('[data-task-id="all-day-deadline"]')!
      expect(range).toHaveClass('time-calendar__all-day-range', 'continues-before', 'continues-after')
      expect(range).toHaveAttribute('data-range-span', expectedSpan)
      expect(range).toHaveAccessibleName(/Дедлайн: Контрольный срок.+до 18:45/)
      expect(within(range).getByText('до 18:45')).toBeInTheDocument()
      expect(range.querySelector('.calendar-deadline-strip__glyph')).toBeInTheDocument()
      expect([...container.querySelectorAll<HTMLButtonElement>('.calendar-task')]
        .some((task) => task.textContent?.includes('Контрольный срок'))).toBe(false)
      expect([...container.querySelectorAll<HTMLButtonElement>('.calendar-task')]
        .some((task) => task.textContent?.includes('Только план'))).toBe(true)
    }

    await user.click(container.querySelector<HTMLButtonElement>('[data-task-id="all-day-deadline"]')!)
    expect(onEditTask).toHaveBeenCalledWith(deadlineTask)
  })

  it('does not duplicate a deadline task in the timed grid', async () => {
    const user = userEvent.setup()
    const today = startOfLocalDay(new Date())
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const task = taskFrom(template, 'duration-task', 'Фокус на два часа', {
      startAt: at(today, 9),
      deadline: at(addLocalDays(today, 2), 18),
    })
    const { container } = renderCalendar([task])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })

    for (const mode of ['Неделя', '3 дня', 'День'] as const) {
      await user.click(screen.getByRole('button', { name: mode }))
      expect([...container.querySelectorAll<HTMLButtonElement>('.calendar-task')]
        .some((timedTask) => timedTask.textContent?.includes(task.title))).toBe(false)
      expect(container.querySelector('[data-task-id="duration-task"]')).toHaveClass('time-calendar__all-day-range')
    }
  })

  it('renders one continuous month deadline band without a duplicate scheduled row', async () => {
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
    const sameDay = taskFrom(template, 'same-day', 'Один день', {
      startAt: at(addLocalDays(gridStart, 8), 12),
      deadline: at(addLocalDays(gridStart, 8), 15),
    })
    sameDay.importance = 'low'
    sameDay.urgencyOverride = 'low'
    const startOnly = taskFrom(template, 'start-only', 'Только начало', {
      startAt: at(addLocalDays(gridStart, 4), 11),
    })
    const { container, onEditTask } = renderCalendar([crossing, overlapping, sameDay, startOnly])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Месяц' }))

    expect(container.querySelectorAll('.month-calendar__week')).toHaveLength(6)
    expect(screen.queryByRole('button', { name: /Запланировано: Через границу недели/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Запланировано: Соседняя полоса/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Запланировано: Один день/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Запланировано: Только начало/ })).toBeInTheDocument()

    const crossingSegments = [...container.querySelectorAll<HTMLElement>('[data-task-id="crossing"]')]
    expect(crossingSegments).toHaveLength(2)
    expect(crossingSegments.map((segment) => segment.dataset.rangeSpan)).toEqual(['2', '3'])
    expect(crossingSegments.map((segment) => segment.dataset.rangeLane)).toEqual(['0', '0'])
    expect(crossingSegments[0]).toHaveClass('continues-after')
    expect(crossingSegments[1]).toHaveClass('continues-before')

    const overlappingSegments = [...container.querySelectorAll<HTMLElement>('[data-task-id="overlapping"]')]
    expect(overlappingSegments).toHaveLength(2)
    expect(overlappingSegments.map((segment) => segment.dataset.rangeLane)).toEqual(['1', '1'])

    const sameDayBand = container.querySelector<HTMLElement>('[data-task-id="same-day"]')!
    expect(sameDayBand).toHaveClass('month-day__deadline')
    expect(sameDayBand).toHaveAttribute('data-range-span', '1')
    expect(sameDayBand.querySelector('.month-calendar__deadline-glyph')).toBeInTheDocument()
    const deadlineDateLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
      .format(new Date(sameDay.deadline!))
    expect(sameDayBand).toHaveAccessibleName(`Дедлайн: Один день, ${deadlineDateLabel}`)

    await user.click(crossingSegments[1])
    expect(onEditTask).toHaveBeenCalledWith(crossing)

    const intermediateDay = addLocalDays(gridStart, 7)
    await user.click(screen.getByRole('button', { name: `Показать задачи на ${intermediateDay.toLocaleDateString('ru-RU')}` }))
    const rangeDialog = screen.getByRole('dialog', { name: /Все задачи дня/i })
    expect(rangeDialog.querySelectorAll('.calendar-day-dialog__task')).toHaveLength(2)
    expect(within(rangeDialog).getByText('Через границу недели')).toBeInTheDocument()
    expect(within(rangeDialog).getByText('Соседняя полоса')).toBeInTheDocument()
  })

  it('keeps the year day dialog aligned with its point-in-time task marker', async () => {
    const user = userEvent.setup()
    const today = startOfLocalDay(new Date())
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const spanningDeadline = taskFrom(template, 'year-point-range', 'Диапазон без точки сегодня', {
      startAt: at(addLocalDays(today, -1), 9),
      deadline: at(addLocalDays(today, 1), 18),
    })
    renderCalendar([spanningDeadline])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Год' }))
    await user.click(screen.getByRole('button', {
      name: `${today.toLocaleDateString('ru-RU')}, задач нет`,
    }))

    const dialog = screen.getByRole('dialog', { name: /Все задачи дня/i })
    expect(within(dialog).queryByText(spanningDeadline.title)).not.toBeInTheDocument()
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

  it('keeps completed tasks visible in year, month, week, three-day and day calendars', async () => {
    const user = userEvent.setup()
    const today = startOfLocalDay(new Date())
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const completedTimed = {
      ...taskFrom(template, 'completed-timed', 'Выполненный план', {
        startAt: at(today, 10),
        plannedDurationMinutes: 75,
      }),
      status: 'completed' as const,
    }
    const completedDeadline = {
      ...taskFrom(template, 'completed-deadline', 'Выполненный срок', {
        startAt: at(today, 9),
        deadline: at(addLocalDays(today, 1), 18),
      }),
      status: 'completed' as const,
    }
    const archivedTimed = { ...completedTimed, id: 'archived-timed', title: 'Архивный план', status: 'archived' as const }
    const deletedDeadline = { ...completedDeadline, id: 'deleted-deadline', title: 'Удалённый срок', status: 'deleted' as const }
    const { container } = renderCalendar([completedTimed, completedDeadline, archivedTimed, deletedDeadline])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })

    for (const mode of ['Неделя', '3 дня', 'День'] as const) {
      if (mode !== 'Неделя') await user.click(screen.getByRole('button', { name: mode }))
      expect([...container.querySelectorAll<HTMLButtonElement>('.calendar-task')]
        .find((task) => task.textContent?.includes(completedTimed.title))).toHaveAttribute('data-status', 'completed')
      const deadlineRange = container.querySelector<HTMLButtonElement>('[data-task-id="completed-deadline"]')!
      expect(deadlineRange).toHaveAttribute('data-status', 'completed')
      expect(deadlineRange).toHaveAttribute('data-urgency', 'low')
      expect(deadlineRange).toHaveAccessibleName(/Выполненная задача/)
      expect(screen.queryByText(archivedTimed.title)).not.toBeInTheDocument()
      expect(screen.queryByText(deletedDeadline.title)).not.toBeInTheDocument()
    }

    await user.click(screen.getByRole('button', { name: 'Месяц' }))
    expect([...container.querySelectorAll<HTMLButtonElement>('.month-day__task')]
      .find((task) => task.textContent?.includes(completedTimed.title))).toHaveAttribute('data-status', 'completed')
    expect(container.querySelector('[data-task-id="completed-deadline"]')).toHaveAttribute('data-status', 'completed')
    expect(screen.queryByText(archivedTimed.title)).not.toBeInTheDocument()
    expect(screen.queryByText(deletedDeadline.title)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Год' }))
    const todayButton = screen.getByRole('button', {
      name: new RegExp(`${today.toLocaleDateString('ru-RU')}, задач: 2`),
    })
    await user.click(todayButton)
    const dialog = screen.getByRole('dialog', { name: /Все задачи дня/i })
    expect(within(dialog).getByText(completedTimed.title)).toBeInTheDocument()
    expect(within(dialog).getByText(completedDeadline.title)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Выполненный срок.+Выполненная задача/ })).toHaveAttribute('data-status', 'completed')
    expect(within(dialog).queryByText(archivedTimed.title)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(deletedDeadline.title)).not.toBeInTheDocument()
  })

  it('does not add a calendar overdue class to a past deadline', async () => {
    const user = userEvent.setup()
    const today = startOfLocalDay(new Date())
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const overdue = taskFrom(template, 'past-deadline', 'Прошедший срок', {
      startAt: at(addLocalDays(today, -3), 9),
      deadline: at(addLocalDays(today, -1), 18),
    })
    const { container } = renderCalendar([overdue])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Месяц' }))

    const range = container.querySelector<HTMLElement>('[data-task-id="past-deadline"]')!
    expect(range).toBeInTheDocument()
    expect(range).not.toHaveClass('is-overdue')
    expect(container.querySelector('.is-overdue')).not.toBeInTheDocument()
  })
})
