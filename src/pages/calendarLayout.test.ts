import { describe, expect, it } from 'vitest'
import type { Task } from '../domain/models'
import { createSeedState } from '../domain/seed'
import {
  getTaskPlannedDurationMinutes,
  layoutAllDayRanges,
  layoutDeadlineRanges,
  layoutTimedDayTasks,
  tasksForLocalDate,
  tasksForMonthDate,
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
) {
  const template = createSeedState().tasks.find((task) => task.status === 'active')!
  return {
    ...template,
    id,
    title: id,
    startAt: at(day, hours, minutes),
    deadline: undefined,
    plannedDurationMinutes,
  } as Task
}

describe('calendar planned duration projection', () => {
  it('uses an explicit planned duration for height and a visual fallback for start-only legacy data', () => {
    const day = new Date(2026, 7, 3)
    const explicitDuration = timedTask('explicit-duration', day, 9, 0, 120)
    const fallbackDuration = { ...timedTask('fallback-duration', day, 12, 0, 60), plannedDurationMinutes: undefined } as Task

    expect(layoutTimedDayTasks([explicitDuration], { hourHeight: 60 })[0]).toMatchObject({
      startMinute: 9 * 60,
      endMinute: 11 * 60,
      durationMinutes: 120,
      height: 116,
    })
    expect(getTaskPlannedDurationMinutes(fallbackDuration)).toBe(60)
    expect(layoutTimedDayTasks([fallbackDuration], { hourHeight: 60 })[0]).toMatchObject({
      startMinute: 12 * 60,
      endMinute: 13 * 60,
      durationMinutes: 60,
      height: 56,
    })
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

  it('keeps point lookups while projecting a continuous deadline range in month view', () => {
    const startDay = new Date(2026, 7, 3)
    const deadlineDay = new Date(2026, 7, 6)
    const task = {
      ...timedTask('deadline-range', startDay, 9, 0, 60),
      plannedDurationMinutes: undefined,
      deadline: at(deadlineDay, 18),
    } as Task

    const [deadlineRange] = layoutDeadlineRanges(
      [task],
      new Date(2026, 7, 1),
      new Date(2026, 7, 10),
    )
    expect(deadlineRange).toMatchObject({ columnStart: 2, columnSpan: 4, lane: 0 })
    expect(tasksForLocalDate([task], startDay)).toEqual([task])
    expect(tasksForLocalDate([task], deadlineDay)).toEqual([task])
    expect(tasksForLocalDate([task], new Date(2026, 7, 4))).toEqual([])
    expect(tasksForMonthDate([task], new Date(2026, 7, 4))).toEqual([task])

    const sameDayDeadline = { ...task, deadline: at(startDay, 18) } as Task
    expect(tasksForLocalDate([sameDayDeadline], startDay)).toEqual([sameDayDeadline])
    expect(layoutDeadlineRanges(
      [sameDayDeadline],
      new Date(2026, 7, 1),
      new Date(2026, 7, 10),
    )[0]).toMatchObject({ columnStart: 2, columnSpan: 1, lane: 0 })
  })

  it('projects a date-only task once in the shared all-day lanes without a timed block', () => {
    const viewStart = new Date(2026, 7, 3)
    const allDayTask = {
      ...timedTask('all-day-task', viewStart, 9, 0, 60),
      startAt: undefined,
      plannedDurationMinutes: undefined,
      allDayDate: '2026-08-04',
    } as Task
    const deadlineTask = {
      ...timedTask('deadline-task', viewStart, 9, 0, 60),
      plannedDurationMinutes: undefined,
      deadline: at(new Date(2026, 7, 5), 18),
    } as Task

    expect(tasksForLocalDate([allDayTask], new Date(2026, 7, 4))).toEqual([allDayTask])
    expect(tasksForLocalDate([allDayTask], new Date(2026, 7, 5))).toEqual([])
    expect(tasksForMonthDate([allDayTask], new Date(2026, 7, 4))).toEqual([allDayTask])
    expect(layoutTimedDayTasks([allDayTask])).toEqual([])
    expect(layoutDeadlineRanges([allDayTask], viewStart, new Date(2026, 7, 6))).toEqual([])
    expect(layoutAllDayRanges([deadlineTask, allDayTask], viewStart, new Date(2026, 7, 6)).map((range) => ({
      id: range.task.id,
      columnStart: range.columnStart,
      columnSpan: range.columnSpan,
      lane: range.lane,
    }))).toEqual([
      { id: 'deadline-task', columnStart: 0, columnSpan: 3, lane: 0 },
      { id: 'all-day-task', columnStart: 1, columnSpan: 1, lane: 1 },
    ])
  })
})
