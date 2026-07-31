import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { RouterProvider } from './core/router/Router'
import type { AppState, Task } from './domain/models'
import { createSeedState } from './domain/seed'
import { layoutDeadlineRanges, layoutTimedDayTasks, tasksForLocalDate } from './pages/calendarLayout'
import { layoutWeekDayTasks } from './pages/CalendarPage'
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
    renderApp('/today')

    expect(await screen.findByRole('heading', { name: 'Сегодня', level: 1 })).toBeInTheDocument()
    const scheduled = screen.getByRole('heading', { name: 'Запланировано сегодня' }).closest('section')
    const deadlines = screen.getByRole('heading', { name: 'Дедлайны сегодня' }).closest('section')
    expect(scheduled).not.toBeNull()
    expect(deadlines).not.toBeNull()
    expect(within(scheduled!).getByText('Подготовить план недели')).toBeInTheDocument()
    expect(within(deadlines!).queryByText('Подготовить план недели')).not.toBeInTheDocument()
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
})

describe('calendar deadline projection', () => {
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

  it('uses the deadline as the event end and lays multi-day ranges into lanes', () => {
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const start = new Date(2026, 7, 3, 9, 0)
    const end = new Date(2026, 7, 3, 12, 30)
    const timedTask = { ...template, id: 'timed', startAt: start.toISOString(), deadline: end.toISOString() }
    const timedLayout = layoutTimedDayTasks([timedTask], { hourHeight: 40 })
    expect(timedLayout[0].durationMinutes).toBe(210)
    expect(timedLayout[0].height).toBe(136)

    const longTask = { ...template, id: 'long', startAt: start.toISOString(), deadline: new Date(2026, 7, 6, 18).toISOString() }
    const crossingTask = { ...template, id: 'crossing', startAt: new Date(2026, 7, 5, 10).toISOString(), deadline: new Date(2026, 7, 12, 18).toISOString() }
    const ranges = layoutDeadlineRanges([longTask, crossingTask], new Date(2026, 7, 4), new Date(2026, 7, 9))
    expect(ranges.map(({ task, columnStart, columnSpan, lane }) => ({ id: task.id, columnStart, columnSpan, lane }))).toEqual([
      { id: 'long', columnStart: 0, columnSpan: 3, lane: 0 },
      { id: 'crossing', columnStart: 1, columnSpan: 5, lane: 1 },
    ])
    expect(ranges[0].startsBeforeView).toBe(true)
    expect(ranges[1].endsAfterView).toBe(true)
    expect(tasksForLocalDate([longTask], new Date(2026, 7, 5))).toEqual([longTask])
  })

  it('offers every calendar scale and opens the complete task list from a month cell', async () => {
    const user = userEvent.setup()
    const today = new Date()
    const template = createSeedState().tasks.find((task) => task.status === 'active')!
    const { container } = renderApp('/calendar', (state) => {
      state.tasks = Array.from({ length: 5 }, (_, index) => ({
        ...template,
        id: `month-${index}`,
        title: `Задача месяца ${index + 1}`,
        startAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9 + index).toISOString(),
        deadline: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10 + index).toISOString(),
      }))
    })
    await screen.findByRole('heading', { name: 'Календарь', level: 1 })
    for (const name of ['Год', 'Месяц', 'Неделя', '3 дня', 'День', 'Дедлайны']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }

    await user.click(screen.getByRole('button', { name: 'Месяц' }))
    expect(container.querySelectorAll('.month-day')).toHaveLength(42)
    await user.click(screen.getByRole('button', { name: `Показать задачи на ${today.toLocaleDateString('ru-RU')}` }))
    const dialog = screen.getByRole('dialog', { name: /Все задачи дня/i })
    expect(within(dialog).getAllByRole('button', { name: /Задача месяца/ })).toHaveLength(5)
    await user.click(within(dialog).getByRole('button', { name: 'Закрыть список задач' }))

    await user.click(screen.getByRole('button', { name: 'День' }))
    expect(container.querySelector('.time-calendar--day')).toBeInTheDocument()
    expect(container.querySelector('.calendar-task')).toHaveAttribute('data-duration-minutes', '60')

    await user.click(screen.getByRole('button', { name: 'Год' }))
    expect(container.querySelectorAll('.year-month')).toHaveLength(12)
  })

  it('shows a deadline-only task as a distinct marker in week and month views', async () => {
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

    const weekMarker = screen.getByTitle('Дедлайн: Только дедлайн')
    expect(weekMarker).toBeInTheDocument()
    expect(container.querySelectorAll('.week-day__deadlines')).toHaveLength(7)
    expect(container.querySelectorAll('.week-day__deadlines button')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Месяц' }))
    expect(container.querySelectorAll('.month-day')).toHaveLength(42)
    const monthMarkers = [...container.querySelectorAll('.month-day__deadline')]
    expect(monthMarkers).toHaveLength(1)
    expect(monthMarkers[0]).toHaveTextContent('Только дедлайн')
  })
})

