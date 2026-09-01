import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { RouterProvider } from './core/router/Router'
import type { AppState, Task } from './domain/models'
import { createSeedState } from './domain/seed'
import { layoutDeadlineRanges, layoutTimedDayTasks, tasksForLocalDate, tasksForMonthDate } from './pages/calendarLayout'
import { calendarTaskLineLimit, layoutWeekDayTasks } from './pages/CalendarPage'
import { AppProvider } from './state/AppContext'

const STORAGE_KEY = 'focus-flow.state.v1'

function renderApp(path: string, configure?: (state: AppState) => void) {
  if (configure) {
    const state = createSeedState()
    configure(state)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }

  return render(
    <RouterProvider initialPath={path}>
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  )
}

describe('new workspace pages', () => {
  it('shows today tasks in their observable sections without duplicating a scheduled deadline', async () => {
    renderApp('/today', (state) => {
      const template = state.tasks.find((task) => task.status === 'active')!
      const todayAt = (hour: number) => {
        const value = new Date()
        value.setHours(hour, 0, 0, 0)
        return value.toISOString()
      }
      const todayKey = [
        new Date().getFullYear(),
        String(new Date().getMonth() + 1).padStart(2, '0'),
        String(new Date().getDate()).padStart(2, '0'),
      ].join('-')
      state.tasks = [
        { ...template, id: 'today-scheduled', title: 'Запланированная задача', startAt: todayAt(9), deadline: todayAt(18) },
        { ...template, id: 'today-deadline', title: 'Только сегодняшний дедлайн', startAt: undefined, deadline: todayAt(17) },
        { ...template, id: 'today-all-day', title: 'Задача на весь день', startAt: undefined, plannedDurationMinutes: undefined, deadline: undefined, allDayDate: todayKey },
      ]
    })

    expect(await screen.findByRole('heading', { name: 'Сегодня', level: 1 })).toBeInTheDocument()
    const scheduled = screen.getByRole('heading', { name: 'Запланировано сегодня' }).closest('section')
    const deadlines = screen.getByRole('heading', { name: 'Дедлайны сегодня' }).closest('section')
    expect(scheduled).not.toBeNull()
    expect(deadlines).not.toBeNull()
    expect(within(scheduled!).getByText('Запланированная задача')).toBeInTheDocument()
    expect(within(scheduled!).getByText('Задача на весь день')).toBeInTheDocument()
    expect(within(deadlines!).queryByText('Запланированная задача')).not.toBeInTheDocument()
    expect(within(deadlines!).getByText('Только сегодняшний дедлайн')).toBeInTheDocument()
  })

  it('shows one useful Today empty state without empty task sections', async () => {
    renderApp('/today', (state) => {
      state.tasks = []
    })

    expect(await screen.findByRole('heading', { name: 'День свободен' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Запланировано сегодня' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Дедлайны сегодня' })).not.toBeInTheDocument()
    expect(screen.queryByText('Задач в этом разделе нет.')).not.toBeInTheDocument()
  })

  it('creates a project and opens its empty detail page', async () => {
    const user = userEvent.setup()
    renderApp('/projects')
    await screen.findByRole('heading', { name: 'Проекты', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Новый проект' }))
    const creator = screen.getByRole('region', { name: 'Создание проекта' })
    await user.type(within(creator).getByLabelText('Название'), 'Новый запуск')
    await user.type(within(creator).getByLabelText('Описание'), 'Подготовка релиза')
    await user.click(within(creator).getByRole('button', { name: 'Создать проект' }))

    expect(screen.getByRole('heading', { name: 'Новый запуск', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Подготовка релиза')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Проект пока пуст' })).toBeInTheDocument()
  })

  it('searches across tasks and projects and persists a named filter in the UI', async () => {
    const user = userEvent.setup()
    renderApp('/search')
    await screen.findByRole('heading', { name: 'Поиск', level: 1 })

    await user.type(screen.getByRole('textbox', { name: 'Глобальный поиск' }), 'Работа')
    expect(screen.getByRole('heading', { name: 'Задачи' })).toBeInTheDocument()
    expect(screen.getByText('Подготовить план недели')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Проекты' })).toBeInTheDocument()
    expect(screen.getByText('Рабочие задачи и инициативы')).toBeInTheDocument()

    const searchBar = screen.getByRole('textbox', { name: 'Глобальный поиск' }).closest('section')
    expect(searchBar).not.toBeNull()
    await user.click(within(searchBar!).getByRole('button', { name: /^Фильтры/ }))
    await user.click(screen.getByRole('button', { name: 'Сохранить фильтр' }))
    await user.type(screen.getByRole('textbox', { name: 'Название фильтра' }), 'Работа')
    await user.click(screen.getByRole('button', { name: /^Сохранить$/ }))

    const savedFilters = screen.getByRole('heading', { name: 'Сохранённые фильтры' }).closest('section')
    expect(savedFilters).not.toBeNull()
    expect(within(savedFilters!).getByRole('button', { name: /^Работа Работа$/ })).toBeInTheDocument()
  })

  it('opens a project result as an addressable project route', async () => {
    const user = userEvent.setup()
    renderApp('/search')
    await user.type(await screen.findByRole('textbox', { name: 'Глобальный поиск' }), 'Работа')

    const projectLink = screen.getByRole('link', { name: 'Открыть проект Работа' })
    expect(projectLink).toHaveAttribute('href', '/projects/p-work')
    await user.click(projectLink)
    const projectHeading = screen.getByRole('heading', { name: 'Работа', level: 1 })
    expect(projectHeading).toBeInTheDocument()
    await waitFor(() => expect(projectHeading).toHaveFocus())
  })
})

describe('calendar deadline projection', () => {
  it('adds title lines only when the calendar event has enough height', () => {
    expect(calendarTaskLineLimit(34, 'week')).toBe(1)
    expect(calendarTaskLineLimit(66, 'week')).toBe(3)
    expect(calendarTaskLineLimit(44, 'day')).toBe(1)
    expect(calendarTaskLineLimit(136, 'day')).toBe(7)
  })

  it('places overlapping timed tasks in adjacent columns and reuses the full width afterwards', () => {
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const at = (hours: number, minutes: number) => {
      const date = new Date(2026, 6, 31, hours, minutes)
      return date.toISOString()
    }
    const tasks = [
      { ...template, id: 'first', startAt: at(9, 0), deadline: undefined },
      { ...template, id: 'second', startAt: at(9, 15), deadline: undefined },
      { ...template, id: 'third', startAt: at(11, 0), deadline: undefined },
    ]

    const layout = layoutWeekDayTasks(tasks)
    expect(layout.map(({ task, column, columnCount }) => ({ id: task.id, column, columnCount }))).toEqual([
      { id: 'first', column: 0, columnCount: 2 },
      { id: 'second', column: 1, columnCount: 2 },
      { id: 'third', column: 0, columnCount: 1 },
    ])
    expect(layout[1].top).toBeGreaterThan(layout[0].top)
    expect(layout[0].height).toBeGreaterThan(0)
  })

  it('uses planned duration for event height and projects deadline tasks as ranges', () => {
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const start = new Date(2026, 7, 3, 9, 0)
    const timedTask = {
      ...template,
      id: 'timed',
      startAt: start.toISOString(),
      plannedDurationMinutes: 210,
      deadline: undefined,
    }
    const timedLayout = layoutTimedDayTasks([timedTask], { hourHeight: 40 })
    expect(timedLayout[0].durationMinutes).toBe(210)
    expect(timedLayout[0].height).toBe(136)

    const taskWithLaterDeadline = {
      ...template,
      id: 'later-deadline',
      startAt: start.toISOString(),
      plannedDurationMinutes: undefined,
      deadline: new Date(2026, 7, 6, 18).toISOString(),
    }
    const outsideView = {
      ...template,
      id: 'outside-view',
      startAt: new Date(2026, 7, 5, 10).toISOString(),
      deadline: new Date(2026, 7, 12, 18).toISOString(),
    }
    const ranges = layoutDeadlineRanges([taskWithLaterDeadline, outsideView], new Date(2026, 7, 4), new Date(2026, 7, 9))
    expect(ranges.map(({ task, columnStart, columnSpan, lane }) => ({ id: task.id, columnStart, columnSpan, lane }))).toEqual([
      { id: 'later-deadline', columnStart: 0, columnSpan: 3, lane: 0 },
      { id: 'outside-view', columnStart: 1, columnSpan: 5, lane: 1 },
    ])
    expect(ranges[0].startsBeforeView).toBe(true)
    expect(ranges[1].endsAfterView).toBe(true)
    expect(tasksForLocalDate([taskWithLaterDeadline], start)).toEqual([taskWithLaterDeadline])
    expect(tasksForLocalDate([taskWithLaterDeadline], new Date(2026, 7, 4))).toEqual([])
    expect(tasksForMonthDate([taskWithLaterDeadline], new Date(2026, 7, 5))).toEqual([taskWithLaterDeadline])
    expect(tasksForLocalDate([taskWithLaterDeadline], new Date(2026, 7, 6))).toEqual([taskWithLaterDeadline])
  })

  it('offers every calendar view and opens the complete task list from a month cell', async () => {
    const user = userEvent.setup()
    const today = new Date()
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const { container } = renderApp('/calendar', (state) => {
      state.tasks = [
        {
          ...template,
          id: 'timed-day',
          title: 'Задача с длительностью',
          startAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9).toISOString(),
          plannedDurationMinutes: 60,
          deadline: undefined,
        },
        ...Array.from({ length: 5 }, (_, index) => ({
          ...template,
          id: `month-${index}`,
          title: `Задача месяца ${index + 1}`,
          startAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9 + index).toISOString(),
          plannedDurationMinutes: undefined,
          deadline: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10 + index).toISOString(),
        })),
      ]
    })
    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    for (const name of ['Год', 'Месяц', 'Неделя', '3 дня', 'День']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Дедлайны' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Месяц' }))
    expect(container.querySelectorAll('.month-day')).toHaveLength(42)
    expect(container.querySelector('.month-day__task')).toHaveTextContent('Задача с длительностью')
    expect(container.querySelector('[data-task-id="month-0"]')).toHaveAttribute('data-range-span', '1')
    await user.click(screen.getByRole('button', { name: `Показать задачи на ${today.toLocaleDateString('ru-RU')}` }))
    const dialog = screen.getByRole('dialog', { name: /Все задачи дня/i })
    expect(within(dialog).getAllByRole('button', { name: /Задача месяца/ })).toHaveLength(5)
    expect(within(dialog).getByRole('button', { name: /Задача с длительностью/ })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Закрыть список задач' }))

    await user.click(screen.getByRole('button', { name: 'День' }))
    expect(container.querySelector('.time-calendar--day')).toBeInTheDocument()
    const calendarTask = container.querySelector('.calendar-task')
    expect(calendarTask).toHaveAttribute('data-duration-minutes', '60')
    expect(calendarTask).toHaveTextContent('Задача с длительностью')
    expect(calendarTask).not.toHaveTextContent(/\d{2}:\d{2}/)
    expect(calendarTask?.getAttribute('aria-label')).toMatch(/\d{2}:\d{2}/)

    await user.click(screen.getByRole('button', { name: 'Год' }))
    expect(container.querySelectorAll('.year-month')).toHaveLength(12)
  })

  it('keeps a legacy deadline-only task visible in week and month views', async () => {
    const user = userEvent.setup()
    const deadline = new Date()
    deadline.setHours(15, 0, 0, 0)
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const { container } = renderApp('/calendar', (state) => {
      state.tasks = [{
        ...template,
        id: 'deadline-only',
        title: 'Только дедлайн',
        startAt: undefined,
        deadline: deadline.toISOString(),
        subtasks: [],
        tags: [],
        attachments: [],
        reminders: [],
      }]
    })
    await screen.findByRole('heading', { name: 'Календарь', level: 1 })

    const weekMarker = container.querySelector<HTMLButtonElement>('[data-task-id="deadline-only"]')!
    expect(weekMarker).toBeInTheDocument()
    expect(screen.getByText('Весь день')).toBeInTheDocument()
    expect(screen.queryByText('Сроки')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.week-day__all-day')).toHaveLength(7)
    expect(container.querySelectorAll('.time-calendar__all-day-range')).toHaveLength(1)
    expect(weekMarker).toHaveAccessibleName(/Дедлайн: Только дедлайн.+до 15:00/)
    expect(within(weekMarker).getByText('до 15:00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Месяц' }))
    expect(container.querySelectorAll('.month-day')).toHaveLength(42)
    const monthMarkers = [...container.querySelectorAll('.month-day__deadline')]
    expect(monthMarkers).toHaveLength(1)
    expect(monthMarkers[0]).toHaveTextContent('Только дедлайн')
  })
})

