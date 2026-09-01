import { describe, expect, it } from 'vitest'
import type { Habit } from './models'
import { getHabitRhythm, isHabitAvailableOnDay, toLocalDateKey } from './habits'

const everyDay = [0, 1, 2, 3, 4, 5, 6]

function habit(createdAt: Date, completions: Date[]): Habit {
  return {
    id: 'fixed-clock-habit',
    name: 'Привычка с датой создания',
    icon: 'target',
    targetDays: everyDay,
    completions: completions.map(toLocalDateKey),
    color: '#778c70',
    createdAt: createdAt.toISOString(),
  }
}

describe('habit creation boundary', () => {
  it('uses the local creation day even when the habit was created late that day', () => {
    const createdAt = new Date(2026, 2, 29, 23, 30)
    const value = habit(createdAt, [])

    expect(isHabitAvailableOnDay(value, new Date(2026, 2, 28, 23, 59))).toBe(false)
    expect(isHabitAvailableOnDay(value, new Date(2026, 2, 29, 0, 1))).toBe(true)
  })

  it('excludes pre-creation days and completions from progress and streak', () => {
    const createdAt = new Date(2026, 2, 30, 18, 45)
    const now = new Date(2026, 3, 1, 12)
    const days = [
      new Date(2026, 2, 28, 12),
      new Date(2026, 2, 29, 12),
      new Date(2026, 2, 30, 12),
      new Date(2026, 2, 31, 12),
      new Date(2026, 3, 1, 12),
    ]
    const value = habit(createdAt, days)

    expect(getHabitRhythm(value, days, now)).toEqual({
      scheduled: 3,
      completed: 3,
      progress: 100,
      streak: 3,
      isScheduledToday: true,
      isCompletedToday: true,
    })
  })
})
