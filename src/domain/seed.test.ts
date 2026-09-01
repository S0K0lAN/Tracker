import { describe, expect, it } from 'vitest'
import { DEMO_DATA_VERSION, createSeedState } from './seed'

describe('demo seed data', () => {
  it('covers the main task and calendar scenarios with unique entities', () => {
    const state = createSeedState()
    const active = state.tasks.filter((task) => task.status === 'active')
    const completed = state.tasks.filter((task) => task.status === 'completed')
    const allDayTasks = state.tasks.filter((task) => task.allDayDate)
    const tasksWithLaterDeadline = active.filter((task) => task.startAt && task.deadline
      && new Date(task.startAt).toDateString() !== new Date(task.deadline).toDateString())

    expect(DEMO_DATA_VERSION).toBe('2026-09-01')
    expect(state.schemaVersion).toBe(10)
    expect(state.projects.length).toBeGreaterThanOrEqual(6)
    expect(active.length).toBeGreaterThanOrEqual(14)
    expect(completed).toHaveLength(1)
    expect(state.tasks.some((task) => task.status === 'archived' || task.status === 'deleted')).toBe(false)
    expect(new Set(state.tasks.map((task) => task.id)).size).toBe(state.tasks.length)
    expect(new Set(state.projects.map((project) => project.id)).size).toBe(state.projects.length)
    expect(state.tasks.every((task) => task.plannedDurationMinutes === undefined
      || (Number.isInteger(task.plannedDurationMinutes)
        && task.plannedDurationMinutes >= 1
        && task.plannedDurationMinutes <= 1440))).toBe(true)
    expect(active.some((task) => task.plannedDurationMinutes !== undefined
      && task.plannedDurationMinutes !== 60)).toBe(true)
    expect(state.tasks.every((task) => task.deadline === undefined
      || task.plannedDurationMinutes === undefined)).toBe(true)
    expect(allDayTasks.every((task) => task.startAt === undefined
      && task.plannedDurationMinutes === undefined
      && task.deadline === undefined
      && task.urgencyThresholdOverrideHours === undefined
      && task.urgencyOverride === undefined)).toBe(true)
    expect(allDayTasks.every((task) => [
      'startAt',
      'plannedDurationMinutes',
      'deadline',
      'urgencyThresholdOverrideHours',
      'urgencyOverride',
    ].every((field) => !Object.hasOwn(task, field)))).toBe(true)
    expect(allDayTasks.every((task) => /^\d{4}-\d{2}-\d{2}$/.test(task.allDayDate!))).toBe(true)
    expect(state.tasks.every((task) => !Object.hasOwn(task, 'urgencyOverride'))).toBe(true)
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

  it('demonstrates active, future and completed all-day tasks deterministically', () => {
    const state = createSeedState()
    const today = [
      new Date().getFullYear(),
      String(new Date().getMonth() + 1).padStart(2, '0'),
      String(new Date().getDate()).padStart(2, '0'),
    ].join('-')
    const current = state.tasks.find((task) => task.id === 'task-all-day')
    const future = state.tasks.find((task) => task.id === 'task-all-day-future')
    const completed = state.tasks.find((task) => task.id === 'task-done')

    expect(current).toMatchObject({
      title: 'Разобрать личные документы',
      status: 'active',
      allDayDate: today,
    })
    expect(future).toMatchObject({ status: 'active' })
    expect(Boolean(future?.allDayDate && future.allDayDate > today)).toBe(true)
    expect(completed).toMatchObject({ status: 'completed', allDayDate: today })
    expect(current?.updatedAt).toBe(current?.createdAt)
    expect(completed?.updatedAt).toBe(completed?.completedAt)
  })
})