describe('task lifecycle', () => {
  it('offers an immediate undo after completing a task from the inbox', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Завершить задачу Разобрать идеи для следующих улучшений' }))
    expect(screen.queryByRole('button', { name: 'Завершить задачу Разобрать идеи для следующих улучшений' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Задача «Разобрать идеи для следующих улучшений» выполнена')

    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Отменить' }))
    expect(screen.getByRole('button', { name: 'Завершить задачу Разобрать идеи для следующих улучшений' })).toBeInTheDocument()
  })

  it('moves a task to trash and restores it to the inbox', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Действия задачи Разобрать идеи для следующих улучшений' }))
    await user.click(screen.getByRole('menuitem', { name: 'В корзину' }))
    expect(screen.queryByText('Разобрать идеи для следующих улучшений')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /Корзина/ }))
    expect(screen.getByRole('heading', { name: 'Корзина', level: 1 })).toBeInTheDocument()
    const deletedTask = screen.getByText('Разобрать идеи для следующих улучшений').closest('article')
    expect(deletedTask).not.toBeNull()
    await user.click(within(deletedTask!).getByRole('button', { name: 'Восстановить' }))

    expect(screen.queryByText('Разобрать идеи для следующих улучшений')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Корзина', level: 1 })).toHaveFocus())
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    await user.click(within(navigation).getByRole('link', { name: /Входящие/ }))
    expect(screen.getByText('Разобрать идеи для следующих улучшений')).toBeInTheDocument()
  })

  it('archives completed tasks and restores one from the archive', async () => {
    const user = userEvent.setup()
    renderApp('/inbox', (state) => {
      const completed = state.tasks.find((task) => task.id === 'task-done')!
      completed.projectId = 'inbox'
      completed.allDayDate = undefined
      completed.startAt = undefined
      completed.deadline = undefined
      const completedInProject = state.tasks.find((task) => task.id === 'task-plan')!
      completedInProject.status = 'completed'
      completedInProject.completedAt = new Date().toISOString()
    })
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: /Показать завершённые/ }))
    await user.click(screen.getByRole('button', { name: /^Архивировать$/ }))
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as AppState
      expect(stored.tasks.find((task) => task.id === 'task-plan')?.status).toBe('completed')
    })

    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    await user.click(within(navigation).getByRole('link', { name: /Корзина/ }))
    await user.click(screen.getByRole('button', { name: /Архив 1/ }))

    expect(screen.getByText('Разобрать входящие заметки')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Вернуть' }))
    expect(screen.queryByText('Разобрать входящие заметки')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Архив', level: 1 })).toHaveFocus())

    await user.click(within(navigation).getByRole('link', { name: /Входящие/ }))
    await user.click(screen.getByRole('button', { name: /Показать завершённые/ }))
    expect(screen.getByText('Разобрать входящие заметки')).toBeInTheDocument()
  })

  it('requires an explicit second action before permanent deletion', async () => {
    const user = userEvent.setup()
    renderApp('/trash', (state) => {
      const task = state.tasks.find((item) => item.status === 'active')!
      state.tasks = [{
        ...task,
        title: 'Удалить безвозвратно',
        status: 'deleted',
        previousStatus: 'active',
        deletedAt: new Date().toISOString(),
      }]
    })
    await screen.findByRole('heading', { name: 'Корзина', level: 1 })
    expect(screen.getByText(/backup\/import-backup.*могут сохранять прежнюю копию/i)).toBeInTheDocument()
    const deletedTask = screen.getByText('Удалить безвозвратно').closest('article')
    expect(deletedTask).not.toBeNull()

    const emptyTrash = screen.getByRole('button', { name: 'Очистить корзину' })
    await user.click(emptyTrash)
    expect(screen.getByRole('button', { name: 'Нет' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Нет' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Очистить корзину' })).toHaveFocus())

    await user.click(within(deletedTask!).getByRole('button', { name: 'Удалить навсегда' }))
    expect(screen.getByText('Удалить безвозвратно')).toBeInTheDocument()
    await user.click(within(deletedTask!).getByRole('button', { name: 'Подтвердить удаление' }))

    expect(screen.queryByText('Удалить безвозвратно')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Корзина пуста' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Корзина', level: 1 })).toHaveFocus())
  })
})

