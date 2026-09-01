import type { Task } from './models'

type TaskTiming = Pick<Task, 'allDayDate' | 'startAt' | 'plannedDurationMinutes' | 'deadline'>

const LOCAL_DATE_KEY_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/

export function isValidLocalDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL_DATE_KEY_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function representsSameInstant(left: string | undefined, right: string | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime
}

function representsValidInstant(value: string | undefined) {
  return Boolean(value && Number.isFinite(Date.parse(value)))
}

/**
 * New or changed deadlines require a planned start. Existing deadline-only
 * records remain editable so loading legacy snapshots never forces data loss.
 */
export function taskTimingMutationRequiresStart(
  previous: TaskTiming | undefined,
  next: TaskTiming,
) {
  if (!next.deadline || representsValidInstant(next.startAt)) return false
  return !(
    previous
    && !previous.startAt
    && !next.startAt
    && representsSameInstant(previous.deadline, next.deadline)
  )
}

/** A task can represent either a bounded work block or a deadline range. */
export function taskHasDurationDeadlineConflict(
  task: Pick<Task, 'plannedDurationMinutes' | 'deadline'>,
) {
  return task.plannedDurationMinutes !== undefined
    && typeof task.deadline === 'string'
    && task.deadline.trim().length > 0
}

/** All-day dates form their own date-only scheduling mode. */
export function taskHasAllDayTimingConflict(task: TaskTiming) {
  return task.allDayDate !== undefined
    && (task.startAt !== undefined
      || task.plannedDurationMinutes !== undefined
      || task.deadline !== undefined)
}

export function getTaskTimingMutationError(
  previous: TaskTiming | undefined,
  next: TaskTiming,
): string | undefined {
  if (next.allDayDate !== undefined && !isValidLocalDateKey(next.allDayDate)) {
    return 'Task allDayDate must be a valid YYYY-MM-DD date'
  }
  if (taskHasAllDayTimingConflict(next)) {
    return 'Task all-day date is mutually exclusive with start, duration, and deadline'
  }
  if (taskHasDurationDeadlineConflict(next)) {
    return 'Task duration and deadline are mutually exclusive'
  }
  if (taskTimingMutationRequiresStart(previous, next)) {
    return 'Task deadline requires startAt'
  }
  return undefined
}

export function assertTaskTimingMutation(
  previous: TaskTiming | undefined,
  next: TaskTiming,
): void {
  const error = getTaskTimingMutationError(previous, next)
  if (error) throw new Error(error)
}
