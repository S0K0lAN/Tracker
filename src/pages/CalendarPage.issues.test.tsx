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
    plannedDurationMinutes: timing.plannedDurationMinutes ?? 60,
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
    const timedTask = (title: string) => [...container.querySelectorAll<HTMLButtonElement>('.calendar-task')]
      .find((task) => task.textContent?.includes(title))!

    const urgent = timedTask(inheritedUrgent.title)
    expect(urgent).toHaveAttribute('data-importance', 'low')
    expect(urgent).toHaveAttribute('data-urgency', 'high')
    expect(urgent).toHaveAccessibleName(/Срочная задача/)
    expect(urgent).not.toHaveAccessibleName(/Важная задача/)
    expect(urgent.querySelector('.calendar-task-signal--urgency')).toBeInTheDocument()
    expect(urgent.querySelector('.calendar-task-signal--importance')).not.toBeInTheDocument()

    const important = timedTask(importantCalm.title)
    expect(important).toHaveAttribute('data-importance', 'high')
    expect(important).toHaveAttribute('data-urgency', 'low')
    expect(important).toHaveAccessibleName(/Важная задача/)
    expect(important).not.toHaveAccessibleName(/Срочная задача/)
    expect(important.querySelector('.calendar-task-signal--importance')).toBeInTheDocument()
    expect(important.querySelector('.calendar-task-signal--urgency')).not.toBeInTheDocument()

    const both = timedTask(importantUrgent.title)
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

  it('shows deadline tasks as strips in the all-day lane of every time view', async () => {
    const user = userEvent.setup()
    const today = startOfLocalDay(new Date())
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const deadlineTask = taskFrom(template, 'all-day-deadline', 'Контрольный срок', {
      deadline: at(today, 18, 45),
    })
    const earlierDeadline = taskFrom(template, 'earlier-deadline', 'Ранний срок', {
      deadline: at(today, 9, 15),
    })
    const scheduledOnly = taskFrom(template, 'scheduled-only', 'Только план', {
      startAt: at(today, 11),
    })
    const { container } = renderCalendar([deadlineTask, scheduledOnly, earlierDeadline])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })

    for (const mode of ['Неделя', '3 дня', 'День'] as const) {
      if (mode !== 'Неделя') await user.click(screen.getByRole('button', { name: mode }))

      expect(screen.getByText('Весь день')).toBeInTheDocument()
      expect(screen.queryByText('Сроки')).not.toBeInTheDocument()
      expect(container.querySelectorAll('.week-day__all-day')).toHaveLength(mode === 'Неделя' ? 7 : mode === '3 дня' ? 3 : 1)
      const strip = screen.getByTitle('Дедлайн: Контрольный срок · до 18:45')
      expect(strip).toHaveAccessibleName(/Дедлайн: Контрольный срок, до 18:45/)
      expect(within(strip).getByText('до 18:45')).toBeInTheDocument()
      expect(strip.querySelector('.calendar-deadline-strip__glyph')).toBeInTheDocument()
      const allDayLane = strip.closest<HTMLElement>('.week-day__all-day')!
      expect(within(allDayLane).queryByText('Только план')).not.toBeInTheDocument()
      expect([...allDayLane.querySelectorAll('.calendar-deadline-strip__title')].map((item) => item.textContent)).toEqual([
        'Ранний срок',
        'Контрольный срок',
      ])
    }
  })

  it('renders timed blocks from planned duration instead of the deadline in every time view', async () => {
    const user = userEvent.setup()
    const today = startOfLocalDay(new Date())
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const task = taskFrom(template, 'duration-task', 'Фокус на два часа', {
      startAt: at(today, 9),
      deadline: at(addLocalDays(today, 2), 18),
      plannedDurationMinutes: 120,
    })
    const { container } = renderCalendar([task])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })

    for (const [mode, expectedHeight] of [['Неделя', '64px'], ['3 дня', '72px'], ['День', '84px']] as const) {
      await user.click(screen.getByRole('button', { name: mode }))
      const timedBlock = container.querySelector<HTMLButtonElement>('.calendar-task')!
      expect(timedBlock).toHaveAttribute('data-duration-minutes', '120')
      expect(timedBlock.style.height).toBe(expectedHeight)
      expect(timedBlock).toHaveAttribute('title', expect.stringMatching(/09:00 — 11:00/))
    }
  })

  it('renders starts as ordinary month rows and deadlines as independent one-day points', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const gridStart = startOfWeek(new Date(now.getFullYear(), now.getMonth(), 1))
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const startDay = addLocalDays(gridStart, 5)
    const secondStartDay = addLocalDays(gridStart, 6)
    const deadlineDay = addLocalDays(gridStart, 9)
    const plannedAndDue = taskFrom(template, 'planned-and-due', 'План и отдельный дедлайн', {
      startAt: at(startDay, 9),
      deadline: at(deadlineDay, 18),
      plannedDurationMinutes: 90,
    })
    const sameDeadline = taskFrom(template, 'same-deadline', 'Вторая точка срока', {
      startAt: at(secondStartDay, 10),
      deadline: at(deadlineDay, 17),
    })
    const deadlineOnly = taskFrom(template, 'deadline-only', 'Только дедлайн', {
      deadline: at(deadlineDay, 15),
    })
    deadlineOnly.importance = 'low'
    deadlineOnly.urgencyOverride = 'low'
    const { container, onEditTask } = renderCalendar([plannedAndDue, sameDeadline, deadlineOnly])

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Месяц' }))

    expect(container.querySelectorAll('.month-calendar__week')).toHaveLength(6)
    expect(screen.getByRole('button', { name: /Запланировано: План и отдельный дедлайн/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Запланировано: Вторая точка срока/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Запланировано: Только дедлайн/ })).not.toBeInTheDocument()

    const deadlinePoints = [...container.querySelectorAll<HTMLElement>('[data-task-id]')]
    expect(deadlinePoints).toHaveLength(3)
    expect(deadlinePoints.map((point) => point.dataset.rangeSpan)).toEqual(['1', '1', '1'])
    expect(deadlinePoints.map((point) => point.dataset.rangeLane)).toEqual(['0', '1', '2'])
    expect(deadlinePoints.every((point) => !point.classList.contains('continues-before') && !point.classList.contains('continues-after'))).toBe(true)

    const deadlineOnlyPoint = container.querySelector<HTMLElement>('[data-task-id="deadline-only"]')!
    expect(deadlineOnlyPoint).toHaveClass('month-day__deadline')
    expect(deadlineOnlyPoint.querySelector('.month-calendar__deadline-glyph')).toBeInTheDocument()
    const deadlineDateLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
      .format(new Date(deadlineOnly.deadline!))
    expect(deadlineOnlyPoint).toHaveAccessibleName(`Дедлайн: Только дедлайн, ${deadlineDateLabel}`)

    await user.click(screen.getByRole('button', { name: `Показать задачи на ${startDay.toLocaleDateString('ru-RU')}` }))
    expect(within(screen.getByRole('dialog', { name: /Все задачи дня/i })).getAllByRole('button', { name: /План и отдельный дедлайн/ })).toHaveLength(1)
    await user.click(within(screen.getByRole('dialog', { name: /Все задачи дня/i })).getByRole('button', { name: 'Закрыть список задач' }))

    await user.click(screen.getByRole('button', { name: `Показать задачи на ${deadlineDay.toLocaleDateString('ru-RU')}` }))
    const deadlineDialog = screen.getByRole('dialog', { name: /Все задачи дня/i })
    expect(deadlineDialog.querySelectorAll('.calendar-day-dialog__task')).toHaveLength(3)
    expect(within(deadlineDialog).getByRole('button', { name: /План и отдельный дедлайн, Дедлайн/ })).toBeInTheDocument()

    await user.click(within(deadlineDialog).getByRole('button', { name: /План и отдельный дедлайн, Дедлайн/ }))
    expect(onEditTask).toHaveBeenCalledWith(plannedAndDue)
  })

  it('caps month deadline lanes and exposes all 500 hidden tasks on demand', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const gridStart = startOfWeek(new Date(now.getFullYear(), now.getMonth(), 1))
    const deadlineDay = addLocalDays(gridStart, 10)
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const tasks = Array.from({ length: 500 }, (_, index) => taskFrom(
      template,
      `large-range-${index}`,
      `Большой срок ${index + 1}`,
      {
        deadline: at(deadlineDay, 18),
      },
    ))
    const { container } = renderCalendar(tasks)

    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    await user.click(screen.getByRole('button', { name: 'Месяц' }))

    const weeks = [...container.querySelectorAll<HTMLElement>('.month-calendar__week')]
    expect(weeks).toHaveLength(6)
    expect(weeks.filter((week) => week.dataset.rangeLanes === '3')).toHaveLength(1)
    expect(weeks.filter((week) => week.dataset.rangeLanes === '0')).toHaveLength(5)
    expect(container.querySelectorAll('.month-calendar__range')).toHaveLength(3)

    const hiddenDeadlineButtons = screen.getAllByRole('button', { name: /скрытых сроков 497/i })
    expect(hiddenDeadlineButtons).toHaveLength(1)
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