describe('inbox layouts and focus', () => {
  it('switches list and board views and sorts tasks without a calendar shortcut', async () => {
    const user = userEvent.setup()
    const templateState = createSeedState()
    const template = templateState.tasks.find((task) => task.status === 'active')!
    const makeTask = (data: Partial<Task> & Pick<Task, 'id' | 'title' | 'createdAt'>): Task => ({
      ...template,
      subtasks: [],
      tags: [],
      deadline: undefined,
      startAt: undefined,
      ...data,
      updatedAt: data.createdAt,
    })

    const { container } = renderApp('/inbox', (state) => {
      state.tasks = [
        makeTask({ id: 'alpha', title: 'Альфа', projectId: 'inbox', createdAt: '2026-07-01T10:00:00.000Z' }),
        makeTask({ id: 'omega', title: 'Якорь', projectId: 'inbox', createdAt: '2026-07-02T10:00:00.000Z' }),
      ]
    })
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })
    expect(screen.getByRole('link', { name: /Входящие 2/ })).toBeInTheDocument()

    expect(container.querySelector('.task-card__title')?.textContent).toBe('Якорь')
    await user.click(screen.getByRole('combobox', { name: 'Сортировка входящих' }))
    await user.click(screen.getByRole('option', { name: 'По названию' }))
    expect(container.querySelector('.task-card__title')?.textContent).toBe('Альфа')

    await user.click(screen.getByRole('button', { name: 'Вид: Доска' }))
    expect(screen.getByRole('heading', { name: 'Доска входящих' })).toBeInTheDocument()
    expect(container.querySelector('.inbox-board')).toBeInTheDocument()
    expect(screen.getByText('Альфа')).toBeInTheDocument()
    expect(screen.getByText('Якорь')).toBeInTheDocument()
    expect(container.querySelectorAll('.board-column')).toHaveLength(1)

    expect(screen.queryByRole('button', { name: 'Вид: Календарь' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Планировать в календаре' })).not.toBeInTheDocument()
  })

  it('launches a task-bound Pomodoro and exposes working timer controls', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Действия задачи Разобрать идеи для следующих улучшений' }))
    await user.click(screen.getByRole('menuitem', { name: 'Таймер фокуса · 25 минут' }))

    const timer = screen.getByRole('complementary', { name: 'Таймер фокуса' })
    expect(within(timer).getByText('Разобрать идеи для следующих улучшений')).toBeInTheDocument()
    expect(within(timer).getByText('25:00')).toBeInTheDocument()
    await user.click(within(timer).getByRole('button', { name: 'Запустить таймер' }))
    await waitFor(() =>
      expect(within(timer).getByRole('button', { name: 'Поставить таймер на паузу' })).toBeInTheDocument(),
    )
  })
})

