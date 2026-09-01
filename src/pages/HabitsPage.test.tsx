import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Habit } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { getCompletionTrend, getHabitRhythm, HabitsPage, HABIT_CHECK_DAYS, HABIT_ICONS, toDateKey } from './HabitsPage'

const STORAGE_KEY = 'focus-flow.state.v1'
const EXISTING_HABIT_CREATED_AT = '2020-01-01T12:00:00.000Z'

afterEach(() => vi.useRealTimers())

function rollingDays(now: Date, count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - count + 1 + index)
    return day
  })
}

function renderHabits(habits?: Habit[]) {
  if (habits) {
    const state = createSeedState()
    state.habits = habits
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }

  return render(
    <AppProvider>
      <HabitsPage />
    </AppProvider>,
  )
}

describe('habit rhythm', () => {
  it('builds a daily trend from habit checks and completed tasks', () => {
    const state = createSeedState()
    const days = [new Date(2026, 6, 30), new Date(2026, 6, 31)]
    state.habits = [{
      id: 'trend-habit',
      name: 'Вода',
      icon: '💧',
      targetDays: [0, 1, 2, 3, 4, 5, 6],
      completions: ['2026-07-30', '2026-07-31'],
      color: '#75a8b5',
      createdAt: new Date(2026, 6, 31, 18).toISOString(),
    }]
    state.tasks = state.tasks.slice(0, 1).map((task) => ({
      ...task,
      status: 'completed',
      completedAt: '2026-07-30T12:00:00.000Z',
    }))

    expect(getCompletionTrend(state.habits, state.tasks, days).map(({ habits, tasks }) => ({ habits, tasks }))).toEqual([
      { habits: 0, tasks: 1 },
      { habits: 1, tasks: 0 },
    ])
  })

  it('calculates progress and streak from each habit schedule independently', () => {
    const now = new Date(2026, 6, 31, 12)
    const days = rollingDays(now)
    const weekdays: Habit = {
      id: 'weekdays',
      name: 'Чтение',
      icon: '📚',
      targetDays: [1, 2, 3, 4, 5],
      completions: ['2026-07-27', '2026-07-29', '2026-07-31'],
      color: '#9b7fbd',
      createdAt: EXISTING_HABIT_CREATED_AT,
    }
    const daily: Habit = {
      id: 'daily',
      name: 'Вода',
      icon: '💧',
      targetDays: [0, 1, 2, 3, 4, 5, 6],
      completions: [],
      color: '#75a8b5',
      createdAt: EXISTING_HABIT_CREATED_AT,
    }

    expect(getHabitRhythm(weekdays, days, now)).toEqual({
      scheduled: 5,
      completed: 3,
      progress: 60,
      streak: 1,
      isScheduledToday: true,
      isCompletedToday: true,
    })
    expect(getHabitRhythm(daily, days, now)).toEqual({
      scheduled: 7,
      completed: 0,
      progress: 0,
      streak: 0,
      isScheduledToday: true,
      isCompletedToday: false,
    })
  })

  it('renders completion and progress separately for every habit', async () => {
    const now = new Date()
    const days = rollingDays(now, HABIT_CHECK_DAYS)
    const allDays = [0, 1, 2, 3, 4, 5, 6]
    renderHabits([
      {
        id: 'complete',
        name: 'Первая привычка',
        icon: '🎯',
        targetDays: allDays,
        completions: days.map(toDateKey),
        color: '#778c70',
        createdAt: EXISTING_HABIT_CREATED_AT,
      },
      {
        id: 'empty',
        name: 'Вторая привычка',
        icon: '🌿',
        targetDays: allDays,
        completions: [],
        color: '#75a8b5',
        createdAt: EXISTING_HABIT_CREATED_AT,
      },
    ])

    const firstRhythm = await screen.findByRole('article', { name: 'Ритм привычки Первая привычка' })
    const secondRhythm = screen.getByRole('article', { name: 'Ритм привычки Вторая привычка' })
    expect(within(firstRhythm).getByText('100%')).toBeInTheDocument()
    expect(within(firstRhythm).getByText('Выполнено сегодня')).toBeInTheDocument()
    expect(within(secondRhythm).getByText('0%')).toBeInTheDocument()
    expect(within(secondRhythm).getByText('Ждёт отметки сегодня')).toBeInTheDocument()

    const firstRow = screen.getByRole('article', { name: 'Привычка Первая привычка' })
    const secondRow = screen.getByRole('article', { name: 'Привычка Вторая привычка' })
    expect(within(firstRow).getByText('14 из 14 плановых дней')).toBeInTheDocument()
    expect(within(secondRow).getByText('0 из 14 плановых дней')).toBeInTheDocument()
    expect(firstRow.querySelectorAll('.habit-checks button')).toHaveLength(HABIT_CHECK_DAYS)
    expect(secondRow.querySelectorAll('.habit-checks button')).toHaveLength(HABIT_CHECK_DAYS)
    expect(screen.getByRole('img', { name: /График выполненных привычек и задач/ })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /Выполнения привычек и задач за период .*\(30 дней\)/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Последние 14 дней' })).toBeInTheDocument()
    expect(screen.getByText('Серия', { selector: '.habit-list__streak-label' })).toBeInTheDocument()
  })

  it('moves the rolling days forward after midnight without remounting', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 21, 23, 59, 30))
    renderHabits([{
      id: 'daily-clock',
      name: 'Ежедневная привычка',
      icon: 'target',
      targetDays: [0, 1, 2, 3, 4, 5, 6],
      completions: [],
      color: '#778c70',
      createdAt: EXISTING_HABIT_CREATED_AT,
    }])
    await act(async () => { await Promise.resolve() })

    expect(screen.getByRole('button', { name: 'Отметить Ежедневная привычка 21.08.2026' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Отметить Ежедневная привычка 22.08.2026' })).not.toBeInTheDocument()

    act(() => {
      vi.setSystemTime(new Date(2026, 7, 22, 0, 0, 5))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(screen.getByRole('button', { name: 'Отметить Ежедневная привычка 22.08.2026' })).toBeInTheDocument()
  })

  it('toggles only the selected habit and updates only its rhythm', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const dayLabel = now.toLocaleDateString('ru-RU')
    const allDays = [0, 1, 2, 3, 4, 5, 6]
    renderHabits([
      {
        id: 'first',
        name: 'Зарядка',
        icon: '🏃',
        targetDays: allDays,
        completions: [],
        color: '#778c70',
        createdAt: EXISTING_HABIT_CREATED_AT,
      },
      {
        id: 'second',
        name: 'Медитация',
        icon: '🧘',
        targetDays: allDays,
        completions: [],
        color: '#9b7fbd',
        createdAt: EXISTING_HABIT_CREATED_AT,
      },
    ])

    await user.click(await screen.findByRole('button', { name: `Отметить Зарядка ${dayLabel}` }))

    expect(screen.getByRole('button', { name: `Отменить Зарядка ${dayLabel}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Отметить Медитация ${dayLabel}` })).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Ритм привычки Зарядка' })).getByText('7%')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Ритм привычки Медитация' })).getByText('0%')).toBeInTheDocument()
  })
})