describe('task lifecycle', () => {
  it('moves a task to trash and restores it to the inbox', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Действия задачи Прочитать главу книги' }))
    await user.click(screen.getByRole('menuitem', { name: 'В корзину' }))
    expect(screen.queryByText('Прочитать главу книги')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /Корзина/ }))
    expect(screen.getByRole('heading', { name: 'Корзина', level: 1 })).toBeInTheDocument()
    const deletedTask = screen.getByText('Прочитать главу книги').closest('article')
    expect(deletedTask).not.toBeNull()
    await user.click(within(deletedTask!).getByRole('button', { name: 'Восстановить' }))

    expect(screen.queryByText('Прочитать главу книги')).not.toBeInTheDocument()
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    await user.click(within(navigation).getByRole('link', { name: /Входящие/ }))
    expect(screen.getByText('Прочитать главу книги')).toBeInTheDocument()
  })

  it('archives completed tasks and restores one from the archive', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: /Показать завершённые/ }))
    await user.click(screen.getByRole('button', { name: /^Архивировать$/ }))

    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    await user.click(within(navigation).getByRole('link', { name: /Корзина/ }))
    await user.click(screen.getByRole('button', { name: /Архив 1/ }))

    expect(screen.getByText('Разобрать входящие заметки')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Вернуть' }))
    expect(screen.queryByText('Разобрать входящие заметки')).not.toBeInTheDocument()

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
    const deletedTask = screen.getByText('Удалить безвозвратно').closest('article')
    expect(deletedTask).not.toBeNull()

    await user.click(within(deletedTask!).getByRole('button', { name: 'Удалить навсегда' }))
    expect(screen.getByText('Удалить безвозвратно')).toBeInTheDocument()
    await user.click(within(deletedTask!).getByRole('button', { name: 'Подтвердить удаление' }))

    expect(screen.queryByText('Удалить безвозвратно')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Корзина пуста' })).toBeInTheDocument()
  })
})

describe('inbox layouts and focus', () => {
  it('switches list, board and calendar views and sorts task cards by title', async () => {
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
        makeTask({ id: 'alpha', title: 'Альфа', createdAt: '2026-07-01T10:00:00.000Z' }),
        makeTask({ id: 'omega', title: 'Якорь', createdAt: '2026-07-02T10:00:00.000Z' }),
      ]
    })
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    expect(container.querySelector('.task-card__title')?.textContent).toBe('Якорь')
    await user.click(screen.getByRole('combobox', { name: 'Сортировка входящих' }))
    await user.click(screen.getByRole('option', { name: 'По названию' }))
    expect(container.querySelector('.task-card__title')?.textContent).toBe('Альфа')

    await user.click(screen.getByRole('button', { name: 'Вид: Доска' }))
    expect(screen.getByRole('heading', { name: 'Доска по проектам' })).toBeInTheDocument()
    expect(container.querySelector('.inbox-board')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Вид: Календарь' }))
    expect(screen.getByRole('heading', { name: 'Календарная раскладка' })).toBeInTheDocument()
    expect(container.querySelector('.inbox-calendar')).toBeInTheDocument()
  })

  it('launches a task-bound Pomodoro and exposes working timer controls', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await screen.findByRole('heading', { name: 'Входящие', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Действия задачи Подготовить план недели' }))
    await user.click(screen.getByRole('menuitem', { name: 'Запустить Помодоро' }))

    const timer = screen.getByRole('complementary', { name: 'Помодоро-таймер' })
    expect(within(timer).getByText('Подготовить план недели')).toBeInTheDocument()
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
    const trigger = screen.getByRole('button', { name: 'Действия задачи Подготовить план недели' })

    await user.click(trigger)
    const open = screen.getByRole('menuitem', { name: 'Открыть' })
    await waitFor(() => expect(open).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Запустить Помодоро' })).toHaveFocus()
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