describe('task editor keyboard interactions', () => {
  it('keeps the editor open when a manually entered date is invalid', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Создать новую задачу' }))
    await user.type(screen.getByLabelText('Название'), 'Задача с ошибкой даты')
    await user.type(screen.getByRole('textbox', { name: 'Начало' }), '28.02.2026, 09:00')
    await user.tab()
    const deadline = screen.getByRole('textbox', { name: 'Дедлайн' })
    await user.type(deadline, '31.02.2026, 18:00')
    await user.click(screen.getByRole('button', { name: 'Создать задачу' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Исправьте дату и время перед сохранением')).toBeInTheDocument()
    expect(deadline).toHaveAttribute('aria-invalid', 'true')
  })

  it('closes only an open SelectMenu on Escape and preserves the editor draft', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Создать новую задачу' }))
    const editor = screen.getByRole('dialog', { name: 'Что нужно сделать?' })
    await user.type(within(editor).getByLabelText('Название'), 'Черновик с клавиатуры')
    await user.click(within(editor).getByRole('combobox', { name: 'Проект' }))
    expect(screen.getByRole('listbox', { name: 'Проект' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox', { name: 'Проект' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Что нужно сделать?' })).toBeInTheDocument()
    expect(within(editor).getByLabelText('Название')).toHaveValue('Черновик с клавиатуры')
  })

  it('keeps Tab focus inside the task editor and restores the opening control', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })
    const opener = screen.getByRole('button', { name: 'Создать новую задачу' })
    await user.click(opener)
    const editor = screen.getByRole('dialog', { name: 'Что нужно сделать?' })
    const close = within(editor).getByRole('button', { name: 'Закрыть редактор' })
    const save = within(editor).getByRole('button', { name: 'Создать задачу' })

    close.focus()
    await user.tab({ shift: true })
    expect(save).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.click(close)
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('traps focus in the attachment viewer and returns it to the preview button', async () => {
    const user = userEvent.setup()
    const { container } = renderApp('/inbox', (state) => {
      const task = state.tasks.find((item) => item.status === 'active')!
      task.projectId = 'inbox'
      task.startAt = undefined
      task.deadline = undefined
      task.attachments = [{
        id: 'trap-attachment',
        name: 'trap.txt',
        type: 'text/plain',
        size: 1,
        dataUrl: 'data:text/plain;base64,QQ==',
      }]
      state.tasks = [task]
    })
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })
    await user.click(container.querySelector('.task-card__body')!)
    const preview = screen.getByRole('button', { name: 'Просмотреть trap.txt' })
    await user.click(preview)
    const viewer = screen.getByRole('dialog', { name: 'trap.txt' })
    const download = within(viewer).getByRole('link', { name: 'Скачать trap.txt' })
    const close = within(viewer).getByRole('button', { name: 'Закрыть просмотр вложения' })
    await waitFor(() => expect(close).toHaveFocus())

    await user.tab()
    expect(download).toHaveFocus()
    await user.tab({ shift: true })
    expect(close).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'trap.txt' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(preview).toHaveFocus())
  })
})