describe('habit completion trend range', () => {
  it('defaults to thirty local days and exposes accessible presets and date inputs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 21, 12))
    const { container } = renderHabits([])
    await act(async () => { await Promise.resolve() })

    for (const preset of [14, 30, 90, 365]) {
      expect(screen.getByRole('button', { name: `${preset} дней` })).toHaveAttribute(
        'aria-pressed',
        preset === 30 ? 'true' : 'false',
      )
    }

    expect(screen.getByLabelText('Начало периода')).toHaveValue('2026-07-23')
    expect(screen.getByLabelText('Конец периода')).toHaveValue('2026-08-21')
    expect(container.querySelectorAll('.habit-trend__day')).toHaveLength(30)
    expect(container.querySelector('.habit-trend__summary')).toHaveTextContent(/30 дней/)
    expect(screen.getByRole('img', { name: /23 июл.*21 авг.*30 дней/i })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /23 июл.*21 авг.*\(30 дней\)/i })).toBeInTheDocument()
  })

  it('renders all ninety selected days and updates the chart and table descriptions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 21, 12))
    const { container } = renderHabits([])
    await act(async () => { await Promise.resolve() })

    fireEvent.click(screen.getByRole('button', { name: '90 дней' }))

    expect(screen.getByRole('button', { name: '90 дней' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '30 дней' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Начало периода')).toHaveValue('2026-05-24')
    expect(screen.getByLabelText('Конец периода')).toHaveValue('2026-08-21')
    expect(container.querySelectorAll('.habit-trend__day')).toHaveLength(90)
    expect(container.querySelector('.habit-trend__summary')).toHaveTextContent(/90 дней/)
    expect(screen.getByRole('img', { name: /24 мая.*21 авг.*90 дней/i })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /24 мая.*21 авг.*\(90 дней\)/i })).toBeInTheDocument()
  })

  it('uses an inclusive custom range without shifting local calendar dates', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 21, 12))
    const { container } = renderHabits([])
    await act(async () => { await Promise.resolve() })

    fireEvent.change(screen.getByLabelText('Начало периода'), { target: { value: '2026-08-15' } })
    fireEvent.change(screen.getByLabelText('Конец периода'), { target: { value: '2026-08-19' } })

    expect(screen.getByLabelText('Начало периода')).toHaveValue('2026-08-15')
    expect(screen.getByLabelText('Конец периода')).toHaveValue('2026-08-19')
    for (const preset of [14, 30, 90, 365]) {
      expect(screen.getByRole('button', { name: `${preset} дней` })).toHaveAttribute('aria-pressed', 'false')
    }

    const renderedDays = [...container.querySelectorAll<HTMLElement>('.habit-trend__day')]
    expect(renderedDays).toHaveLength(5)
    expect(renderedDays[0]).toHaveAttribute('title', expect.stringMatching(/^15\.08\.2026:/))
    expect(renderedDays.at(-1)).toHaveAttribute('title', expect.stringMatching(/^19\.08\.2026:/))
    expect(container.querySelector('.habit-trend__summary')).toHaveTextContent(/5 дней/)

    const interval = /15 авг.*19 авг.*5 дней/i
    expect(screen.getByRole('img', { name: interval })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: interval })
    expect(within(table).getByRole('rowheader', { name: '15.08.2026' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: '19.08.2026' })).toBeInTheDocument()
  })

  it('lets a historical range cross both current boundaries and keeps the selected date when clamping to a year', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 21, 12))
    const { container } = renderHabits([])
    await act(async () => { await Promise.resolve() })

    const startInput = screen.getByLabelText('Начало периода')
    const endInput = screen.getByLabelText('Конец периода')
    expect(startInput).not.toHaveAttribute('min')
    expect(endInput).not.toHaveAttribute('min')

    fireEvent.change(startInput, { target: { value: '2025-01-01' } })

    expect(startInput).toHaveValue('2025-01-01')
    expect(endInput).toHaveValue('2025-12-31')
    expect(container.querySelectorAll('.habit-trend__day')).toHaveLength(365)

    fireEvent.change(endInput, { target: { value: '2025-01-31' } })

    expect(startInput).toHaveValue('2025-01-01')
    expect(endInput).toHaveValue('2025-01-31')
    expect(container.querySelectorAll('.habit-trend__day')).toHaveLength(31)
    expect(container.querySelector('.habit-trend__summary')).toHaveTextContent(/31 день/)
  })
})

