import { describe, expect, it } from 'vitest'
import { DEMO_DATA_VERSION, createSeedState } from './seed'

describe('demo seed data', () => {
  it('covers the main task and calendar scenarios with unique entities', () => {
    const state = createSeedState()
    const active = state.tasks.filter((task) => task.status === 'active')
    const completed = state.tasks.filter((task) => task.status === 'completed')
    const tasksWithLaterDeadline = active.filter((task) => task.startAt && task.deadline
      && new Date(task.startAt).toDateString() !== new Date(task.deadline).toDateString())

    expect(DEMO_DATA_VERSION).toBe('2026-08-01')
    expect(state.projects.length).toBeGreaterThanOrEqual(6)
    expect(active.length).toBeGreaterThanOrEqual(14)
    expect(completed).toHaveLength(1)
    expect(state.tasks.some((task) => task.status === 'archived' || task.status === 'deleted')).toBe(false)
    expect(new Set(state.tasks.map((task) => task.id)).size).toBe(state.tasks.length)
    expect(new Set(state.projects.map((project) => project.id)).size).toBe(state.projects.length)
    expect(state.tasks.every((task) => Number.isInteger(task.plannedDurationMinutes)
      && task.plannedDurationMinutes >= 1
      && task.plannedDurationMinutes <= 1440)).toBe(true)
    expect(active.some((task) => task.plannedDurationMinutes !== 60)).toBe(true)
    expect(tasksWithLaterDeadline.length).toBeGreaterThanOrEqual(2)
    expect(active.every((task) => !task.deadline || Boolean(task.startAt))).toBe(true)
    expect(active.some((task) => !task.deadline && !task.startAt)).toBe(true)
    expect(new Set(active.map((task) => task.importance)).size).toBe(2)
  })

  it('includes realistic metadata and habit history without pre-completing today', () => {
    const state = createSeedState()
    const today = [
      new Date().getFullYear(),
      String(new Date().getMonth() + 1).padStart(2, '0'),
      String(new Date().getDate()).padStart(2, '0'),
    ].join('-')

    expect(state.tasks.some((task) => task.subtasks.length >= 2)).toBe(true)
    expect(state.tasks.some((task) => task.reminders.length >= 2)).toBe(true)
    expect(state.tasks.some((task) => task.attachments.some((attachment) => attachment.type.startsWith('image/')))).toBe(true)
    expect(state.tasks.some((task) => task.attachments.some((attachment) => attachment.type === 'text/plain'))).toBe(true)
    expect(state.tasks.some((task) => task.focusMinutes > 0)).toBe(true)
    expect(state.habits.length).toBeGreaterThanOrEqual(4)
    expect(state.habits.every((habit) => habit.completions.length > 0)).toBe(true)
    expect(state.habits.every((habit) => Number.isFinite(Date.parse(habit.createdAt)))).toBe(true)
    expect(state.habits.find((habit) => habit.id === 'habit-water')?.completions).not.toContain(today)
  })
})
