import type { Habit } from './models'

export const toLocalDateKey = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

export function atStartOfLocalDay(value: Date): Date {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function isHabitAvailableOnDay(habit: Habit, day: Date): boolean {
  const createdDay = atStartOfLocalDay(new Date(habit.createdAt))
  return atStartOfLocalDay(day) >= createdDay
}

function getCurrentStreak(habit: Habit, now: Date): number {
  const cursor = atStartOfLocalDay(now)
  const createdDay = atStartOfLocalDay(new Date(habit.createdAt))
  let streak = 0

  for (let offset = 0; offset < 366 && cursor >= createdDay; offset += 1) {
    const isScheduled = habit.targetDays.includes(cursor.getDay())
    if (isScheduled) {
      const isDone = habit.completions.includes(toLocalDateKey(cursor))
      const isToday = offset === 0

      if (isDone) streak += 1
      else if (!isToday) break
    }
    cursor.setDate(cursor.getDate() - 1)
  }

  return streak
}

export interface HabitRhythm {
  scheduled: number
  completed: number
  progress: number
  streak: number
  isScheduledToday: boolean
  isCompletedToday: boolean
}

export function getHabitRhythm(habit: Habit, days: Date[], now = new Date()): HabitRhythm {
  const today = atStartOfLocalDay(now)
  const isAvailableToday = isHabitAvailableOnDay(habit, today)
  const elapsedScheduledDays = days.filter((day) => {
    const normalizedDay = atStartOfLocalDay(day)
    return normalizedDay <= today
      && isHabitAvailableOnDay(habit, normalizedDay)
      && habit.targetDays.includes(normalizedDay.getDay())
  })
  const completed = elapsedScheduledDays.filter((day) => habit.completions.includes(toLocalDateKey(day))).length
  const scheduled = elapsedScheduledDays.length

  return {
    scheduled,
    completed,
    progress: scheduled ? Math.round((completed / scheduled) * 100) : 0,
    streak: getCurrentStreak(habit, today),
    isScheduledToday: isAvailableToday && habit.targetDays.includes(today.getDay()),
    isCompletedToday: isAvailableToday && habit.completions.includes(toLocalDateKey(today)),
  }
}