describe('habit creation', () => {
  it('stores the fixed creation instant and disables earlier local days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const now = new Date(2026, 7, 21, 12, 0, 0)
    vi.setSystemTime(now)
    const user = userEvent.setup()
    renderHabits([])
    await act(async () => { await Promise.resolve() })

    await user.click(screen.getByRole('button', { name: 'Новая привычка' }))
    await user.type(screen.getByLabelText('Название привычки'), 'Новая с сегодня')
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    const row = screen.getByRole('article', { name: 'Привычка Новая с сегодня' })
    expect(within(row).getByText('0 из 1 плановых дней')).toBeInTheDocument()
    expect(within(row).getByRole('button', {
      name: `Новая с сегодня не запланирована ${new Date(2026, 7, 20).toLocaleDateString('ru-RU')}`,
    })).toBeDisabled()
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as ReturnType<typeof createSeedState>
      expect(stored.habits.find((habit) => habit.name === 'Новая с сегодня')?.createdAt).toBe(now.toISOString())
    })
  })

  it('offers ten icons and saves the selected icon with an optional description', async () => {
    const user = userEvent.setup()
    renderHabits()
    await screen.findByRole('heading', { name: 'Трекер привычек' })

    expect(screen.getAllByRole('button', { name: 'Новая привычка' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Новая привычка' }))
    expect(screen.getAllByRole('radio')).toHaveLength(HABIT_ICONS.length)

    await user.type(screen.getByLabelText('Название привычки'), 'Вечернее чтение')
    await user.type(screen.getByLabelText(/Описание/), 'Двадцать минут перед сном')
    await user.click(screen.getByRole('radio', { name: 'Книга' }))
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    const row = screen.getByRole('article', { name: 'Привычка Вечернее чтение' })
    expect(row.querySelector('[data-habit-icon="book"]')).toBeInTheDocument()
    expect(within(row).getByText('Двадцать минут перед сном')).toBeInTheDocument()
    expect(screen.queryByLabelText('Название привычки')).not.toBeInTheDocument()
  })

  it('edits an existing habit without losing its completion history', async () => {
    const user = userEvent.setup()
    const today = toDateKey(new Date())
    renderHabits([{
      id: 'editable',
      name: 'Старая привычка',
      description: 'Старое описание',
      icon: '💧',
      targetDays: [0, 1, 2, 3, 4, 5, 6],
      completions: [today],
      color: '#75a8b5',
      createdAt: EXISTING_HABIT_CREATED_AT,
    }])

    await user.click(await screen.findByRole('button', { name: 'Редактировать привычку Старая привычка' }))
    const name = screen.getByLabelText('Название привычки')
    await user.clear(name)
    await user.type(name, 'Вода утром')
    await user.click(screen.getByRole('radio', { name: 'Солнце' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    const row = screen.getByRole('article', { name: 'Привычка Вода утром' })
    expect(row.querySelector('[data-habit-icon="sun"]')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: `Отменить Вода утром ${new Date().toLocaleDateString('ru-RU')}` })).toBeInTheDocument()
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as ReturnType<typeof createSeedState>
      expect(stored.habits.find((habit) => habit.id === 'editable')?.createdAt).toBe(EXISTING_HABIT_CREATED_AT)
    })
  })
})
