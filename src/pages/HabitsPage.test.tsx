import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Habit } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { AppProvider } from '../state/AppContext'
import { getCompletionTrend, getHabitRhythm, HabitsPage, HABIT_ICONS, toDateKey } from './HabitsPage'

const STORAGE_KEY = 'focus-flow.state.v1'

function rollingWeek(now: Date) {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - 6 + index)
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
      completions: ['2026-07-31'],
      color: '#75a8b5',
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
    const days = rollingWeek(now)
    const weekdays: Habit = {
      id: 'weekdays',
      name: 'Чтение',
      icon: '📚',
      targetDays: [1, 2, 3, 4, 5],
      completions: ['2026-07-27', '2026-07-29', '2026-07-31'],
      color: '#9b7fbd',
    }
    const daily: Habit = {
      id: 'daily',
      name: 'Вода',
      icon: '💧',
      targetDays: [0, 1, 2, 3, 4, 5, 6],
      completions: [],
      color: '#75a8b5',
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
    const days = rollingWeek(now)
    const allDays = [0, 1, 2, 3, 4, 5, 6]
    renderHabits([
      {
        id: 'complete',
        name: 'Первая привычка',
        icon: '🎯',
        targetDays: allDays,
        completions: days.map(toDateKey),
        color: '#778c70',
      },
      {
        id: 'empty',
        name: 'Вторая привычка',
        icon: '🌿',
        targetDays: allDays,
        completions: [],
        color: '#75a8b5',
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
    expect(within(firstRow).getByText('7 из 7 плановых дней')).toBeInTheDocument()
    expect(within(secondRow).getByText('0 из 7 плановых дней')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /График выполненных привычек и задач/ })).toBeInTheDocument()
    expect(screen.getByText('Серия', { selector: '.habit-list__streak-label' })).toBeInTheDocument()
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
      },
      {
        id: 'second',
        name: 'Медитация',
        icon: '🧘',
        targetDays: allDays,
        completions: [],
        color: '#9b7fbd',
      },
    ])

    await user.click(await screen.findByRole('button', { name: `Отметить Зарядка ${dayLabel}` }))

    expect(screen.getByRole('button', { name: `Отменить Зарядка ${dayLabel}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Отметить Медитация ${dayLabel}` })).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Ритм привычки Зарядка' })).getByText('14%')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Ритм привычки Медитация' })).getByText('0%')).toBeInTheDocument()
  })
})

describe('habit creation', () => {
  it('offers ten icons and saves the selected icon with an optional description', async () => {
    const user = userEvent.setup()
    renderHabits()
    await screen.findByRole('heading', { name: 'Трекер привычек' })

    await user.click(screen.getByRole('button', { name: 'Новая привычка' }))
    expect(screen.getAllByRole('radio')).toHaveLength(HABIT_ICONS.length)

    await user.type(screen.getByLabelText('Название привычки'), 'Вечернее чтение')
    await user.type(screen.getByLabelText(/Описание/), 'Двадцать минут перед сном')
    await user.click(screen.getByRole('radio', { name: 'Книга' }))
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    const row = screen.getByRole('article', { name: 'Привычка Вечернее чтение' })
    expect(within(row).getByText('📚')).toBeInTheDocument()
    expect(within(row).getByText('Двадцать минут перед сном')).toBeInTheDocument()
    expect(screen.queryByLabelText('Название привычки')).not.toBeInTheDocument()
  })
})