describe('task card keyboard interactions', () => {
  it('moves through the action menu and returns focus to its trigger on Escape', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })
    const trigger = screen.getByRole('button', { name: 'Действия задачи Разобрать идеи для следующих улучшений' })

    await user.click(trigger)
    const open = screen.getByRole('menuitem', { name: 'Открыть' })
    await waitFor(() => expect(open).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Таймер фокуса · 25 минут' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'В корзину' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(open).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe('mobile drawer keyboard interactions', () => {
  it('traps focus in the sidebar and restores the menu opener on Escape', async () => {
    const previousMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({
        matches: true,
        media: '(max-width: 1100px)',
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      }),
    })

    try {
      const user = userEvent.setup()
      renderApp('/inbox')
      await screen.findByRole('heading', { name: 'Входящие', level: 1 })
      const opener = screen.getByRole('button', { name: 'Открыть меню' })
      await user.click(opener)
      const drawer = screen.getByRole('dialog', { name: 'Меню приложения' })
      const close = within(drawer).getByRole('button', { name: 'Закрыть меню' })
      const profile = within(drawer).getByRole('button', { name: /Моё пространство/ })
      await waitFor(() => expect(close).toHaveFocus())

      await user.tab({ shift: true })
      expect(profile).toHaveFocus()
      await user.tab()
      expect(close).toHaveFocus()
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('dialog', { name: 'Меню приложения' })).not.toBeInTheDocument()
      await waitFor(() => expect(opener).toHaveFocus())
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: previousMatchMedia,
      })
    }
  })
})
