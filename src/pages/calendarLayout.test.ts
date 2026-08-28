import { describe, expect, it } from 'vitest'
import type { Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import {
  layoutDeadlineRanges,
  layoutTimedDayTasks,
  tasksForLocalDate,
} from './calendarLayout'

function at(day: Date, hours: number, minutes = 0) {
  const value = new Date(day)
  value.setHours(hours, minutes, 0, 0)
  return value.toISOString()
}

function timedTask(
  id: string,
  day: Date,
  hours: number,
  minutes: number,
  plannedDurationMinutes: number,
  deadline?: string,
) {
  const template = createSeedState().tasks.find((task) => task.status === 'active')!
  return {
    ...template,
    id,
    title: id,
    startAt: at(day, hours, minutes),
    deadline,
    plannedDurationMinutes,
  } as Task
}

describe('calendar planned duration projection', () => {
  it('uses planned duration for height independently from the deadline', () => {
    const day = new Date(2026, 7, 3)
    const earlyDeadline = timedTask('early-deadline', day, 9, 0, 120, at(day, 9, 15))
    const lateDeadline = timedTask('late-deadline', day, 9, 0, 120, at(day, 21))

    for (const task of [earlyDeadline, lateDeadline]) {
      const [positioned] = layoutTimedDayTasks([task], { hourHeight: 60 })
      expect(positioned).toMatchObject({
        startMinute: 9 * 60,
        endMinute: 11 * 60,
        durationMinutes: 120,
        height: 116,
      })
    }
  })

  it('lays out overlapping tasks using their individual planned durations', () => {
    const day = new Date(2026, 7, 3)
    const tasks = [
      timedTask('long', day, 9, 0, 120),
      timedTask('short-first', day, 9, 30, 30),
      timedTask('short-second', day, 10, 0, 30),
      timedTask('after-cluster', day, 11, 0, 45),
    ]

    expect(layoutTimedDayTasks(tasks, { hourHeight: 60 }).map((item) => ({
      id: item.task.id,
      duration: item.durationMinutes,
      column: item.column,
      columnCount: item.columnCount,
    }))).toEqual([
      { id: 'long', duration: 120, column: 0, columnCount: 2 },
      { id: 'short-first', duration: 30, column: 1, columnCount: 2 },
      { id: 'short-second', duration: 30, column: 1, columnCount: 2 },
      { id: 'after-cluster', duration: 45, column: 0, columnCount: 1 },
    ])
  })

  it('clips a task at local midnight and never projects it onto the next date', () => {
    const day = new Date(2026, 7, 3)
    const task = timedTask('late-task', day, 23, 30, 120)
    const [positioned] = layoutTimedDayTasks([task], { hourHeight: 60 })

    expect(positioned).toMatchObject({
      startMinute: 23 * 60 + 30,
      endMinute: 24 * 60,
      durationMinutes: 30,
      height: 26,
    })
    expect(tasksForLocalDate([task], day)).toEqual([task])
    expect(tasksForLocalDate([task], new Date(2026, 7, 4))).toEqual([])
  })

  it('projects start and deadline as two deduplicated points without filling intervening days', () => {
    const startDay = new Date(2026, 7, 3)
    const deadlineDay = new Date(2026, 7, 6)
    const task = timedTask('separate-points', startDay, 9, 0, 60, at(deadlineDay, 18))

    const [deadlinePoint] = layoutDeadlineRanges(
      [task],
      new Date(2026, 7, 1),
      new Date(2026, 7, 10),
    )
    expect(deadlinePoint).toMatchObject({ columnStart: 5, columnSpan: 1, lane: 0 })
    expect(tasksForLocalDate([task], startDay)).toEqual([task])
    expect(tasksForLocalDate([task], deadlineDay)).toEqual([task])
    expect(tasksForLocalDate([task], new Date(2026, 7, 4))).toEqual([])

    const sameDayDeadline = { ...task, deadline: at(startDay, 18) } as Task
    expect(tasksForLocalDate([sameDayDeadline], startDay)).toEqual([sameDayDeadline])
  })
})
